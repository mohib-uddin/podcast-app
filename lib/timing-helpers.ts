import { TranscriptData, TimingResult } from './types'

// Normalize a word token for alignment (lowercase, strip punctuation)
export const normalizeToken = (t: string): string => 
  t.toLowerCase().replace(/[^a-z0-9']/gi, '').trim()

export const tokenize = (s: string): string[] => 
  s.split(/\s+/).map(normalizeToken).filter(Boolean)

// Extract only lexical words (exclude spacing/punctuation entries)
export const getTranscriptLexicalWords = (transcript?: TranscriptData | null): { text: string; start: number; end: number }[] => {
  if (!transcript || !transcript.words) return []
  return transcript.words
    .filter((w) => w.type === 'word')
    .map((w) => ({ text: normalizeToken(w.text), start: w.start, end: w.end }))
    .filter((w) => w.text.length > 0)
}

// Alignment structure mapping between script words and transcript lexical words
export interface WordAlignment {
  // For each script word index, the aligned transcript lexical index or -1
  scriptToTranscript: number[]
  // For each transcript lexical index, the aligned script word index or -1
  transcriptToScript: number[]
}

// Build a monotonic alignment between script words and transcript lexical words
// Strategy: greedy left-to-right match of normalized tokens, allowing gaps on either side
export const buildScriptTranscriptAlignment = (
  scriptWords: string[],
  transcript?: TranscriptData | null
): WordAlignment => {
  const lex = getTranscriptLexicalWords(transcript)
  const scriptTokens = scriptWords.map(normalizeToken)

  const scriptToTranscript: number[] = new Array(scriptWords.length).fill(-1)
  const transcriptToScript: number[] = new Array(lex.length).fill(-1)

  let tCursor = 0
  for (let sIdx = 0; sIdx < scriptTokens.length; sIdx++) {
    const token = scriptTokens[sIdx]
    if (!token) {
      continue
    }
    // advance transcript cursor until we find a matching token
    while (tCursor < lex.length && lex[tCursor].text !== token) {
      tCursor++
    }
    if (tCursor < lex.length && lex[tCursor].text === token) {
      scriptToTranscript[sIdx] = tCursor
      if (transcriptToScript[tCursor] === -1) {
        transcriptToScript[tCursor] = sIdx
      }
      tCursor++
    } else {
      // no more matches; break to keep monotonicity, remainder stay -1
      break
    }
  }

  // Backfill unmatched trailing script words by looking ahead independently (non-monotonic rescue)
  // Useful when earlier mismatches caused an early break
  for (let sIdx = 0; sIdx < scriptTokens.length; sIdx++) {
    if (scriptToTranscript[sIdx] !== -1) continue
    const token = scriptTokens[sIdx]
    if (!token) continue
    // search globally for nearest matching transcript token
    let bestIdx = -1
    let bestDist = Number.POSITIVE_INFINITY
    for (let k = 0; k < lex.length; k++) {
      if (lex[k].text === token) {
        // prefer the closest transcript index to maintain local coherence
        const dist = Math.min(
          sIdx,
          scriptTokens.length - 1 - sIdx
        ) + Math.min(k, lex.length - 1 - k)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = k
        }
      }
    }
    if (bestIdx !== -1) {
      scriptToTranscript[sIdx] = bestIdx
      if (transcriptToScript[bestIdx] === -1) {
        transcriptToScript[bestIdx] = sIdx
      }
    }
  }

  return { scriptToTranscript, transcriptToScript }
}

// Binary search the transcript lexical words to find word index at or before time
export const findTranscriptIndexAtTime = (
  transcript: TranscriptData | null | undefined,
  time: number
): number => {
  const lex = getTranscriptLexicalWords(transcript)
  if (lex.length === 0 || !isFinite(time)) return -1
  let lo = 0
  let hi = lex.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const w = lex[mid]
    if (time < w.start) {
      hi = mid - 1
    } else if (time > w.end) {
      ans = mid
      lo = mid + 1
    } else {
      // time within [start, end]
      return mid
    }
  }
  return ans
}

// Given a transcript word index and alignment, return best matching script index
export const mapTranscriptIndexToScript = (
  transcriptIndex: number,
  alignment: WordAlignment
): number => {
  const { transcriptToScript } = alignment
  if (transcriptIndex < 0 || transcriptIndex >= transcriptToScript.length) return -1
  const direct = transcriptToScript[transcriptIndex]
  if (direct !== -1) return direct
  // search nearest neighbor that has a mapping
  let left = transcriptIndex - 1
  let right = transcriptIndex + 1
  while (left >= 0 || right < transcriptToScript.length) {
    if (left >= 0 && transcriptToScript[left] !== -1) return transcriptToScript[left]
    if (right < transcriptToScript.length && transcriptToScript[right] !== -1) return transcriptToScript[right]
    left--
    right++
  }
  return -1
}

