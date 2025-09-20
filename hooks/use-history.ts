import { useState, useCallback } from 'react'
import { HistoryState, AudioData, AudioSegment, TranscriptData } from '@/lib/types'

const MAX_HISTORY_SIZE = 15

export const useHistory = () => {
  const [history, setHistory] = useState<HistoryState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  // Deep clone helpers to ensure snapshots are immutable and reliable
  const cloneTranscript = (t: TranscriptData | null | undefined): TranscriptData | null => {
    if (!t) return null
    return {
      language_code: t.language_code,
      language_probability: t.language_probability,
      text: t.text,
      words: Array.isArray(t.words)
        ? t.words.map(w => ({ text: w.text, start: w.start, end: w.end, type: w.type, speaker_id: w.speaker_id, logprob: w.logprob }))
        : [],
    }
  }

  const cloneAudioData = (a: AudioData | null): AudioData | null => {
    if (!a) return null
    return {
      url: a.url,
      duration: a.duration,
      waveform: Array.isArray(a.waveform) ? [...a.waveform] : a.waveform,
      blob: a.blob, // Blob is immutable, safe to reference
      transcript: cloneTranscript(a.transcript ?? null),
    }
  }

  const cloneAudioSegment = (s: AudioSegment): AudioSegment => ({
    startIndex: s.startIndex,
    endIndex: s.endIndex,
    audioUrl: s.audioUrl,
    waveform: Array.isArray(s.waveform) ? [...s.waveform] : s.waveform,
    blob: s.blob,
    startTime: s.startTime,
    endTime: s.endTime,
    durationSec: s.durationSec,
    transcript: cloneTranscript(s.transcript ?? null),
    text: s.text,
  })

  const cloneHistoryState = (state: HistoryState): HistoryState => ({
    script: state.script,
    audioData: cloneAudioData(state.audioData),
    audioSegments: state.audioSegments.map(cloneAudioSegment),
    timestamp: state.timestamp,
    action: state.action,
  })

  const saveToHistory = useCallback((
    action: string,
    script: string,
    audioData: AudioData | null,
    audioSegments: AudioSegment[]
  ) => {
    const now = Date.now()
    const snapshot: HistoryState = {
      script,
      audioData: cloneAudioData(audioData),
      audioSegments: audioSegments.map(cloneAudioSegment),
      timestamp: now,
      action,
    }

    setHistory((prev) => {
      // Truncate any redo branch based on the current index
      const truncated = prev.slice(0, Math.max(0, historyIndex) + 1)
      const appended = [...truncated, snapshot]
      const trimmed = appended.length > MAX_HISTORY_SIZE
        ? appended.slice(appended.length - MAX_HISTORY_SIZE)
        : appended

      // Move index to the latest entry
      setHistoryIndex(trimmed.length - 1)
      return trimmed
    })
  }, [historyIndex])

  const undo = useCallback((): HistoryState | null => {
    if (historyIndex <= 0) return null

    const previousState = history[historyIndex - 1]
    setHistoryIndex(historyIndex - 1)
    return cloneHistoryState(previousState)
  }, [history, historyIndex])

  const redo = useCallback((): HistoryState | null => {
    if (historyIndex >= history.length - 1) return null

    const nextState = history[historyIndex + 1]
    setHistoryIndex(historyIndex + 1)
    return cloneHistoryState(nextState)
  }, [history, historyIndex])

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  return {
    history,
    historyIndex,
    saveToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  }
}
