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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('file') as File
    const modelId = formData.get('model_id') as string || "scribe_v1"

    if (!audioFile) {
      return NextResponse.json({ error: "Audio file is required" }, { status: 400 })
    }

    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY environment variable is not set")
      return NextResponse.json({ 
        error: "ElevenLabs API key not configured. Please add ELEVENLABS_API_KEY to your .env.local file." 
      }, { status: 500 })
    }

    // Create form data for ElevenLabs API
    const elevenlabsFormData = new FormData()
    elevenlabsFormData.append('file', audioFile)
    elevenlabsFormData.append('model_id', modelId)

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: elevenlabsFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("ElevenLabs Speech-to-Text API error:", response.status, response.statusText, errorText)
      
      let errorMessage = "Failed to transcribe audio"
      if (response.status === 401) {
        errorMessage = "Invalid ElevenLabs API key. Please check your API key in .env.local"
      } else if (response.status === 429) {
        errorMessage = "Rate limit exceeded. Please try again later."
      } else if (response.status === 400) {
        errorMessage = "Invalid audio file or request parameters."
      }
      
      return NextResponse.json({ 
        error: errorMessage,
        details: errorText,
        status: response.status
      }, { status: 500 })
    }

    const transcriptData: TranscriptResponse = await response.json()

    return NextResponse.json({
      success: true,
      transcript: transcriptData
    })
  } catch (error) {
    console.error("Error transcribing audio:", error)
    return NextResponse.json({ 
      error: "Internal server error", 
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 })
  }
}