// Get precise word timing from transcript
export const getWordTimingFromTranscript = (
  wordIndex: number, 
  transcript?: TranscriptData | null
): { start: number; end: number } | null => {
  const lex = getTranscriptLexicalWords(transcript)
  if (lex.length === 0) return null

  if (wordIndex >= 0 && wordIndex < lex.length) {
    const word = lex[wordIndex]
    return { start: word.start, end: word.end }
  }

  return null
}

// Get word range timing from transcript
export const getWordRangeTimingFromTranscript = (
  startIndex: number, 
  endIndex: number, 
  transcript?: TranscriptData | null
): TimingResult | null => {
  const lex = getTranscriptLexicalWords(transcript)
  if (lex.length === 0) return null

  if (startIndex < 0 || endIndex <= startIndex || startIndex >= lex.length) {
    return null
  }

  const clampedStart = Math.max(0, Math.min(startIndex, lex.length - 1))
  const clampedEnd = Math.max(clampedStart, Math.min(endIndex - 1, lex.length - 1))

  const startWord = lex[clampedStart]
  const endWord = lex[clampedEnd]

  if (startWord && endWord && typeof startWord.start === 'number' && typeof endWord.end === 'number') {
    const startTime = Math.max(0, startWord.start)
    const endTime = Math.max(startTime, endWord.end)
    
    return { startTime, endTime }
  }

  return null
}

// Simple token matching for timing
export const getTimingByTokenMatch = (
  scriptWords: string[],
  startIndex: number,
  endIndex: number,
  transcript?: TranscriptData | null
): TimingResult | null => {
  const lex = getTranscriptLexicalWords(transcript)
  if (lex.length === 0) return null
  
  const selTokens = scriptWords.slice(startIndex, endIndex).map(normalizeToken).filter(Boolean)
  if (selTokens.length === 0) return null
  
  const tTokens = lex.map(w => w.text)
  
  // Simple sliding window match
  for (let i = 0; i + selTokens.length <= tTokens.length; i++) {
    let match = true
    for (let k = 0; k < selTokens.length; k++) {
      if (selTokens[k] !== tTokens[i + k]) {
        match = false
        break
      }
    }
    if (match) {
      const startWord = lex[i]
      const endWord = lex[i + selTokens.length - 1]
      if (startWord && endWord) {
        return { startTime: startWord.start, endTime: endWord.end }
      }
    }
  }
  return null
}

// Simplified text matching (replaces the complex fuzzy search)
export const getTimingByTextMatch = (
  sentence: string | undefined,
  transcript?: TranscriptData | null
): TimingResult | null => {
  if (!sentence || !transcript || !transcript.text) return null
  
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const needle = normalize(sentence)
  const haystack = normalize(transcript.text)
  
  if (!needle || !haystack) return null
  
  const lex = getTranscriptLexicalWords(transcript)
  if (lex.length === 0) return null
  
  const built = lex.map(w => w.text).join(' ')
  const cleanNeedle = needle.replace(/[^a-z0-9']/gi, ' ').replace(/\s+/g, ' ').trim()
  const pos = built.indexOf(cleanNeedle)
  
  if (pos < 0) return null
  
  // Approximate token counting
  const preTokens = built.slice(0, pos).split(' ').filter(Boolean).length
  const lenTokens = cleanNeedle.split(' ').filter(Boolean).length
  const startIdx = preTokens
  const endIdx = Math.min(lex.length, startIdx + Math.max(1, lenTokens))
  
  const startWord = lex[startIdx]
  const endWord = lex[endIdx - 1]
  
  if (startWord && endWord) {
    return { startTime: startWord.start, endTime: endWord.end }
  }
  
  return null
}

// Main timing resolution function - tries methods in order of reliability
export const resolveTimingForSelection = (
  selectedText: string,
  startWordIndex: number,
  endWordIndex: number,
  scriptWords: string[],
  transcript?: TranscriptData | null
): TimingResult | null => {
  // Try transcript-based word range first (most reliable)
  let timing = getWordRangeTimingFromTranscript(startWordIndex, endWordIndex, transcript)
  if (timing) return timing

  // Try exact token matching
  timing = getTimingByTokenMatch(scriptWords, startWordIndex, endWordIndex, transcript)
  if (timing) return timing

  // Try simple text matching
  timing = getTimingByTextMatch(selectedText, transcript)
  if (timing) return timing

  // Try with cleaned text as fallback
  if (selectedText) {
    const relaxed = selectedText.replace(/[^a-zA-Z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim()
    timing = getTimingByTextMatch(relaxed, transcript)
    if (timing) return timing
  }

  return null
}

// Validate transcript data integrity
export const validateTranscriptData = (transcript: TranscriptData | null): transcript is TranscriptData => {
  if (!transcript) return false
  
  if (!transcript.words || !Array.isArray(transcript.words)) return false
  
  return transcript.words.every(word => 
    typeof word.start === 'number' && 
    typeof word.end === 'number' && 
    word.start >= 0 && 
    word.end >= word.start &&
    typeof word.text === 'string' &&
    word.text.length > 0
  )
}
