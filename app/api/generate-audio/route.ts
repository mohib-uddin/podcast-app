import { type NextRequest, NextResponse } from "next/server"

interface WordTiming {
  text: string
  start: number
  end: number
  type: "word"
  speaker_id: string
  logprob: number
}

interface TranscriptResponse {
  language_code: string
  language_probability: number
  text: string
  words: WordTiming[]
}

async function generateTranscript(audioBuffer: ArrayBuffer): Promise<TranscriptResponse | null> {
  try {
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
    if (!ELEVENLABS_API_KEY) {
      console.warn("ELEVENLABS_API_KEY not available for transcript generation")
      return null
    }

    // Convert ArrayBuffer to Blob for FormData
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' })
    
    // Create form data for ElevenLabs Speech-to-Text API
    const formData = new FormData()
    formData.append('file', audioBlob, 'audio.mp3')
    formData.append('model_id', 'scribe_v1')

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: formData,
    })

    if (!response.ok) {
      console.error("Speech-to-text failed:", response.status, response.statusText)
      return null
    }

    const transcriptData: TranscriptResponse = await response.json()
    return transcriptData
  } catch (error) {
    console.error("Error generating transcript:", error)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json()

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 })
    }

    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY environment variable is not set")
      return NextResponse.json({ 
        error: "ElevenLabs API key not configured. Please add ELEVENLABS_API_KEY to your .env.local file." 
      }, { status: 500 })
    }

    // Use a default voice ID - you can change this to any ElevenLabs voice
    const voiceId = "pNInz6obpgDQGcFmaJgB" // Adam voice

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 1,
          similarity_boost: 1,
          style: 0,
          use_speaker_boost: true,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("ElevenLabs API error:", response.status, response.statusText, errorText)
      
      let errorMessage = "Failed to generate audio"
      if (response.status === 401) {
        errorMessage = "Invalid ElevenLabs API key. Please check your API key in .env.local"
      } else if (response.status === 429) {
        errorMessage = "Rate limit exceeded. Please try again later."
      } else if (response.status === 400) {
        errorMessage = "Invalid request. Please check your text input."
      }
      
      return NextResponse.json({ 
        error: errorMessage,
        details: errorText,
        status: response.status
      }, { status: 500 })
    }

    const audioBuffer = await response.arrayBuffer()

    // Generate transcript with word timings
    const transcript = await generateTranscript(audioBuffer)

    // Convert to base64 for client-side usage
    const base64Audio = Buffer.from(audioBuffer).toString("base64")
    const audioUrl = `data:audio/mpeg;base64,${base64Audio}`

    // Use transcript duration if available, otherwise estimate
    const wordCount = text.split(/\s+/).filter((word: string) => word.length > 0).length
    let actualDuration = Math.max(1, (wordCount / 150) * 60) // fallback estimation
    
    if (transcript && transcript.words.length > 0) {
      // Get actual duration from transcript
      const lastWord = transcript.words[transcript.words.length - 1]
      actualDuration = Math.max(1, lastWord.end)
    }
    
    // Generate more realistic waveform data based on text characteristics
    const waveformLength = Math.max(50, Math.min(200, wordCount * 2))
    const waveform = Array.from({ length: waveformLength }, (_, i) => {
      // Create more varied waveform with peaks and valleys
      const baseAmplitude = 0.3 + Math.random() * 0.4
      const variation = Math.sin(i / 10) * 0.2
      return Math.max(0.1, Math.min(0.9, baseAmplitude + variation + (Math.random() - 0.5) * 0.3))
    })

    return NextResponse.json({
      url: audioUrl,
      duration: actualDuration,
      waveform,
      wordCount,
      transcript: transcript || null, // Include transcript data if available
    })
  } catch (error) {
    console.error("Error generating audio:", error)
    return NextResponse.json({ 
      error: "Internal server error", 
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 })
  }
}
