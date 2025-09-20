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
