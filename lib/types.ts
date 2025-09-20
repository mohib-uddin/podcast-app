export interface WordTiming {
  text: string
  start: number
  end: number
  type: "word"
  speaker_id: string
  logprob: number
}

export interface TranscriptData {
  language_code: string
  language_probability: number
  text: string
  words: WordTiming[]
}

export interface AudioData {
  url: string
  duration: number
  waveform: number[]
  blob?: Blob
  transcript?: TranscriptData | null
}

export interface AudioSegment {
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

export interface HistoryState {
  script: string
  audioData: AudioData | null
  audioSegments: AudioSegment[]
  timestamp: number
  action: string
}

export interface MergePreview {
  originalSegment: AudioSegment | null
  newSegment: AudioSegment
  mergedAudio: AudioData | null
}

export interface TimingResult {
  startTime: number
  endTime: number
}
