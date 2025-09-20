import Crunker from 'crunker'
import { AudioData, AudioSegment, TranscriptData } from './types'
import { validateTranscriptData } from './timing-helpers'

// Generate transcript for audio blob
export const generateTranscriptForAudio = async (audioBlob: Blob): Promise<TranscriptData | null> => {
  try {
    const formData = new FormData()
    formData.append('file', audioBlob, 'audio.mp3')
    formData.append('model_id', 'scribe_v1')

    const response = await fetch('/api/speech-to-text', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      console.warn('Failed to generate transcript for audio')
      return null
    }

    const data = await response.json()
    const transcript = data.transcript || null
    
    return validateTranscriptData(transcript) ? transcript : null
  } catch (error) {
    console.warn('Error generating transcript:', error)
    return null
  }
}

// Simplified audio segment replacer class
export class AudioSegmentReplacer {
  private crunker: Crunker

  constructor() {
    this.crunker = new Crunker()
  }

  async replaceAudioSegment(
    originalAudioUrl: string,
    newSegmentBlob: Blob,
    startTime: number,
    endTime: number
  ): Promise<Blob> {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

      // Load original audio
      const [originalBuffer] = await this.crunker.fetchAudio(originalAudioUrl)

      // Decode new segment
      const newSegmentArrayBuffer = await newSegmentBlob.arrayBuffer()
      const newSegmentBuffer = await audioContext.decodeAudioData(newSegmentArrayBuffer)

      // Clamp timing to buffer bounds
      const clampedStartTime = Math.max(0, Math.min(startTime, originalBuffer.duration))
      const clampedEndTime = Math.max(clampedStartTime, Math.min(endTime, originalBuffer.duration))

      // Extract segments
      const beforeBuffer = clampedStartTime > 0
        ? this.extractSegment(originalBuffer, 0, clampedStartTime)
        : audioContext.createBuffer(originalBuffer.numberOfChannels, 1, originalBuffer.sampleRate)
      
      const afterBuffer = clampedEndTime < originalBuffer.duration
        ? this.extractSegment(originalBuffer, clampedEndTime, originalBuffer.duration)
        : audioContext.createBuffer(originalBuffer.numberOfChannels, 1, originalBuffer.sampleRate)

      // Simple concatenation with micro fades to avoid clicks
      const processedNewSegment = this.applyMicroFades(newSegmentBuffer)
      const beforeWithFade = this.applyMicroFades(beforeBuffer)
      const afterWithFade = this.applyMicroFades(afterBuffer)

      // Concatenate all segments
      const mergedBuffer = this.concatenateBuffers([beforeWithFade, processedNewSegment, afterWithFade])

      const { blob } = this.crunker.export(mergedBuffer, 'audio/wav')
      return blob
    } catch (error) {
      console.error('Audio segment replacement failed:', error)
      throw error
    }
  }

  private extractSegment(buffer: AudioBuffer, startTime: number, endTime: number): AudioBuffer {
    const sampleRate = buffer.sampleRate
    const startSample = Math.max(0, Math.round(startTime * sampleRate))
    const endSample = Math.max(startSample, Math.min(buffer.length, Math.round(endTime * sampleRate)))
    const segmentLength = endSample - startSample

    if (segmentLength <= 0) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      return audioContext.createBuffer(buffer.numberOfChannels, 1, sampleRate)
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const segmentBuffer = audioContext.createBuffer(
      buffer.numberOfChannels,
      segmentLength,
      sampleRate
    )

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const channelData = buffer.getChannelData(channel)
      const segmentData = segmentBuffer.getChannelData(channel)
      
      for (let i = 0; i < segmentLength; i++) {
        const sourceIndex = startSample + i
        segmentData[i] = sourceIndex < buffer.length ? channelData[sourceIndex] : 0
      }
    }

    return segmentBuffer
  }

  private applyMicroFades(buffer: AudioBuffer, fadeSec: number = 0.005): AudioBuffer {
    const sampleRate = buffer.sampleRate
    const fadeSamples = Math.max(1, Math.floor(fadeSec * sampleRate))
    const len = buffer.length
    
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch)
      const fadeCount = Math.min(fadeSamples, len)
      
      // Fade in
      for (let i = 0; i < fadeCount; i++) {
        data[i] *= i / fadeCount
      }
      
      // Fade out
      for (let i = 0; i < fadeCount; i++) {
        data[len - 1 - i] *= i / fadeCount
      }
    }
    
    return buffer
  }

  private concatenateBuffers(buffers: AudioBuffer[]): AudioBuffer {
    if (buffers.length === 0) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      return audioContext.createBuffer(1, 1, 44100)
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0)
    const sampleRate = buffers[0].sampleRate
    const channels = buffers[0].numberOfChannels

    const mergedBuffer = audioContext.createBuffer(channels, totalLength, sampleRate)

    let offset = 0
    for (const buffer of buffers) {
      for (let channel = 0; channel < channels; channel++) {
        const mergedData = mergedBuffer.getChannelData(channel)
        const bufferData = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
        mergedData.set(bufferData, offset)
      }
      offset += buffer.length
    }

    return mergedBuffer
  }

  audioBufferToWavBlob(buffer: AudioBuffer): Blob {
    const { blob } = this.crunker.export(buffer, 'audio/wav')
    return blob
  }
}

// Create merged audio from segments
export const createMergedAudio = async (
  audioData: AudioData,
  audioSegments: AudioSegment[],
  audioSegmentReplacer: AudioSegmentReplacer,
  resolveTimingForSelection: (text: string, startIdx: number, endIdx: number, words: string[], transcript?: TranscriptData | null) => { startTime: number; endTime: number } | null
): Promise<string> => {
  if (!audioData || audioSegments.length === 0) {
    return audioData?.url || ""
  }

  try {
    // Sort segments by startIndex for sequential processing
    const sorted = [...audioSegments].sort((a, b) => a.startIndex - b.startIndex)
    let currentAudioUrl = audioData.url

    for (const segment of sorted) {
      if (!segment.blob || !segment.text) continue

      // Get timing for this segment
      const timing = resolveTimingForSelection(
        segment.text,
        segment.startIndex,
        segment.endIndex,
        segment.text.split(/\s+/),
        audioData.transcript
      )

      if (!timing) {
        console.warn('Could not resolve timing for segment, skipping')
        continue
      }

      // Replace segment
      const mergedBlob = await audioSegmentReplacer.replaceAudioSegment(
        currentAudioUrl,
        segment.blob,
        timing.startTime,
        timing.endTime
      )
      
      // Clean up previous URL if it's not the original
      if (currentAudioUrl !== audioData.url) {
        URL.revokeObjectURL(currentAudioUrl)
      }
      
      currentAudioUrl = URL.createObjectURL(mergedBlob)
    }

    return currentAudioUrl
  } catch (error) {
    console.error('Error merging audio:', error)
    return audioData?.url || ""
  }
}

// Generate default filename from script
export const generateDefaultFilename = (script: string): string => {
  const firstWords = script.split(/\s+/).slice(0, 3).join("_").replace(/[^a-zA-Z0-9_]/g, "")
  return firstWords || "podcast"
}
