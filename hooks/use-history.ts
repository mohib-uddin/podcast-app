import { useState, useCallback } from 'react'
import { HistoryState, AudioData, AudioSegment } from '@/lib/types'

const MAX_HISTORY_SIZE = 15

export const useHistory = () => {
  const [history, setHistory] = useState<HistoryState[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const saveToHistory = useCallback((
    action: string,
    script: string,
    audioData: AudioData | null,
    audioSegments: AudioSegment[]
  ) => {
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
      if (newHistory.length > MAX_HISTORY_SIZE) {
        newHistory.shift()
        return newHistory
      }

      return newHistory
    })

    setHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY_SIZE - 1))
  }, [historyIndex])

  const undo = useCallback((): HistoryState | null => {
    if (historyIndex <= 0) return null

    const previousState = history[historyIndex - 1]
    setHistoryIndex(historyIndex - 1)
    return previousState
  }, [history, historyIndex])

  const redo = useCallback((): HistoryState | null => {
    if (historyIndex >= history.length - 1) return null

    const nextState = history[historyIndex + 1]
    setHistoryIndex(historyIndex + 1)
    return nextState
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
