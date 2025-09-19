import { type NextRequest, NextResponse } from "next/server"

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

    // Convert to base64 for client-side usage
    const base64Audio = Buffer.from(audioBuffer).toString("base64")
    const audioUrl = `data:audio/mpeg;base64,${base64Audio}`

    // Estimate duration based on text length (rough approximation: ~150 words per minute)
    const wordCount = text.split(/\s+/).filter((word: string) => word.length > 0).length
    const estimatedDuration = Math.max(1, (wordCount / 150) * 60)
    
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
      duration: estimatedDuration,
      waveform,
      wordCount,
    })
  } catch (error) {
    console.error("Error generating audio:", error)
    return NextResponse.json({ 
      error: "Internal server error", 
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 })
  }
}
