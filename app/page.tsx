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
import Crunker from "crunker"
import Fuse from "fuse.js"

interface WordTiming {
  text: string
  start: number
  end: number
  type: "word"
  speaker_id: string
  logprob: number
}

interface TranscriptData {
  language_code: string
  language_probability: number
  text: string
  words: WordTiming[]
}

interface AudioData {
  url: string
  duration: number
  waveform: number[]
  blob?: Blob
  transcript?: TranscriptData | null
}

interface AudioSegment {
  startIndex: number
  endIndex: number
  audioUrl: string
  waveform: number[]
  blob?: Blob
  startTime: number
  endTime: number
  durationSec?: number
  transcript?: TranscriptData | null
  text?: string
}

  // Normalize a word token for alignment (lowercase, strip punctuation)
  const normalizeToken = (t: string): string => t.toLowerCase().replace(/[^a-z0-9']/gi, '').trim()
  const tokenize = (s: string): string[] => s.split(/\s+/).map(normalizeToken).filter(Boolean)

  // Extract only lexical words (exclude spacing/punctuation entries)
  const getTranscriptLexicalWords = (transcript?: TranscriptData | null): { text: string; start: number; end: number }[] => {
    if (!transcript || !transcript.words) return []
    return transcript.words
      .filter((w) => w.type === 'word')
      .map((w) => ({ text: normalizeToken(w.text), start: w.start, end: w.end }))
      .filter((w) => w.text.length > 0)
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
  const [selectedStartIndex, setSelectedStartIndex] = useState<number | null>(null)
  const [selectedEndIndex, setSelectedEndIndex] = useState<number | null>(null)
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
  const mergePreviewAudioRef = useRef<HTMLAudioElement>(null)

  const [mergeOriginalClipUrl, setMergeOriginalClipUrl] = useState<string>("")
  const [mergeOriginalClipBlob, setMergeOriginalClipBlob] = useState<Blob | null>(null)
  const [mergeOriginalCurrentTime, setMergeOriginalCurrentTime] = useState(0)
  const [mergeNewCurrentTime, setMergeNewCurrentTime] = useState(0)
  const [mergePreviewCurrentTime, setMergePreviewCurrentTime] = useState(0)
  const [mergePreviewUrl, setMergePreviewUrl] = useState<string>("")
  const [mergePreviewBlob, setMergePreviewBlob] = useState<Blob | null>(null)

  const words = script.split(/\s+/).filter((word) => word.length > 0)

  // Utility function to get precise word timing from transcript
  const getWordTimingFromTranscript = (wordIndex: number, transcript?: TranscriptData | null): { start: number; end: number } | null => {
    const lex = getTranscriptLexicalWords(transcript)
    if (lex.length === 0) {
      return null
    }

    // Map script word index to transcript word
    if (wordIndex >= 0 && wordIndex < lex.length) {
      const word = lex[wordIndex]
      return { start: word.start, end: word.end }
    }

    return null
  }

  // Function to find word range timing from transcript
  const getWordRangeTimingFromTranscript = (
    startIndex: number, 
    endIndex: number, 
    transcript?: TranscriptData | null
  ): { startTime: number; endTime: number } | null => {
    const lex = getTranscriptLexicalWords(transcript)
    if (lex.length === 0) {
      return null
    }

    // Validate indices
    if (startIndex < 0 || endIndex <= startIndex || startIndex >= lex.length) {
      return null
    }

    const clampedStart = Math.max(0, Math.min(startIndex, lex.length - 1))
    const clampedEnd = Math.max(clampedStart, Math.min(endIndex - 1, lex.length - 1))

    const startWord = lex[clampedStart]
    const endWord = lex[clampedEnd]

    if (startWord && endWord && typeof startWord.start === 'number' && typeof endWord.end === 'number') {
      // Ensure valid timing values
      const startTime = Math.max(0, startWord.start)
      const endTime = Math.max(startTime, endWord.end)
      
      return {
        startTime,
        endTime
      }
    }

    return null
  }

  // Align a script word span to transcript by normalized token sequence
  const getTimingByTokenMatch = (
    scriptWords: string[],
    startIndex: number,
    endIndex: number,
    transcript?: TranscriptData | null
  ): { startTime: number; endTime: number } | null => {
    const lex = getTranscriptLexicalWords(transcript)
    if (lex.length === 0) return null
    const selTokens = scriptWords.slice(startIndex, endIndex).map(normalizeToken).filter(Boolean)
    if (selTokens.length === 0) return null
    const tTokens = lex.map(w => w.text)
    // sliding window match
    for (let i = 0; i + selTokens.length <= tTokens.length; i++) {
      let ok = true
      for (let k = 0; k < selTokens.length; k++) {
        if (selTokens[k] !== tTokens[i + k]) { ok = false; break }
      }
      if (ok) {
        const startWord = lex[i]
        const endWord = lex[i + selTokens.length - 1]
        if (startWord && endWord) return { startTime: startWord.start, endTime: endWord.end }
      }
    }
    return null
  }

  // Align by raw sentence substring inside transcript text (lowercased, squashed spaces)
  const getTimingBySentenceSubstring = (
    sentence: string | undefined,
    transcript?: TranscriptData | null
  ): { startTime: number; endTime: number } | null => {
    if (!sentence || !transcript || !transcript.text) return null
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const needle = norm(sentence)
    const hay = norm(transcript.text)
    if (!needle || !hay) return null

    // Try to map the substring back to a word span
    const lex = getTranscriptLexicalWords(transcript)
    const built = lex.map(w => w.text).join(' ')
    const pos = built.indexOf(needle.replace(/[^a-z0-9']/gi, ' '))
    if (pos < 0) return null
    // Approximate: count tokens up to pos and length
    const preTokens = built.slice(0, pos).split(' ').filter(Boolean).length
    const lenTokens = needle.split(' ').filter(Boolean).length
    const startIdx = preTokens
    const endIdx = Math.min(lex.length, startIdx + Math.max(1, lenTokens))
    const startWord = lex[startIdx]
    const endWord = lex[endIdx - 1]
    if (startWord && endWord) return { startTime: startWord.start, endTime: endWord.end }
    return null
  }

  // Exact consecutive window match on tokens with optional bias toward hint index
  const getTimingByExactTokenWindow = (
    sentence: string | undefined,
    transcript?: TranscriptData | null,
    hintStartIndex?: number
  ): { startTime: number; endTime: number } | null => {
    const lex = getTranscriptLexicalWords(transcript)
    if (!sentence || lex.length === 0) return null
    const target = tokenize(sentence)
    if (target.length === 0) return null
    const tokens = lex.map(w => w.text)
    const N = tokens.length
    const L = target.length
    if (L > N) return null
    let bestIdx = -1
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i + L <= N; i++) {
      let ok = true
      for (let k = 0; k < L; k++) { if (tokens[i + k] !== target[k]) { ok = false; break } }
      if (!ok) continue
      const dist = hintStartIndex !== undefined ? Math.abs(i - hintStartIndex) : 0
      if (bestIdx === -1 || dist < bestDist) { bestIdx = i; bestDist = dist }
    }
    if (bestIdx < 0) return null
    const startWord = lex[bestIdx]
    const endWord = lex[Math.min(N - 1, bestIdx + L - 1)]
    if (startWord && endWord) return { startTime: startWord.start, endTime: endWord.end }
    return null
  }

  // Robust fuzzy search for sentence matching using Fuse.js with strict parameters
  const getTimingByStrictFuzzyMatch = (
    sentence: string | undefined,
    transcript?: TranscriptData | null,
    hintStartIndex?: number
  ): { startTime: number; endTime: number } | null => {
    if (!sentence || !transcript || !transcript.words || transcript.words.length === 0) return null
    
    const targetTokens = tokenize(sentence)
    if (targetTokens.length === 0) return null
    const targetText = targetTokens.join(' ')
    
    // Create sliding windows for all possible consecutive word sequences
    const windows: Array<{
      text: string
      normalizedText: string
      startIndex: number
      endIndex: number
      startTime: number
      endTime: number
      wordCount: number
      exactLength: boolean
    }> = []
    
    const lex = getTranscriptLexicalWords(transcript)
    const words = lex
    // Allow small length variation (+/-2 words) but keep order strict
    const maxWindowSize = Math.min(words.length, targetTokens.length + 2)
    const minWindowSize = Math.max(1, targetTokens.length - 2)
    
    for (let size = minWindowSize; size <= maxWindowSize; size++) {
      for (let i = 0; i <= words.length - size; i++) {
        const windowWords = words.slice(i, i + size)
        const windowTokens = windowWords.map(w => normalizeToken(w.text)).filter(Boolean)
        const normalizedText = windowTokens.join(' ')
        
        if (normalizedText.length === 0) continue
        
        windows.push({
          text: windowWords.map(w => w.text).join(' '),
          normalizedText,
          startIndex: i,
          endIndex: i + size,
          startTime: windowWords[0].start,
          endTime: windowWords[windowWords.length - 1].end,
          wordCount: size,
          exactLength: size === targetTokens.length
        })
      }
    }
    
    if (windows.length === 0) return null
    
    // Configure Fuse.js for very strict matching
    const fuse = new Fuse(windows, {
      keys: ['normalizedText'],
      threshold: 0.2,
      distance: 60,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: Math.max(3, Math.floor(targetText.length * 0.7)),
      shouldSort: true,
      findAllMatches: false,
      ignoreLocation: false,
      ignoreFieldNorm: false,
      fieldNormWeight: 1.2 // Boost field norm weight for better scoring
    })
    
    const results = fuse.search(targetText)
    
    if (results.length === 0) return null
    
    // Score and rank results with multiple criteria
    const scoredResults = results.map(result => {
      const item = result.item
      const fuseScore = result.score || 1
      
      // Exact length match bonus
      const lengthBonus = item.exactLength ? -0.1 : 0
      
      // Position bias toward hint index
      const positionBias = hintStartIndex !== undefined 
        ? Math.min(0.05, Math.abs(item.startIndex - hintStartIndex) / Math.max(1, words.length)) 
        : 0
      
      // Word count similarity
      const wordCountDiff = Math.abs(item.wordCount - targetTokens.length)
      const wordCountPenalty = wordCountDiff * 0.05
      
      // Character length similarity
      const lengthDiff = Math.abs(item.normalizedText.length - targetText.length)
      const lengthPenalty = lengthDiff / Math.max(1, targetText.length) * 0.1
      
      // Combined score (lower is better)
      const combinedScore = fuseScore + wordCountPenalty + lengthPenalty + positionBias + lengthBonus
      
      return {
        ...result,
        combinedScore,
        lengthMatch: item.exactLength,
        wordCountDiff
      }
    })
    
    // Sort by combined score
    scoredResults.sort((a, b) => {
      // Prioritize exact length matches
      if (a.lengthMatch && !b.lengthMatch) return -1
      if (!a.lengthMatch && b.lengthMatch) return 1
      
      // Then by combined score
      return a.combinedScore - b.combinedScore
    })
    
    const bestMatch = scoredResults[0]
    
    // Very strict acceptance criteria
    const maxAcceptableScore = 0.22
    const maxWordCountDiff = Math.min(2, Math.ceil(targetTokens.length * 0.15))
    
    if (!bestMatch || 
        bestMatch.combinedScore > maxAcceptableScore || 
        bestMatch.wordCountDiff > maxWordCountDiff) {
      return null
    }
    
    return {
      startTime: bestMatch.item.startTime,
      endTime: bestMatch.item.endTime
    }
  }

  // Function to validate transcript data integrity
  const validateTranscriptData = (transcript: TranscriptData | null): transcript is TranscriptData => {
    if (!transcript) return false
    
    if (!transcript.words || !Array.isArray(transcript.words)) return false
    
    // Check if words have valid timing data
    return transcript.words.every(word => 
      typeof word.start === 'number' && 
      typeof word.end === 'number' && 
      word.start >= 0 && 
      word.end >= word.start &&
      typeof word.text === 'string' &&
      word.text.length > 0
    )
  }

  // Function to generate transcript for regenerated audio
  const generateTranscriptForAudio = async (audioBlob: Blob): Promise<TranscriptData | null> => {
    try {
      const formData = new FormData()
      formData.append('file', audioBlob, 'audio.mp3')
      formData.append('model_id', 'scribe_v1')

      const response = await fetch('/api/speech-to-text', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        console.warn('Failed to generate transcript for regenerated audio')
        return null
      }

      const data = await response.json()
      const transcript = data.transcript || null
      
      // Validate transcript data before returning
      return validateTranscriptData(transcript) ? transcript : null
    } catch (error) {
      console.warn('Error generating transcript for regenerated audio:', error)
      return null
    }
  }

  // Retime regenerated segment to match original per-word durations exactly.
  // Returns null if alignment fails, so caller can fallback.
  const retimeSegmentToOriginalWindow = async (
    newBuffer: AudioBuffer,
    regenerated: TranscriptData | null,
    original: TranscriptData | null,
    startWordIndex: number,
    endWordIndex: number
  ): Promise<AudioBuffer | null> => {
    try {
      if (!regenerated || !original) return null
      const srcWords = regenerated.words
      const tgtWords = original.words.slice(startWordIndex, Math.max(startWordIndex, endWordIndex))
      if (!srcWords || !tgtWords || srcWords.length === 0 || tgtWords.length === 0) return null

      // Simple strict alignment: same count and same tokens after normalization
      const srcTokens = srcWords.map(w => normalizeToken(w.text)).filter(Boolean)
      const tgtTokens = tgtWords.map(w => normalizeToken(w.text)).filter(Boolean)
      if (srcTokens.length !== tgtTokens.length) return null
      for (let i = 0; i < srcTokens.length; i++) {
        if (srcTokens[i] !== tgtTokens[i]) return null
      }

      const sampleRate = newBuffer.sampleRate
      const wordBuffers: AudioBuffer[] = []
      const gaps: number[] = []

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()

      const extractSlice = (startSec: number, endSec: number): AudioBuffer => {
        const s = Math.max(0, Math.floor(startSec * sampleRate))
        const e = Math.max(s, Math.floor(endSec * sampleRate))
        const len = Math.max(1, e - s)
        const out = ctx.createBuffer(newBuffer.numberOfChannels, len, sampleRate)
        for (let ch = 0; ch < newBuffer.numberOfChannels; ch++) {
          out.getChannelData(ch).set(newBuffer.getChannelData(ch).subarray(s, e))
        }
        return out
      }

      const timeScale = async (slice: AudioBuffer, targetSec: number): Promise<AudioBuffer> => {
        const targetLen = Math.max(1, Math.floor(targetSec * sampleRate))
        if (targetLen === slice.length) return slice
        const offline = new OfflineAudioContext(slice.numberOfChannels, targetLen, sampleRate)
        const src = offline.createBufferSource()
        src.buffer = slice
        const srcDur = slice.length / sampleRate
        // playbackRate so that rendered length == targetSec
        const rate = srcDur > 0 ? srcDur / Math.max(1e-6, targetSec) : 1
        src.playbackRate.value = rate
        src.connect(offline.destination)
        src.start(0)
        const rendered = await offline.startRendering()
        return rendered
      }

      // Build per-word retimed buffers and inter-word gaps to match original timings
      for (let i = 0; i < tgtWords.length; i++) {
        const srcW = srcWords[i]
        const tgtW = tgtWords[i]
        const srcSlice = extractSlice(srcW.start, srcW.end)
        const targetDur = Math.max(0, (tgtW.end - tgtW.start))
        const retimed = await timeScale(srcSlice, targetDur)
        wordBuffers.push(retimed)
        // Compute gap after this word in the original transcript
        const nextTgtStart = i < tgtWords.length - 1 ? tgtWords[i + 1].start : tgtW.end
        const gapSec = Math.max(0, nextTgtStart - tgtW.end)
        gaps.push(gapSec)
      }

      // Concatenate words + gaps (gaps are silence at exact durations)
      const totalSamples = wordBuffers.reduce((acc, b, idx) => acc + b.length + Math.floor(gaps[idx] * sampleRate), 0)
      const out = ctx.createBuffer(newBuffer.numberOfChannels, Math.max(1, totalSamples), sampleRate)
      let offset = 0
      for (let i = 0; i < wordBuffers.length; i++) {
        const wb = wordBuffers[i]
        for (let ch = 0; ch < out.numberOfChannels; ch++) {
          out.getChannelData(ch).set(wb.getChannelData(Math.min(ch, wb.numberOfChannels - 1)), offset)
        }
        offset += wb.length
        const gapSamp = Math.floor(gaps[i] * sampleRate)
        offset += gapSamp // silence is already zeros
      }
      return out
    } catch (e) {
      console.warn('retimeSegmentToOriginalWindow failed, falling back:', e)
      return null
    }
  }

  // Simple approach: rely on uniform mapping for highlighting and seeking (robust and predictable)

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
      
      // Always call our speech-to-text endpoint for the original audio blob
      const originalTranscript = await generateTranscriptForAudio(audioBlob)

      const audioDataWithBlob = { 
        ...data, 
        blob: audioBlob,
        transcript: originalTranscript || (validateTranscriptData(data.transcript) ? data.transcript : null)
      }

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

    const text = selection.toString().trim()
    if (!text) return

    const range = selection.getRangeAt(0)
    const getIndexFromNode = (node: Node | null): number | null => {
      if (!node) return null
      let el: HTMLElement | null = (node as HTMLElement).nodeType === 1 ? (node as HTMLElement) : (node.parentElement as HTMLElement | null)
      while (el && el !== textRef.current) {
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

    // Also keep legacy char offsets for any other consumers
    const before = words.slice(0, startIdx).join(" ")
    const sel = selected
    setSelectedText(sel)
    setSelectionStart(before.length)
    setSelectionEnd(before.length + sel.length)
    setSelectedStartIndex(startIdx)
    setSelectedEndIndex(endIdxExclusive)
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

      // Calculate time positions using precise transcript timing if available
      let startTime: number, endTime: number
      let preciseTimings = getWordRangeTimingFromTranscript(startWordIndex, endWordIndex, audioData.transcript)
      if (!preciseTimings) {
        // Use strict fuzzy search as primary method for sentence matching
        preciseTimings = getTimingByStrictFuzzyMatch(selectedText, audioData.transcript, startWordIndex)
      }
      // If still not found, retry fuzzy search with punctuation-relaxed selection
      if (!preciseTimings && selectedText) {
        const relaxed = selectedText.replace(/[^a-zA-Z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim()
        preciseTimings = getTimingByStrictFuzzyMatch(relaxed, audioData.transcript, startWordIndex)
      }
      if (!preciseTimings) {
        preciseTimings = getTimingByTokenMatch(words, startWordIndex, endWordIndex, audioData.transcript)
      }
      if (!preciseTimings) {
        // Use exact token window with bias toward expected index
        preciseTimings = getTimingByExactTokenWindow(selectedText, audioData.transcript, startWordIndex)
      }
      if (!preciseTimings) {
        // Last resort sentence substring
        preciseTimings = getTimingBySentenceSubstring(selectedText, audioData.transcript)
      }
      if (!preciseTimings) {
        alert('Could not precisely locate the selected sentence in the original transcript. Please adjust your selection and try again.')
        setIsRegenerating(false)
        return
      }
      startTime = preciseTimings.startTime
      endTime = preciseTimings.endTime

      // Create blob and decode duration for the regenerated audio
      const audioBlob = await fetch(data.url).then(res => res.blob())
      let decodedDuration = data.duration
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const buf = await ctx.decodeAudioData(await audioBlob.arrayBuffer())
        decodedDuration = buf.duration
      } catch {}

      // Generate transcript for the regenerated audio
      const regeneratedTranscript = await generateTranscriptForAudio(audioBlob)

      // Create new audio segment
      const newSegment: AudioSegment = {
        startIndex: startWordIndex,
        endIndex: endWordIndex,
        audioUrl: data.url,
        waveform: data.waveform,
        blob: audioBlob,
        startTime,
        endTime,
        durationSec: decodedDuration,
        transcript: regeneratedTranscript,
        text: selectedText,
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
    if (!audioRef.current || selectedStartIndex === null) return
    
    // Use precise timing if available from transcript
    let startTime: number
    const preciseStartTiming = getWordTimingFromTranscript(selectedStartIndex, audioData?.transcript)
    
    if (preciseStartTiming) {
      startTime = preciseStartTiming.start
    } else {
      // Fallback to uniform mapping
      const totalDuration = audioRef.current.duration || audioData?.duration || 0
      const progress = selectedStartIndex / Math.max(1, words.length)
      startTime = progress * totalDuration
    }
    
    audioRef.current.currentTime = startTime
    audioRef.current.play()
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
      let finalAudioUrl = audioData.url
      
      // If there are audio segments, merge them first using WaveSurfer-based method
      if (audioSegments.length > 0) {
        finalAudioUrl = await createMergedAudio()
      }
      
      // Convert to proper WAV format using WaveSurfer's audio processing
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

  // Crunker-based audio segment replacement class
  const audioSegmentReplacer = useMemo(() => {
    class CrunkerAudioEditor {
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
          let newSegmentBuffer = await audioContext.decodeAudioData(newSegmentArrayBuffer)

          // Clamp splice window
          const clampedStartTime = Math.max(0, Math.min(startTime, originalBuffer.duration))
          const clampedEndTime = Math.max(clampedStartTime, Math.min(endTime, originalBuffer.duration))
          const targetLengthSec = Math.max(0, clampedEndTime - clampedStartTime)

          // Extract before/after
          const beforeBuffer = clampedStartTime > 0
            ? this.extractSegment(originalBuffer, 0, clampedStartTime)
            : audioContext.createBuffer(originalBuffer.numberOfChannels, 1, originalBuffer.sampleRate)
          const afterBuffer = clampedEndTime < originalBuffer.duration
            ? this.extractSegment(originalBuffer, clampedEndTime, originalBuffer.duration)
            : audioContext.createBuffer(originalBuffer.numberOfChannels, 1, originalBuffer.sampleRate)

          // 1) Trim leading/trailing silence from regenerated segment
          newSegmentBuffer = this.trimSilence(newSegmentBuffer, -45, 8)

          // 2) Apply micro fades to avoid clicks
          newSegmentBuffer = this.applyMicroFades(newSegmentBuffer, 0.008)

          // 3) Fit to exact window length: crop or pad with low-level room tone from original
          const roomTone = this.buildRoomTone(originalBuffer, clampedStartTime, clampedEndTime, 0.05)
          const fittedNew = this.fitToLength(newSegmentBuffer, targetLengthSec, roomTone)

          // 4) Crossfade joins to be seamless
          const crossMs = 0.01
          const beforeJoined = this.crossfadeConcat(beforeBuffer, fittedNew, crossMs)
          const mergedBuffer = this.crossfadeConcat(beforeJoined, afterBuffer, crossMs)

          const { blob } = this.crunker.export(mergedBuffer, 'audio/wav')
          return blob
        } catch (error) {
          console.error('Audio segment replacement failed:', error)
          throw error
        }
      }

      private extractSegment(buffer: AudioBuffer, startTime: number, endTime: number): AudioBuffer {
        const sampleRate = buffer.sampleRate
        
        // Ensure precise sample boundaries to avoid gaps
        const startSample = Math.max(0, Math.round(startTime * sampleRate))
        const endSample = Math.max(startSample, Math.min(buffer.length, Math.round(endTime * sampleRate)))
        const segmentLength = endSample - startSample

        // Handle edge case where segment length is 0
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
          
          // Copy samples with bounds checking to prevent gaps
          for (let i = 0; i < segmentLength; i++) {
            const sourceIndex = startSample + i
            segmentData[i] = sourceIndex < buffer.length ? channelData[sourceIndex] : 0
          }
        }

        return segmentBuffer
      }

      // Remove leading/trailing silence using simple RMS windowing
      private trimSilence(buffer: AudioBuffer, thresholdDb: number = -45, windowMs: number = 8): AudioBuffer {
        const sampleRate = buffer.sampleRate
        const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate))
        const threshLin = Math.pow(10, thresholdDb / 20)

        const numChannels = buffer.numberOfChannels
        const length = buffer.length

        const rmsAt = (index: number): number => {
          const start = Math.max(0, index)
          const end = Math.min(length, index + windowSize)
          let sumSq = 0
          let count = 0
          for (let ch = 0; ch < numChannels; ch++) {
            const data = buffer.getChannelData(ch)
            for (let i = start; i < end; i++) {
              const v = data[i]
              sumSq += v * v
              count++
            }
          }
          return count > 0 ? Math.sqrt(sumSq / count) : 0
        }

        // Find first/last above threshold
        let startIdx = 0
        while (startIdx < length && rmsAt(startIdx) < threshLin) startIdx += windowSize
        let endIdx = length
        while (endIdx > startIdx && rmsAt(endIdx - windowSize) < threshLin) endIdx -= windowSize

        // Safety margin
        startIdx = Math.max(0, startIdx - Math.floor(windowSize / 2))
        endIdx = Math.min(length, endIdx + Math.floor(windowSize / 2))

        const trimmedLen = Math.max(1, endIdx - startIdx)
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const out = ctx.createBuffer(numChannels, trimmedLen, sampleRate)
        for (let ch = 0; ch < numChannels; ch++) {
          out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(startIdx, endIdx))
        }
        return out
      }

      // Apply very short fade-in/out to avoid clicks
      private applyMicroFades(buffer: AudioBuffer, fadeSec: number = 0.008): AudioBuffer {
        const sampleRate = buffer.sampleRate
        const fadeSamples = Math.max(1, Math.floor(fadeSec * sampleRate))
        const len = buffer.length
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const data = buffer.getChannelData(ch)
          const fadeCount = Math.min(fadeSamples, len)
          for (let i = 0; i < fadeCount; i++) data[i] *= i / fadeCount
          for (let i = 0; i < fadeCount; i++) data[len - 1 - i] *= i / fadeCount
        }
        return buffer
      }

      // Build low-level room tone from around the splice
      private buildRoomTone(original: AudioBuffer, startTime: number, endTime: number, totalSec: number): AudioBuffer {
        const sampleRate = original.sampleRate
        const grabSec = Math.min(0.05, Math.max(0.01, totalSec / 2))
        const before = Math.max(0, startTime - grabSec)
        const after = Math.min(original.duration, endTime + grabSec)
        const beforeSeg = this.extractSegment(original, before, startTime)
        const afterSeg = this.extractSegment(original, endTime, after)

        // Concatenate before+after
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const concatLen = beforeSeg.length + afterSeg.length
        const base = ctx.createBuffer(original.numberOfChannels, Math.max(1, concatLen), sampleRate)
        for (let ch = 0; ch < base.numberOfChannels; ch++) {
          const out = base.getChannelData(ch)
          out.set(beforeSeg.getChannelData(ch), 0)
          out.set(afterSeg.getChannelData(ch), beforeSeg.length)
          // Attenuate strongly to avoid audible speech
          for (let i = 0; i < out.length; i++) out[i] *= 0.2
        }
        return base
      }

      // Fit buffer to target length by cropping or padding with room tone (looped with micro crossfades)
      private fitToLength(buffer: AudioBuffer, targetSec: number, roomTone: AudioBuffer): AudioBuffer {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const sr = buffer.sampleRate
        const targetLen = Math.max(1, Math.floor(targetSec * sr))
        if (buffer.length === targetLen) return buffer

        if (buffer.length > targetLen) {
          // Crop tail
          const out = ctx.createBuffer(buffer.numberOfChannels, targetLen, sr)
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(0, targetLen))
          }
          return this.applyMicroFades(out, 0.008)
        }

        // Need to pad: loop roomTone with tiny crossfades
        const padLen = targetLen - buffer.length
        const chunk = Math.max(128, Math.min(roomTone.length, Math.floor(0.02 * sr)))
        const cross = Math.max(8, Math.floor(0.005 * sr))

        const out = ctx.createBuffer(buffer.numberOfChannels, targetLen, sr)
        // Copy original content
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          out.getChannelData(ch).set(buffer.getChannelData(ch), 0)
        }

        let writePos = buffer.length
        while (writePos < targetLen) {
          const take = Math.min(chunk, targetLen - writePos)
          for (let ch = 0; ch < out.numberOfChannels; ch++) {
            const outData = out.getChannelData(ch)
            const tone = roomTone.getChannelData(Math.min(ch, roomTone.numberOfChannels - 1))
            // pick slice from room tone
            const startIdx = (writePos - buffer.length) % Math.max(1, roomTone.length)

            // crossfade overlap between existing tail and start of new chunk
            const overlap = Math.min(cross, writePos)
            for (let i = 0; i < overlap; i++) {
              const t = i / Math.max(1, overlap)
              const dstIdx = writePos - overlap + i
              const newSample = tone[(startIdx + i) % roomTone.length]
              outData[dstIdx] = outData[dstIdx] * (1 - t) + newSample * t
            }

            // write remainder of new chunk after overlap
            for (let i = overlap; i < take; i++) {
              const src = tone[(startIdx + i) % roomTone.length]
              outData[writePos + (i - overlap)] = src
            }
          }
          writePos += take
        }
        return this.applyMicroFades(out, 0.008)
      }

      // Crossfade concatenate two buffers by ms
      private crossfadeConcat(a: AudioBuffer, b: AudioBuffer, crossMs: number): AudioBuffer {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const sr = a.sampleRate
        const cross = Math.max(0, Math.floor((crossMs / 1000) * sr))
        const outLen = Math.max(1, a.length + b.length - cross)
        const out = ctx.createBuffer(Math.max(a.numberOfChannels, b.numberOfChannels), outLen, sr)
        for (let ch = 0; ch < out.numberOfChannels; ch++) {
          const outData = out.getChannelData(ch)
          const aData = a.getChannelData(Math.min(ch, a.numberOfChannels - 1))
          const bData = b.getChannelData(Math.min(ch, b.numberOfChannels - 1))
          // copy a
          outData.set(aData.subarray(0, a.length - cross), 0)
          // crossfade region
          for (let i = 0; i < cross; i++) {
            const t = i / Math.max(1, cross)
            const ai = a.length - cross + i
            outData[ai] = (aData[ai] * (1 - t)) + (bData[i] * t)
          }
          // copy rest of b
          outData.set(bData.subarray(cross), a.length)
        }
        return out
      }

      audioBufferToWavBlob(buffer: AudioBuffer): Blob {
        const { blob } = this.crunker.export(buffer, 'audio/wav')
        return blob
      }
    }
    return new CrunkerAudioEditor()
  }, [])

  const createMergedAudio = async (): Promise<string> => {
    if (!audioData || audioSegments.length === 0) {
      return audioData?.url || ""
    }

    try {
      // Sort segments by startIndex for sequential processing
      const sorted = [...audioSegments].sort((a, b) => a.startIndex - b.startIndex)
      
      // Function to get precise timing for word indices
      const getTimingForWordIndex = (wordIndex: number): number => {
        // First try to use transcript timing from original audio
        if (audioData.transcript) {
          const timing = getWordTimingFromTranscript(wordIndex, audioData.transcript)
          if (timing) {
            return timing.start
          }
        }
        
        // Fallback to uniform mapping
        const totalWords = Math.max(1, words.length)
        return (wordIndex / totalWords) * audioData.duration
      }

      // Apply replacements sequentially to maintain audio integrity
      let currentAudioUrl = audioData.url

      for (const seg of sorted) {
        // Use precise timing if available from segment's transcript or original transcript
        let startSec: number, endSec: number
        
        let preciseTimings = getWordRangeTimingFromTranscript(seg.startIndex, seg.endIndex, audioData.transcript)
        if (!preciseTimings) {
          // Use strict fuzzy search as primary method for sentence matching
          preciseTimings = getTimingByStrictFuzzyMatch(seg.text, audioData.transcript, seg.startIndex)
        }
        if (!preciseTimings && seg.text) {
          const relaxed = seg.text.replace(/[^a-zA-Z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim()
          preciseTimings = getTimingByStrictFuzzyMatch(relaxed, audioData.transcript, seg.startIndex)
        }
        if (!preciseTimings) {
          preciseTimings = getTimingByTokenMatch(words, seg.startIndex, seg.endIndex, audioData.transcript)
        }
        if (!preciseTimings) {
          preciseTimings = getTimingByExactTokenWindow(seg.text, audioData.transcript, seg.startIndex)
        }
        if (!preciseTimings) {
          preciseTimings = getTimingBySentenceSubstring(seg.text, audioData.transcript)
        }
        if (!preciseTimings) {
          console.warn('Could not precisely locate regenerated segment in original audio. Skipping this segment to avoid misplacement.')
          continue
        }
        startSec = preciseTimings.startTime
        endSec = preciseTimings.endTime
        
        if (!seg.blob) continue

        // Decode and attempt strict per-word retiming using transcripts
        let replacementBlob = seg.blob
        try {
          const arrayBuf = await seg.blob.arrayBuffer()
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
          const decoded = await ctx.decodeAudioData(arrayBuf)
          const retimed = await retimeSegmentToOriginalWindow(
            decoded,
            seg.transcript || null,
            audioData.transcript || null,
            seg.startIndex,
            seg.endIndex
          )
          if (retimed) {
            replacementBlob = audioSegmentReplacer.audioBufferToWavBlob(retimed)
          }
        } catch {}

        // Replace segment using precise timing-based method
        const mergedBlob = await audioSegmentReplacer.replaceAudioSegment(
          currentAudioUrl,
          replacementBlob,
          startSec,
          endSec
        )
        
        // Clean up previous URL if it's not the original
        if (currentAudioUrl !== audioData.url) {
          URL.revokeObjectURL(currentAudioUrl)
        }
        
        // Update for next iteration
        currentAudioUrl = URL.createObjectURL(mergedBlob)
      }

      return currentAudioUrl
      
    } catch (error) {
      console.error('Error merging audio:', error)
      // Fallback to original audio
      return audioData?.url || ""
    }
  }


  const confirmMerge = async () => {
    if (!mergePreview) return

    try {
      // Create the merged audio and apply it to main audio
      const mergedUrl = await createMergedFromCurrent(mergePreview.newSegment)
      if (mergedUrl) {
        // Decode to get accurate duration and blob
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        const resp = await fetch(mergedUrl)
        const buf = await audioContext.decodeAudioData(await resp.arrayBuffer())
        const mergedBlob = audioSegmentReplacer.audioBufferToWavBlob(buf)
        // Re-transcribe the merged audio so subsequent replacements use the latest transcript
        const mergedTranscript = await generateTranscriptForAudio(mergedBlob)
        setAudioData({ 
          url: URL.createObjectURL(mergedBlob), 
          duration: buf.duration, 
          waveform: audioData!.waveform, 
          blob: mergedBlob,
          transcript: mergedTranscript || audioData!.transcript || null,
        })
      }

      // Update segments: remove any overlapping segments and add the new one
      setAudioSegments((prev) => {
        const newSegment = mergePreview.newSegment
        
        // Remove segments that overlap with the new segment (including partial overlaps)
        const filtered = prev.filter((seg) => {
          // Keep segments that don't overlap at all
          return seg.endIndex <= newSegment.startIndex || seg.startIndex >= newSegment.endIndex
        })
        
        // Add the new segment
        return [...filtered, newSegment].sort((a, b) => a.startIndex - b.startIndex)
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

  const createMergedFromCurrent = async (segment: AudioSegment): Promise<string> => {
    if (!audioData || !segment.blob) return ""
    
    try {
      // Use precise timing if available from transcript
      let startSec: number, endSec: number
      
      let preciseTimings = getWordRangeTimingFromTranscript(segment.startIndex, segment.endIndex, audioData.transcript)
      if (!preciseTimings) {
        // Use strict fuzzy search as primary method for sentence matching
        preciseTimings = getTimingByStrictFuzzyMatch(segment.text, audioData.transcript, segment.startIndex)
      }
      if (!preciseTimings && segment.text) {
        const relaxed = segment.text.replace(/[^a-zA-Z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim()
        preciseTimings = getTimingByStrictFuzzyMatch(relaxed, audioData.transcript, segment.startIndex)
      }
      if (!preciseTimings) {
        preciseTimings = getTimingByTokenMatch(words, segment.startIndex, segment.endIndex, audioData.transcript)
      }
      if (!preciseTimings) {
        preciseTimings = getTimingByExactTokenWindow(segment.text, audioData.transcript, segment.startIndex)
      }
      if (!preciseTimings) {
        preciseTimings = getTimingBySentenceSubstring(segment.text, audioData.transcript)
      }
      if (!preciseTimings) {
        alert('Could not precisely locate the selected sentence in the original transcript. Please adjust your selection and try again.')
        return ""
      }
      startSec = preciseTimings.startTime
      endSec = preciseTimings.endTime
      
      // Try strict per-word retiming first
      let replacementBlob = segment.blob
      try {
        const arrayBuf = await segment.blob.arrayBuffer()
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const decoded = await ctx.decodeAudioData(arrayBuf)
        const retimed = await retimeSegmentToOriginalWindow(
          decoded,
          segment.transcript || null,
          audioData.transcript || null,
          segment.startIndex,
          segment.endIndex
        )
        if (retimed) {
          replacementBlob = audioSegmentReplacer.audioBufferToWavBlob(retimed)
        }
      } catch {}

      // Use precise timing-based replacement for perfect audio integrity
      const mergedBlob = await audioSegmentReplacer.replaceAudioSegment(
        audioData.url,
        replacementBlob,
        startSec,
        endSec
      )
      
      return URL.createObjectURL(mergedBlob)
    } catch (error) {
      console.error('Error creating merged preview:', error)
      return ""
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
    // Build a full-length preview with the new segment spliced in
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

  // Ensure we use actual media duration to avoid drift
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onLoaded = () => {
      const dur = isFinite(el.duration) ? el.duration : audioData?.duration || 0
      if (audioData) setAudioData({ ...audioData, duration: dur })
    }
    el.addEventListener('loadedmetadata', onLoaded)
    return () => el.removeEventListener('loadedmetadata', onLoaded)
  }, [audioRef.current, audioData])

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
              <CardTitle className="flex items-center gap-2">
                Script Playback
                {audioData?.transcript && (
                  <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded-full">
                    Precise Timing
                  </span>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Select text to regenerate specific portions or play selected segments
                {audioData?.transcript && (
                  <span className="block text-xs text-green-600 dark:text-green-400 mt-1">
                    Using transcript-based word timing for accurate audio synchronization
                  </span>
                )}
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
                    data-word-index={index}
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
                      const startPercent = (segment.startIndex / Math.max(1, words.length)) * 100
                      const widthPercent = ((segment.endIndex - segment.startIndex) / Math.max(1, words.length)) * 100
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

                  {/* Full merged preview */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Volume2 className="h-4 w-4 text-teal-600" />
                      <span className="text-sm font-medium">Preview: Full audio with replacement</span>
                      <div className="ml-auto flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => {
                          const el = mergePreviewAudioRef.current
                          if (!el) return
                          if (el.paused) { el.currentTime = 0; el.play() } else { el.pause() }
                        }}>
                          {(mergePreviewAudioRef.current && !mergePreviewAudioRef.current.paused) ? 'Pause' : 'Play'}
                        </Button>
                      </div>
                    </div>
                    <div className="relative w-full h-28 border rounded bg-muted/50 overflow-hidden">
                      {mergePreviewBlob && (
                        <AudioVisualizer
                          blob={mergePreviewBlob}
                          width={800}
                          height={100}
                          barWidth={2}
                          gap={1}
                          barColor="rgb(249, 115, 22)"
                          barPlayedColor="rgb(249, 115, 22)"
                          currentTime={mergePreviewCurrentTime}
                          style={{ width: '100%', height: '100%' }}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    The regenerated audio will replace the selected portion. Preview the complete result above before merging.
                  </p>
                  {mergePreview?.newSegment?.transcript && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-2">
                      ✓ Using precise word timings from transcript for seamless audio replacement
                    </p>
                  )}
                </div>

                {/* Hidden audio element for merged preview */}
                <audio
                  ref={mergePreviewAudioRef}
                  src={mergePreviewUrl}
                  onTimeUpdate={() => setMergePreviewCurrentTime(mergePreviewAudioRef.current?.currentTime || 0)}
                  onEnded={() => setMergePreviewCurrentTime(0)}
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
