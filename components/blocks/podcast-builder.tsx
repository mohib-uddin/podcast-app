"use client"

import { useState, useEffect, useMemo } from "react"
import { AudioData, AudioSegment, MergePreview } from "@/lib/types"
import { resolveTimingForSelection } from "@/lib/timing-helpers"
import { 
  generateTranscriptForAudio, 
  AudioSegmentReplacer, 
  createMergedAudio,
  generateDefaultFilename
} from "@/lib/audio-helpers"
import { useAudioPlayer } from "@/hooks/use-audio-player"
import { useHistory } from "@/hooks/use-history"

// Components
import { ScriptEditor } from "@/components/script-editor"
import { ScriptPlayback } from "@/components/script-playback"
import { AudioPlayer } from "@/components/audio-player"
import { HistoryPanel } from "@/components/history-panel"
import { RegenerateDialog } from "@/components/dialogs/regenerate-dialog"
import { MergeDialog } from "@/components/dialogs/merge-dialog"
import { ExportDialog } from "@/components/dialogs/export-dialog"

export default function PodcastBuilder() {
  // Main state
  const [script, setScript] = useState("")
  const [audioData, setAudioData] = useState<AudioData | null>(null)
  const [audioSegments, setAudioSegments] = useState<AudioSegment[]>([])
  
  // UI state
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedText, setSelectedText] = useState("")
  const [selectedStartIndex, setSelectedStartIndex] = useState<number | null>(null)
  const [selectedEndIndex, setSelectedEndIndex] = useState<number | null>(null)
  
  // Dialog state
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null)
  const [mergePreviewUrl, setMergePreviewUrl] = useState<string>("")
  const [mergePreviewBlob, setMergePreviewBlob] = useState<Blob | null>(null)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportFilename, setExportFilename] = useState("")
  const [isExporting, setIsExporting] = useState(false)

  // Custom hooks
  const {
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
  } = useAudioPlayer()

  const {
    history,
    historyIndex,
    saveToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory()

  // Audio processing instance
  const audioSegmentReplacer = useMemo(() => new AudioSegmentReplacer(), [])

  // Derived data
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

  // Generate audio
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

      // Create blob from the audio URL
      const audioBlob = await fetch(data.url).then(res => res.blob())
      
      // Generate transcript for the original audio
      const originalTranscript = await generateTranscriptForAudio(audioBlob)

      const audioDataWithBlob = { 
        ...data, 
        blob: audioBlob,
        transcript: originalTranscript
      }

      setAudioData(audioDataWithBlob)
      setAudioSegments([])

      saveToHistory("Generate Audio", script, audioDataWithBlob, [])
    } catch (error) {
      console.error("Error generating audio:", error)
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsGenerating(false)
    }
  }

  // Handle text selection
  const handleTextSelection = () => {
    // Add a small delay to ensure selection is complete on mobile
    setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return

      const text = selection.toString().trim()
      if (!text) return

      const getIndexFromNode = (node: Node | null): number | null => {
        if (!node) return null
        let el: HTMLElement | null = (node as HTMLElement).nodeType === 1 ? (node as HTMLElement) : (node.parentElement as HTMLElement | null)
        while (el) {
          if (el.dataset && el.dataset.wordIndex) return parseInt(el.dataset.wordIndex, 10)
          el = el.parentElement
        }
        return null
      }

      const anchorIndex = getIndexFromNode(selection.anchorNode)
      const focusIndex = getIndexFromNode(selection.focusNode)
      if (anchorIndex === null || focusIndex === null) return

      const startIdx = Math.max(0, Math.min(anchorIndex, focusIndex))
      const endIdxExclusive = Math.min(words.length, Math.max(anchorIndex, focusIndex) + 1)

      const selected = words.slice(startIdx, endIdxExclusive).join(" ")

      setSelectedText(selected)
      setSelectedStartIndex(startIdx)
      setSelectedEndIndex(endIdxExclusive)
      setShowRegenerateDialog(true)
    }, 100) // Small delay for mobile devices
  }

  // Play selected text
  const playSelectedText = () => {
    if (selectedStartIndex === null) return
    playFromWordIndex(selectedStartIndex, words, audioData)
  }

  // Regenerate selection
  const regenerateSelection = async () => {
    if (!selectedText.trim() || !audioData || selectedStartIndex === null || selectedEndIndex === null) return

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

      // Get timing for the selection
      const timing = resolveTimingForSelection(
        selectedText,
        selectedStartIndex,
        selectedEndIndex,
        words,
        audioData.transcript
      )

      if (!timing) {
        alert('Could not precisely locate the selected sentence in the original transcript. Please adjust your selection and try again.')
        setIsRegenerating(false)
        return
      }

      // Create blob and generate transcript
      const audioBlob = await fetch(data.url).then(res => res.blob())
      const regeneratedTranscript = await generateTranscriptForAudio(audioBlob)

      // Create new audio segment
      const newSegment: AudioSegment = {
        startIndex: selectedStartIndex,
        endIndex: selectedEndIndex,
        audioUrl: data.url,
        waveform: data.waveform,
        blob: audioBlob,
        startTime: timing.startTime,
        endTime: timing.endTime,
        durationSec: data.duration,
        transcript: regeneratedTranscript,
        text: selectedText,
      }

      // Find existing segment that overlaps
      const existingSegment = audioSegments.find(
        (seg) => seg.startIndex < selectedEndIndex && seg.endIndex > selectedStartIndex
      )

      // Create merge preview
      setMergePreview({
        originalSegment: existingSegment || null,
        newSegment,
        mergedAudio: null,
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

  // Create merged audio from current segments
  const createMergedFromCurrent = async (segment: AudioSegment): Promise<string> => {
    if (!audioData || !segment.blob) return ""
    
    try {
      const timing = resolveTimingForSelection(
        segment.text || "",
        segment.startIndex,
        segment.endIndex,
        words,
        audioData.transcript
      )

      if (!timing) {
        alert('Could not precisely locate the selected sentence in the original transcript.')
        return ""
      }

      const mergedBlob = await audioSegmentReplacer.replaceAudioSegment(
        audioData.url,
        segment.blob,
        timing.startTime,
        timing.endTime
      )
      
      return URL.createObjectURL(mergedBlob)
    } catch (error) {
      console.error('Error creating merged preview:', error)
      return ""
    }
  }

  // Confirm merge
  const confirmMerge = async () => {
    if (!mergePreview) return

    setIsMerging(true)
    try {
      // Create the merged audio and apply it to main audio
      const mergedUrl = await createMergedFromCurrent(mergePreview.newSegment)
      if (mergedUrl) {
        // Decode to get accurate duration and blob
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        const resp = await fetch(mergedUrl)
        const buf = await audioContext.decodeAudioData(await resp.arrayBuffer())
        const mergedBlob = audioSegmentReplacer.audioBufferToWavBlob(buf)
        
        // Re-transcribe the merged audio
        const mergedTranscript = await generateTranscriptForAudio(mergedBlob)

        const nextAudioData = { 
          url: URL.createObjectURL(mergedBlob), 
          duration: buf.duration, 
          waveform: audioData!.waveform, 
          blob: mergedBlob,
          transcript: mergedTranscript || audioData!.transcript || null,
        } as const

        setAudioData(nextAudioData)
      }

      // Update segments
      const newSegment = mergePreview.newSegment
      const filtered = audioSegments.filter((seg) => {
        return seg.endIndex <= newSegment.startIndex || seg.startIndex >= newSegment.endIndex
      })
      const nextSegments = [...filtered, newSegment].sort((a, b) => a.startIndex - b.startIndex)

      setAudioSegments(nextSegments)

      setShowMergeDialog(false)
      setMergePreview(null)
      
      const segmentText = selectedText.substring(0, 20) + (selectedText.length > 20 ? "..." : "")
      // Save the post-merge state snapshot to history for reliable undo/redo
      saveToHistory(`Merge "${segmentText}"`, script, {
        url: audioData?.url || '',
        duration: audioData?.duration || 0,
        waveform: audioData?.waveform || [],
        blob: audioData?.blob,
        transcript: audioData?.transcript || null,
      }, nextSegments)
    } catch (error) {
      console.error("Error merging audio:", error)
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsMerging(false)
    }
  }

  // Export audio
  const exportAudio = async () => {
    if (!audioData) return
    const defaultFilename = generateDefaultFilename(script)
    setExportFilename(defaultFilename)
    setShowExportDialog(true)
  }

  const confirmExport = async () => {
    if (!audioData) return

    setIsExporting(true)
    try {
      let finalAudioUrl = audioData.url
      
      // If there are audio segments, merge them first
      if (audioSegments.length > 0) {
        finalAudioUrl = await createMergedAudio(
          audioData,
          audioSegments,
          audioSegmentReplacer,
          resolveTimingForSelection
        )
      }
      
      // Convert to WAV format
      const response = await fetch(finalAudioUrl)
      const arrayBuffer = await response.arrayBuffer()
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const buffer = await audioContext.decodeAudioData(arrayBuffer)
      const blob = audioSegmentReplacer.audioBufferToWavBlob(buffer)
      
      // Create download link
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${exportFilename}.wav`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
      // Clean up merged URL if it's different from original
      if (finalAudioUrl !== audioData.url) {
        URL.revokeObjectURL(finalAudioUrl)
      }
      
      setShowExportDialog(false)
      setExportFilename("")
    } catch (error) {
      console.error("Error exporting audio:", error)
      alert(`Error exporting: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsExporting(false)
    }
  }

  // Handle undo/redo
  const handleUndo = () => {
    const previousState = undo()
    if (previousState) {
      setScript(previousState.script)
      setAudioData(previousState.audioData)
      setAudioSegments([...previousState.audioSegments])
      resetPlayback()
    }
  }

  const handleRedo = () => {
    const nextState = redo()
    if (nextState) {
      setScript(nextState.script)
      setAudioData(nextState.audioData)
      setAudioSegments([...nextState.audioSegments])
      resetPlayback()
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [historyIndex, history])

  // Setup merge preview
  useEffect(() => {
    const setupMergePreview = async () => {
      if (!showMergeDialog || !mergePreview) return
      try {
        const url = await createMergedFromCurrent(mergePreview.newSegment)
        setMergePreviewUrl(url)
        const blob = await fetch(url).then(r => r.blob())
        setMergePreviewBlob(blob)
      } catch (e) {
        console.warn('Failed to create merge preview:', e)
      }
    }
    setupMergePreview()
    return () => {
      if (mergePreviewUrl) URL.revokeObjectURL(mergePreviewUrl)
    }
  }, [showMergeDialog, mergePreview])

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

        <HistoryPanel
          history={history}
          historyIndex={historyIndex}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />

        <ScriptEditor
          script={script}
          onScriptChange={setScript}
          onGenerateAudio={generateAudio}
          isGenerating={isGenerating}
        />

        {audioData && (
          <ScriptPlayback
            words={words}
            highlightedWordIndex={highlightedWordIndex}
            isWordHighlighted={isWordHighlighted}
            selectedText={selectedText}
            audioData={audioData}
            onTextSelection={handleTextSelection}
            onPlaySelectedText={playSelectedText}
            onShowRegenerateDialog={() => setShowRegenerateDialog(true)}
          />
        )}

        {audioData && (
          <AudioPlayer
            ref={audioRef}
            audioData={audioData}
            audioSegments={audioSegments}
            words={words}
            isPlaying={isPlaying}
            currentTime={currentTime}
            onTogglePlayPause={togglePlayPause}
            onSkipTime={skipTime}
            onExportAudio={exportAudio}
            onTimeUpdate={() => handleTimeUpdate(words, audioData)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          />
        )}

        <RegenerateDialog
          open={showRegenerateDialog}
          onOpenChange={setShowRegenerateDialog}
          selectedText={selectedText}
          isRegenerating={isRegenerating}
          onRegenerate={regenerateSelection}
        />

        <MergeDialog
          open={showMergeDialog}
          onOpenChange={setShowMergeDialog}
          mergePreview={mergePreview}
          selectedText={selectedText}
          onConfirmMerge={confirmMerge}
          mergePreviewUrl={mergePreviewUrl}
          mergePreviewBlob={mergePreviewBlob}
          isMerging={isMerging}
          originalAudioBlob={audioData?.blob}
          originalAudioDurationSec={audioData?.duration}
        />

        <ExportDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          exportFilename={exportFilename}
          onFilenameChange={setExportFilename}
          isExporting={isExporting}
          onExport={confirmExport}
        />
      </div>
    </div>
  )
}
