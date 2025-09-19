"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Play, Pause, SkipBack, SkipForward, Download, RefreshCw, Undo, Redo, Volume2 } from "lucide-react"
import { AudioVisualizer } from "react-audio-visualize"

interface AudioData {
  url: string
  duration: number
  waveform: number[]
  blob?: Blob
}

interface AudioSegment {
  startIndex: number
  endIndex: number
  audioUrl: string
  waveform: number[]
  blob?: Blob
  startTime: number
  endTime: number
}

interface HistoryState {
  script: string
  audioData: AudioData | null
  audioSegments: AudioSegment[]
  timestamp: number
  action: string
}

interface MergePreview {
  originalSegment: AudioSegment | null
  newSegment: AudioSegment
  mergedAudio: AudioData | null
}

export default function PodcastBuilder() {
  const [script, setScript] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [audioData, setAudioData] = useState<AudioData | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [highlightedWordIndex, setHighlightedWordIndex] = useState(-1)

  const [selectedText, setSelectedText] = useState("")
  const [selectionStart, setSelectionStart] = useState(0)
  const [selectionEnd, setSelectionEnd] = useState(0)
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>([])
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportFilename, setExportFilename] = useState("")
  const [isExporting, setIsExporting] = useState(false)

  const [history, setHistory] = useState<HistoryState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const maxHistorySize = 15

  const audioRef = useRef<HTMLAudioElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const mergeOriginalAudioRef = useRef<HTMLAudioElement>(null)
  const mergeNewAudioRef = useRef<HTMLAudioElement>(null)

  const [mergeOriginalClipUrl, setMergeOriginalClipUrl] = useState<string>("")
  const [mergeOriginalClipBlob, setMergeOriginalClipBlob] = useState<Blob | null>(null)
  const [mergeOriginalCurrentTime, setMergeOriginalCurrentTime] = useState(0)
  const [mergeNewCurrentTime, setMergeNewCurrentTime] = useState(0)

  const words = script.split(/\s+/).filter((word) => word.length > 0)

  const isWordHighlighted = useMemo(() => {
    if (audioSegments.length === 0) return new Array(words.length).fill(false)
    const highlighted: boolean[] = new Array(words.length).fill(false)
    for (const segment of audioSegments) {
      const start = Math.max(0, segment.startIndex)
      const end = Math.min(words.length, segment.endIndex)
      for (let i = start; i < end; i++) highlighted[i] = true
    }
    return highlighted
  }, [audioSegments, words.length])

  const saveToHistory = (action: string) => {
    const newState: HistoryState = {
      script,
      audioData,
      audioSegments: [...audioSegments],
      timestamp: Date.now(),
      action,
    }

    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(newState)

      // Keep only the last 15 states
      if (newHistory.length > maxHistorySize) {
        newHistory.shift()
        return newHistory
      }

      return newHistory
    })

    setHistoryIndex((prev) => Math.min(prev + 1, maxHistorySize - 1))
  }

  const undo = () => {
    if (historyIndex <= 0) return

    const previousState = history[historyIndex - 1]
    setScript(previousState.script)
    setAudioData(previousState.audioData)
    setAudioSegments([...previousState.audioSegments])
    setHistoryIndex(historyIndex - 1)

    // Reset playback state
    setIsPlaying(false)
    setCurrentTime(0)
    setHighlightedWordIndex(-1)
  }

  const redo = () => {
    if (historyIndex >= history.length - 1) return

    const nextState = history[historyIndex + 1]
    setScript(nextState.script)
    setAudioData(nextState.audioData)
    setAudioSegments([...nextState.audioSegments])
    setHistoryIndex(historyIndex + 1)

    // Reset playback state
    setIsPlaying(false)
    setCurrentTime(0)
    setHighlightedWordIndex(-1)
  }

  const generateAudio = async () => {
    if (!script.trim()) return

    setIsGenerating(true)
    try {
      const response = await fetch("/api/generate-audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: script }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate audio")
      }

      // Create blob from the audio URL for react-audio-visualize
      const audioBlob = await fetch(data.url).then(res => res.blob())
      const audioDataWithBlob = { ...data, blob: audioBlob }

      setAudioData(audioDataWithBlob)
      setAudioSegments([])

      saveToHistory("Generate Audio")
    } catch (error) {
      console.error("Error generating audio:", error)
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleTextSelection = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return

    const selectedText = selection.toString().trim()
    if (!selectedText) return

    const range = selection.getRangeAt(0)
    const textContent = textRef.current?.textContent || ""

    // Find the start and end positions in the full text
    const beforeSelection = textContent.substring(0, range.startOffset)
    const selectionStart = beforeSelection.length
    const selectionEnd = selectionStart + selectedText.length

    setSelectedText(selectedText)
    setSelectionStart(selectionStart)
    setSelectionEnd(selectionEnd)
    setShowRegenerateDialog(true)
  }

  const regenerateSelection = async () => {
    if (!selectedText.trim() || !audioData) return

    setIsRegenerating(true)
    try {
      const response = await fetch("/api/generate-audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: selectedText }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to regenerate audio")
      }

      // Calculate word indices for the selection
      const beforeText = script.substring(0, selectionStart)
      const beforeWords = beforeText.split(/\s+/).filter((word) => word.length > 0)
      const selectedWords = selectedText.split(/\s+/).filter((word) => word.length > 0)

      const startWordIndex = beforeWords.length
      const endWordIndex = startWordIndex + selectedWords.length

      // Calculate time positions based on word indices
      const totalWords = words.length
      const startTime = (startWordIndex / totalWords) * audioData.duration
      const endTime = (endWordIndex / totalWords) * audioData.duration

      // Create blob for the regenerated audio
      const audioBlob = await fetch(data.url).then(res => res.blob())

      // Create new audio segment
      const newSegment: AudioSegment = {
        startIndex: startWordIndex,
        endIndex: endWordIndex,
        audioUrl: data.url,
        waveform: data.waveform,
        blob: audioBlob,
        startTime,
        endTime,
      }

      // Find existing segment that overlaps
      const existingSegment = audioSegments.find(
        (seg) => seg.startIndex < endWordIndex && seg.endIndex > startWordIndex
      )

      // Create merge preview
      setMergePreview({
        originalSegment: existingSegment || null,
        newSegment,
        mergedAudio: null, // Will be populated when merge is confirmed
      })

      setShowRegenerateDialog(false)
      setShowMergeDialog(true)
    } catch (error) {
      console.error("Error regenerating audio:", error)
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsRegenerating(false)
    }
  }

  const playSelectedText = () => {
    if (!selectedText.trim() || !audioData) return

    // Find matching audio segment
    const beforeText = script.substring(0, selectionStart)
    const beforeWords = beforeText.split(/\s+/).filter((word) => word.length > 0)
    const startWordIndex = beforeWords.length

    const matchingSegment = audioSegments.find(
      (seg) => seg.startIndex <= startWordIndex && seg.endIndex > startWordIndex,
    )

    if (matchingSegment && audioRef.current) {
      // Play the regenerated segment
      audioRef.current.src = matchingSegment.audioUrl
      audioRef.current.play()
    } else if (audioRef.current) {
      // Calculate approximate time position in original audio
      const progress = startWordIndex / words.length
      const startTime = progress * audioRef.current.duration
      audioRef.current.currentTime = startTime
      audioRef.current.play()
    }
  }

  const togglePlayPause = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const skipTime = (seconds: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(audioRef.current.duration, audioRef.current.currentTime + seconds),
    )
  }

  const handleTimeUpdate = () => {
    if (!audioRef.current) return
    const time = audioRef.current.currentTime
    setCurrentTime(time)

    // Calculate which word should be highlighted based on time and segments
    let wordIndex = -1
    
    // Check if current time falls within any regenerated segment
    const currentSegment = audioSegments.find(
      (seg) => time >= seg.startTime && time <= seg.endTime
    )
    
    if (currentSegment) {
      // Calculate position within the segment
      const segmentProgress = (time - currentSegment.startTime) / (currentSegment.endTime - currentSegment.startTime)
      const segmentWordCount = currentSegment.endIndex - currentSegment.startIndex
      wordIndex = currentSegment.startIndex + Math.floor(segmentProgress * segmentWordCount)
    } else {
      // Use original audio timing
    const progress = time / audioRef.current.duration
      wordIndex = Math.floor(progress * words.length)
    }
    
    setHighlightedWordIndex(Math.max(0, Math.min(wordIndex, words.length - 1)))
  }


  const exportAudio = async () => {
    if (!audioData) return

    // Generate default filename based on first few words of script
    const firstWords = script.split(/\s+/).slice(0, 3).join("_").replace(/[^a-zA-Z0-9_]/g, "")
    const defaultFilename = firstWords || "podcast"
    
    setExportFilename(defaultFilename)
    setShowExportDialog(true)
  }

  const confirmExport = async () => {
    if (!audioData) return

    setIsExporting(true)
    try {
      // If there are audio segments, we need to merge them first
      let finalAudioUrl = audioData.url
      
      if (audioSegments.length > 0) {
        // Create merged audio (simplified approach)
        finalAudioUrl = await createMergedAudio()
      }

      // Convert to WAV format (simplified - in reality you'd need proper audio conversion)
      const response = await fetch(finalAudioUrl)
      const blob = await response.blob()
      
      // Create download link
      const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
      link.href = url
      link.download = `${exportFilename}.wav`
      document.body.appendChild(link)
    link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
      setShowExportDialog(false)
      setExportFilename("")
    } catch (error) {
      console.error("Error exporting audio:", error)
      alert(`Error exporting: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsExporting(false)
    }
  }

  const createMergedAudio = async (): Promise<string> => {
    if (!audioData || audioSegments.length === 0) {
      return audioData?.url || ""
    }

    try {
      // Create audio context for merging
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      // Load main audio
      const mainResponse = await fetch(audioData.url)
      const mainArrayBuffer = await mainResponse.arrayBuffer()
      const mainAudioBuffer = await audioContext.decodeAudioData(mainArrayBuffer)
      
      // Create a new buffer for the merged audio
      const mergedBuffer = audioContext.createBuffer(
        mainAudioBuffer.numberOfChannels,
        mainAudioBuffer.length,
        mainAudioBuffer.sampleRate
      )
      
      // Copy main audio to merged buffer
      for (let channel = 0; channel < mainAudioBuffer.numberOfChannels; channel++) {
        const mainData = mainAudioBuffer.getChannelData(channel)
        const mergedData = mergedBuffer.getChannelData(channel)
        mergedData.set(mainData)
      }
      
      // Overlay regenerated segments
      for (const segment of audioSegments) {
        try {
          const segmentResponse = await fetch(segment.audioUrl)
          const segmentArrayBuffer = await segmentResponse.arrayBuffer()
          const segmentAudioBuffer = await audioContext.decodeAudioData(segmentArrayBuffer)
          
          const startSample = Math.floor(segment.startTime * mainAudioBuffer.sampleRate)
          const segmentLength = Math.min(
            segmentAudioBuffer.length,
            mainAudioBuffer.length - startSample
          )
          
          for (let channel = 0; channel < Math.min(mainAudioBuffer.numberOfChannels, segmentAudioBuffer.numberOfChannels); channel++) {
            const segmentData = segmentAudioBuffer.getChannelData(channel)
            const mergedData = mergedBuffer.getChannelData(channel)
            
            for (let i = 0; i < segmentLength; i++) {
              if (startSample + i < mergedData.length) {
                mergedData[startSample + i] = segmentData[i]
              }
            }
          }
        } catch (error) {
          console.warn('Failed to merge segment:', error)
        }
      }
      
      // Convert merged buffer back to blob URL
      const mergedBlob = await audioBufferToBlob(mergedBuffer)
      return URL.createObjectURL(mergedBlob)
      
    } catch (error) {
      console.error('Error merging audio:', error)
      // Fallback to original audio
      return audioData?.url || ""
    }
  }

  const audioBufferToBlob = async (audioBuffer: AudioBuffer): Promise<Blob> => {
    // Simple WAV conversion
    const length = audioBuffer.length
    const numberOfChannels = audioBuffer.numberOfChannels
    const sampleRate = audioBuffer.sampleRate
    const bytesPerSample = 2
    const blockAlign = numberOfChannels * bytesPerSample
    const byteRate = sampleRate * blockAlign
    const dataSize = length * blockAlign
    const bufferSize = 44 + dataSize
    
    const arrayBuffer = new ArrayBuffer(bufferSize)
    const view = new DataView(arrayBuffer)
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }
    
    writeString(0, 'RIFF')
    view.setUint32(4, bufferSize - 8, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, numberOfChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bytesPerSample * 8, true)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)
    
    // Convert audio data
    let offset = 44
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]))
        view.setInt16(offset, sample * 0x7FFF, true)
        offset += 2
      }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' })
  }

  const createAudioClipBlob = async (audioUrl: string, startTime: number, endTime: number): Promise<Blob> => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const response = await fetch(audioUrl)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = await audioContext.decodeAudioData(arrayBuffer)
    const clipStart = Math.max(0, Math.min(startTime, buffer.duration))
    const clipEnd = Math.max(clipStart, Math.min(endTime, buffer.duration))
    const startSample = Math.floor(clipStart * buffer.sampleRate)
    const endSample = Math.floor(clipEnd * buffer.sampleRate)
    const length = endSample - startSample

    const clippedBuffer = audioContext.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const sourceData = buffer.getChannelData(channel)
      const targetData = clippedBuffer.getChannelData(channel)
      targetData.set(sourceData.subarray(startSample, endSample))
    }
    return audioBufferToBlob(clippedBuffer)
  }

  const confirmMerge = async () => {
    if (!mergePreview) return

    try {
      // Update segments array
      setAudioSegments((prev) => {
        const filtered = prev.filter(
          (seg) => 
            seg.endIndex <= mergePreview.newSegment.startIndex || 
            seg.startIndex >= mergePreview.newSegment.endIndex
        )
        return [...filtered, mergePreview.newSegment].sort((a, b) => a.startIndex - b.startIndex)
      })

      setShowMergeDialog(false)
      setMergePreview(null)
      
      const segmentText = selectedText.substring(0, 20) + (selectedText.length > 20 ? "..." : "")
      saveToHistory(`Merge "${segmentText}"`)
    } catch (error) {
      console.error("Error merging audio:", error)
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [historyIndex, history])

  useEffect(() => {
    const setupMergeClip = async () => {
      if (!showMergeDialog || !mergePreview || !audioData) return
      try {
        const blob = await createAudioClipBlob(
          audioData.url,
          mergePreview.newSegment.startTime,
          mergePreview.newSegment.endTime,
        )
        setMergeOriginalClipBlob(blob)
        const url = URL.createObjectURL(blob)
        setMergeOriginalClipUrl(url)
      } catch (e) {
        console.warn('Failed to create original clip blob:', e)
      }
    }
    setupMergeClip()
    return () => {
      if (mergeOriginalClipUrl) URL.revokeObjectURL(mergeOriginalClipUrl)
    }
  }, [showMergeDialog, mergePreview, audioData])

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-teal-600 bg-clip-text text-transparent mb-4">
            Podcast Builder
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Create and edit your podcast with AI-generated audio. Write your script, generate audio, and regenerate specific portions with seamless merging.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Action History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={undo} disabled={historyIndex <= 0}>
                  <Undo className="h-4 w-4 mr-2" />
                  Undo
                </Button>
                <Button variant="outline" size="sm" onClick={redo} disabled={historyIndex >= history.length - 1}>
                  <Redo className="h-4 w-4 mr-2" />
                  Redo
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                {history.length > 0 && (
                  <span>
                    Step {historyIndex + 1} of {history.length}
                    {history[historyIndex] && ` - ${history[historyIndex].action}`}
                  </span>
                )}
                {history.length === 0 && <span>No actions yet</span>}
              </div>
            </div>

            <div className="text-xs text-muted-foreground mt-2">
              Use Ctrl+Z (Cmd+Z) to undo, Ctrl+Y (Cmd+Shift+Z) to redo
            </div>
          </CardContent>
        </Card>

        {/* Script Input */}
        <Card>
          <CardHeader>
            <CardTitle>Podcast Script</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Write your podcast script here..."
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="min-h-[200px] text-base leading-relaxed"
            />
            <Button onClick={generateAudio} disabled={!script.trim() || isGenerating} className="w-full">
              {isGenerating ? "Generating Audio..." : "Generate Audio"}
            </Button>
          </CardContent>
        </Card>

        {/* Text with Highlighting */}
        {audioData && (
          <Card>
            <CardHeader>
              <CardTitle>Script Playback</CardTitle>
              <p className="text-sm text-muted-foreground">
                Select text to regenerate specific portions or play selected segments
              </p>
            </CardHeader>
            <CardContent>
              <div
                ref={textRef}
                className="text-base leading-relaxed select-text cursor-text"
                onMouseUp={handleTextSelection}
              >
                {words.map((word, index) => (
                  <span
                    key={index}
                    className={`${
                      index === highlightedWordIndex
                        ? "bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100"
                        : isWordHighlighted[index]
                          ? "bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100"
                          : ""
                    } transition-colors duration-200`}
                  >
                    {word}{" "}
                  </span>
                ))}
              </div>

              {selectedText && (
                <div className="mt-4 p-3 bg-muted rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground mb-3">Selected: "{selectedText}"</p>
                  <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={playSelectedText}>
                    <Play className="h-4 w-4 mr-2" />
                    Play Selection
                  </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setShowRegenerateDialog(true)}
                      className="text-orange-600 border-orange-200 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-950"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Regenerate Selection
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Audio Player */}
        {audioData && (
          <Card>
            <CardHeader>
              <CardTitle>Audio Player</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Waveform */}
              {audioData?.blob && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Audio Timeline</span>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-sm bg-blue-500"></div>
                        <span>Original</span>
                      </div>
                      {audioSegments.length > 0 && (
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-sm bg-teal-500"></div>
                          <span>Regenerated</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div 
                    className="relative w-full h-24 border rounded bg-muted cursor-pointer overflow-hidden"
                  onClick={(e) => {
                    if (!audioRef.current) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const x = e.clientX - rect.left
                    const progress = x / rect.width
                    audioRef.current.currentTime = progress * audioRef.current.duration
                  }}
                >
                  <AudioVisualizer
                    blob={audioData.blob}
                    width={800}
                    height={100}
                    barWidth={2}
                    gap={1}
                    barColor="rgb(59, 130, 246)"
                    barPlayedColor="rgb(16, 185, 129)"
                    currentTime={currentTime}
                    style={{ width: '100%', height: '100%' }}
                  />
                    
                    {/* Overlay regenerated segments */}
                    {audioSegments.map((segment, index) => {
                      const startPercent = (segment.startTime / audioData.duration) * 100
                      const widthPercent = ((segment.endTime - segment.startTime) / audioData.duration) * 100
                      return (
                        <div
                          key={index}
                          className="absolute top-0 bottom-0 bg-teal-500/30 border-l-2 border-r-2 border-teal-500"
                          style={{
                            left: `${startPercent}%`,
                            width: `${widthPercent}%`,
                          }}
                        />
                      )
                    })}
                    
                    {/* Current time indicator */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
                      style={{
                        left: `${(currentTime / audioData.duration) * 100}%`,
                      }}
                    />
                  </div>
                  
                  {/* Time display */}
                  <div className="flex justify-between text-xs text-muted-foreground font-mono">
                    <span>{String(Math.floor(currentTime / 60)).padStart(2, '0')}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}</span>
                    <span>{String(Math.floor(audioData.duration / 60)).padStart(2, '0')}:{String(Math.floor(audioData.duration % 60)).padStart(2, '0')}</span>
                  </div>
                </div>
              )}

              {/* Controls */}
              <div className="flex items-center justify-center gap-4">
                <Button variant="outline" size="icon" onClick={() => skipTime(-5)}>
                  <SkipBack className="h-4 w-4" />
                </Button>

                <Button size="icon" onClick={togglePlayPause} className="h-12 w-12">
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                </Button>

                <Button variant="outline" size="icon" onClick={() => skipTime(5)}>
                  <SkipForward className="h-4 w-4" />
                </Button>

                <Button variant="outline" onClick={exportAudio} className="ml-4 bg-transparent">
                  <Download className="h-4 w-4 mr-2" />
                  Export WAV
                </Button>
              </div>

              {/* Hidden audio element */}
              <audio
                ref={audioRef}
                src={audioData.url}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            </CardContent>
          </Card>
        )}

        <Dialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Regenerate Audio Segment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Selected text:</p>
                <div className="p-3 bg-muted rounded-lg border-l-4 border-orange-500">
                  <p className="text-sm">"{selectedText}"</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                This will regenerate the audio for the selected text portion and show you a merge preview.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRegenerateDialog(false)}>
                Cancel
              </Button>
              <Button onClick={regenerateSelection} disabled={isRegenerating}>
                {isRegenerating ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Regenerate Selection
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Merge Preview Dialog */}
        <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Merge Audio</DialogTitle>
            </DialogHeader>
            {mergePreview && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-4">
                  {/* Selected Text */}
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Selected text:</p>
                    <div className="p-3 bg-muted rounded-lg border-l-4 border-teal-500">
                      <p className="text-sm font-medium">"{selectedText}"</p>
                    </div>
                  </div>

                  {/* Audio Segments */}
                  <div className="space-y-4">
                    {/* Original Audio Waveform (exact clip) */}
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <Volume2 className="h-4 w-4 text-orange-500" />
                        <span className="text-sm font-medium">Original Audio (selected clip)</span>
                        <div className="ml-auto">
                          <Button size="sm" variant="outline" onClick={() => {
                            const el = mergeOriginalAudioRef.current
                            if (!el) return
                            if (el.paused) { el.currentTime = 0; el.play() } else { el.pause() }
                          }}>
                            {(mergeOriginalAudioRef.current && !mergeOriginalAudioRef.current.paused) ? 'Pause' : 'Play'}
                          </Button>
                        </div>
                      </div>
                      <div className="w-full h-16 border rounded bg-muted/50 overflow-hidden">
                        {mergeOriginalClipBlob && (
                          <AudioVisualizer
                            blob={mergeOriginalClipBlob}
                            width={800}
                            height={64}
                            barWidth={2}
                            gap={1}
                            barColor="rgb(251, 146, 60)"
                            barPlayedColor="rgb(251, 146, 60)"
                            currentTime={mergeOriginalCurrentTime}
                            style={{ width: '100%', height: '100%' }}
                          />
                        )}
                      </div>
                    </div>

                    {/* New Regenerated Audio */}
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <Volume2 className="h-4 w-4 text-teal-500" />
                        <span className="text-sm font-medium">Regenerated Audio</span>
                        <div className="ml-auto">
                          <Button size="sm" variant="outline" onClick={() => {
                            const el = mergeNewAudioRef.current
                            if (!el) return
                            if (el.paused) { el.currentTime = 0; el.play() } else { el.pause() }
                          }}>
                            {(mergeNewAudioRef.current && !mergeNewAudioRef.current.paused) ? 'Pause' : 'Play'}
                          </Button>
                        </div>
                      </div>
                      <div className="w-full h-16 border rounded bg-muted/50 overflow-hidden">
                        {mergePreview.newSegment.blob && (
                          <AudioVisualizer
                            blob={mergePreview.newSegment.blob}
                            width={800}
                            height={64}
                            barWidth={2}
                            gap={1}
                            barColor="rgb(20, 184, 166)"
                            barPlayedColor="rgb(20, 184, 166)"
                            currentTime={mergeNewCurrentTime}
                            style={{ width: '100%', height: '100%' }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    The regenerated audio will replace the selected portion. You can preview both versions above before merging.
                  </p>
                </div>

                {/* Hidden audio elements for preview */}
                <audio
                  ref={mergeOriginalAudioRef}
                  src={mergeOriginalClipUrl}
                  onTimeUpdate={() => setMergeOriginalCurrentTime(mergeOriginalAudioRef.current?.currentTime || 0)}
                  onEnded={() => setMergeOriginalCurrentTime(0)}
                  style={{ display: 'none' }}
                />
                <audio
                  ref={mergeNewAudioRef}
                  src={mergePreview.newSegment.audioUrl}
                  onTimeUpdate={() => setMergeNewCurrentTime(mergeNewAudioRef.current?.currentTime || 0)}
                  onEnded={() => setMergeNewCurrentTime(0)}
                  style={{ display: 'none' }}
                />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowMergeDialog(false)
                setMergePreview(null)
              }}>
                Cancel
              </Button>
              <Button onClick={confirmMerge} className="bg-teal-600 hover:bg-teal-700 text-white">
                Merge Audio
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Export Dialog */}
        <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Export Audio</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="filename">Filename:</Label>
                <Input
                  id="filename"
                  value={exportFilename}
                  onChange={(e) => setExportFilename(e.target.value)}
                  placeholder="Enter filename"
                  className="font-mono"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 rounded text-blue-800 dark:text-blue-200 font-mono">
                  WAV
                </span>
                <span>Only supports WAV encoding.</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowExportDialog(false)}>
                Cancel
              </Button>
              <Button onClick={confirmExport} disabled={isExporting || !exportFilename.trim()}>
                {isExporting ? (
                  <>
                    <Download className="h-4 w-4 mr-2 animate-pulse" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
