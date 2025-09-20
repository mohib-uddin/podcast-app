import { forwardRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Play, Pause, SkipBack, SkipForward, Download } from "lucide-react"
import { AudioVisualizer } from "react-audio-visualize"
import { AudioData, AudioSegment } from "@/lib/types"

interface AudioPlayerProps {
  audioData: AudioData
  audioSegments: AudioSegment[]
  words: string[]
  isPlaying: boolean
  currentTime: number
  onTogglePlayPause: () => void
  onSkipTime: (seconds: number) => void
  onExportAudio: () => void
  onTimeUpdate: () => void
  onPlay: () => void
  onPause: () => void
  onEnded: () => void
}

export const AudioPlayer = forwardRef<HTMLAudioElement, AudioPlayerProps>(({
  audioData,
  audioSegments,
  words,
  isPlaying,
  currentTime,
  onTogglePlayPause,
  onSkipTime,
  onExportAudio,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded
}, ref) => {
  // Update duration when metadata loads
  useEffect(() => {
    const audioElement = ref as React.RefObject<HTMLAudioElement>
    const el = audioElement?.current
    if (!el) return
    
    const onLoaded = () => {
      const dur = isFinite(el.duration) ? el.duration : audioData?.duration || 0
      // Duration update would be handled by parent component
    }
    
    el.addEventListener('loadedmetadata', onLoaded)
    return () => el.removeEventListener('loadedmetadata', onLoaded)
  }, [ref, audioData])

  return (
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
                const audioElement = ref as React.RefObject<HTMLAudioElement>
                if (!audioElement?.current) return
                const rect = e.currentTarget.getBoundingClientRect()
                const x = e.clientX - rect.left
                const progress = x / rect.width
                audioElement.current.currentTime = progress * audioElement.current.duration
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
          <Button variant="outline" size="icon" onClick={() => onSkipTime(-5)}>
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button size="icon" onClick={onTogglePlayPause} className="h-12 w-12">
            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </Button>

          <Button variant="outline" size="icon" onClick={() => onSkipTime(5)}>
            <SkipForward className="h-4 w-4" />
          </Button>

          <Button variant="outline" onClick={onExportAudio} className="ml-4 bg-transparent">
            <Download className="h-4 w-4 mr-2" />
            Export WAV
          </Button>
        </div>

        {/* Hidden audio element */}
        <audio
          ref={ref}
          src={audioData.url}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          onPlay={onPlay}
          onPause={onPause}
        />
      </CardContent>
    </Card>
  )
})

AudioPlayer.displayName = "AudioPlayer"
