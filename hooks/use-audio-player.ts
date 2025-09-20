import { useState, useRef, useCallback } from 'react'
import { AudioData, TranscriptData } from '@/lib/types'
import { getWordTimingFromTranscript } from '@/lib/timing-helpers'

export const useAudioPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [highlightedWordIndex, setHighlightedWordIndex] = useState(-1)
  const audioRef = useRef<HTMLAudioElement>(null)

  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  const skipTime = useCallback((seconds: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(audioRef.current.duration, audioRef.current.currentTime + seconds)
    )
  }, [])

  const playFromWordIndex = useCallback((
    wordIndex: number,
    words: string[],
    audioData?: AudioData | null
  ) => {
    if (!audioRef.current) return
    
    let startTime: number
    const preciseStartTiming = getWordTimingFromTranscript(wordIndex, audioData?.transcript)
    
    if (preciseStartTiming) {
      startTime = preciseStartTiming.start
    } else {
      // Fallback to uniform mapping
      const totalDuration = audioRef.current.duration || audioData?.duration || 0
      const progress = wordIndex / Math.max(1, words.length)
      startTime = progress * totalDuration
    }
    
    audioRef.current.currentTime = startTime
    audioRef.current.play()
  }, [])

  const handleTimeUpdate = useCallback((
    words: string[],
    audioData?: AudioData | null
  ) => {
    if (!audioRef.current) return
    const time = audioRef.current.currentTime
    setCurrentTime(time)

    // Use transcript timing for more accurate highlighting if available
    let highlightIndex = -1
    
    if (audioData?.transcript?.words) {
      // Find the word that should be highlighted based on current time
      for (let i = 0; i < audioData.transcript.words.length && i < words.length; i++) {
        const word = audioData.transcript.words[i]
        if (time >= word.start && time <= word.end) {
          highlightIndex = i
          break
        }
        if (time > word.start && (i === audioData.transcript.words.length - 1 || time < audioData.transcript.words[i + 1].start)) {
          highlightIndex = i
          break
        }
      }
    }
    
    // Fallback to uniform mapping if no transcript or word not found
    if (highlightIndex === -1) {
      const duration = Math.max(1e-6, audioRef.current.duration || 0)
      const progress = time / duration
      highlightIndex = Math.max(0, Math.min(words.length - 1, Math.floor(progress * words.length)))
    }
    
    setHighlightedWordIndex(highlightIndex)
  }, [])

  const resetPlayback = useCallback(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setHighlightedWordIndex(-1)
  }, [])

  return {
    isPlaying,
    currentTime,
    highlightedWordIndex,
    audioRef,
    togglePlayPause,
    skipTime,
    playFromWordIndex,
    handleTimeUpdate,
    resetPlayback,
    setIsPlaying,
  }
}
