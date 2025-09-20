import { useState, useRef, useCallback, useMemo } from 'react'
import { AudioData } from '@/lib/types'
import { 
  buildScriptTranscriptAlignment,
  findTranscriptIndexAtTime,
  getTranscriptLexicalWords,
  mapTranscriptIndexToScript
} from '@/lib/timing-helpers'

export const useAudioPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [highlightedWordIndex, setHighlightedWordIndex] = useState(-1)
  const audioRef = useRef<HTMLAudioElement>(null)
  const lastWordsSigRef = useRef<string>('')
  const lastTranscriptSigRef = useRef<string>('')
  const alignmentCacheRef = useRef<ReturnType<typeof buildScriptTranscriptAlignment> | null>(null)

  const getOrBuildAlignment = useCallback((
    words: string[],
    transcript: AudioData['transcript']
  ) => {
    // Build lightweight signatures to avoid recomputing on every timeupdate
    const wordsSig = (() => {
      const len = words.length
      if (len === 0) return 'w:0'
      const first = words.slice(0, Math.min(10, len)).join('\u241F')
      const last = words.slice(Math.max(0, len - 10)).join('\u241F')
      return `w:${len}|${first}|${last}`
    })()
    const transcriptSig = (() => {
      if (!transcript || !transcript.words || transcript.words.length === 0) return 't:0'
      const len = transcript.words.length
      const first = transcript.words[0]
      const last = transcript.words[len - 1]
      return `t:${len}|${first.start}:${first.end}|${last.start}:${last.end}`
    })()

    const sameWords = lastWordsSigRef.current === wordsSig
    const sameTranscript = lastTranscriptSigRef.current === transcriptSig
    if (sameWords && sameTranscript && alignmentCacheRef.current) {
      return alignmentCacheRef.current
    }
    const built = buildScriptTranscriptAlignment(words, transcript)
    alignmentCacheRef.current = built
    lastWordsSigRef.current = wordsSig
    lastTranscriptSigRef.current = transcriptSig
    return built
  }, [])

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
    const transcript = audioData?.transcript
    if (transcript) {
      const alignment = getOrBuildAlignment(words, transcript)
      const lex = getTranscriptLexicalWords(transcript)
      const tIdx = alignment.scriptToTranscript[wordIndex] ?? -1
      if (tIdx !== -1 && tIdx < lex.length) {
        startTime = lex[tIdx].start
      } else {
        const totalDuration = audioRef.current.duration || audioData?.duration || 0
        const progress = wordIndex / Math.max(1, words.length)
        startTime = progress * totalDuration
      }
    } else {
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

    // Use transcript timing with alignment for accurate highlighting
    let highlightIndex = -1
    const transcript = audioData?.transcript
    if (transcript) {
      const alignment = getOrBuildAlignment(words, transcript)
      const tIdx = findTranscriptIndexAtTime(transcript, time)
      if (tIdx !== -1) {
        const sIdx = mapTranscriptIndexToScript(tIdx, alignment)
        if (sIdx !== -1) {
          highlightIndex = Math.max(0, Math.min(words.length - 1, sIdx))
        }
      }
    }

    // Fallback to uniform mapping if mapping fails
    if (highlightIndex === -1) {
      const duration = Math.max(1e-6, audioRef.current.duration || audioData?.duration || 0)
      const progress = duration > 0 ? time / duration : 0
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
