import { useRef, useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Volume2, Play, Pause, SkipBack, SkipForward, Loader2 } from "lucide-react"
import { AudioVisualizer } from "react-audio-visualize"
import { MergePreview } from "@/lib/types"

interface MergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mergePreview: MergePreview | null
  selectedText: string
  onConfirmMerge: () => void
  mergePreviewUrl: string
  mergePreviewBlob: Blob | null
  isMerging?: boolean
  originalAudioBlob?: Blob | null
  originalAudioDurationSec?: number
}

export function MergeDialog({
  open,
  onOpenChange,
  mergePreview,
  selectedText,
  onConfirmMerge,
  mergePreviewUrl,
  mergePreviewBlob,
  isMerging = false,
  originalAudioBlob = null,
  originalAudioDurationSec = 0
}: MergeDialogProps) {
  const mergePreviewAudioRef = useRef<HTMLAudioElement>(null)
  const [mergePreviewCurrentTime, setMergePreviewCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const handleClose = () => {
    onOpenChange(false)
    // Reset playback state when closing
    if (mergePreviewAudioRef.current) {
      mergePreviewAudioRef.current.pause()
      mergePreviewAudioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setMergePreviewCurrentTime(0)
  }

  const togglePlayPause = () => {
    const audio = mergePreviewAudioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }

  const skipTime = (seconds: number) => {
    const audio = mergePreviewAudioRef.current
    if (!audio) return
    
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || 0, audio.currentTime + seconds)
    )
  }

  const handleTimeUpdate = () => {
    const audio = mergePreviewAudioRef.current
    if (!audio) return
    setMergePreviewCurrentTime(audio.currentTime)
  }

  const handleEnded = () => {
    setIsPlaying(false)
    setMergePreviewCurrentTime(0)
  }

  const handlePlay = () => {
    setIsPlaying(true)
  }

  const handlePause = () => {
    setIsPlaying(false)
  }

  // Calculate timing information for dual waveform display
  const getTotalDuration = () => {
    return mergePreviewAudioRef.current?.duration || 0
  }

  const getOriginalAudioDuration = () => {
    // Prefer real original duration if provided; fallback to merged duration
    return originalAudioDurationSec || getTotalDuration()
  }

  const getNewSegmentDuration = () => {
    if (!mergePreview?.newSegment) return 0
    return mergePreview.newSegment.durationSec || 0
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Merge Audio</DialogTitle>
        </DialogHeader>
        {mergePreview && (
          <div className="space-y-6">
            {/* Selected Text */}
            <div>
              <p className="text-sm text-muted-foreground mb-2">Selected text:</p>
              <div className="p-3 bg-muted rounded-lg border-l-4 border-teal-500">
                <p className="text-sm font-medium">"{selectedText}"</p>
              </div>
            </div>

            {/* Dual Waveform Display */
            }
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Volume2 className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Audio Comparison</span>
              </div>

              {/* Original Audio Waveform (latest version) */}
              {originalAudioBlob && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-600">Original Audio</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.floor(getOriginalAudioDuration() / 60).toString().padStart(2, '0')}:
                      {Math.floor(getOriginalAudioDuration() % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="relative w-full h-20 border rounded bg-muted/50 overflow-hidden">
                    <AudioVisualizer
                      blob={originalAudioBlob}
                      width={800}
                      height={80}
                      barWidth={2}
                      gap={1}
                      barColor="rgb(59, 130, 246)"
                      barPlayedColor="rgb(16, 185, 129)"
                      currentTime={mergePreviewCurrentTime}
                      style={{ width: '100%', height: '100%' }}
                    />
                    {/* Progress indicator across full original audio */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
                      style={{
                        left: `${(getOriginalAudioDuration() > 0 ? (mergePreviewCurrentTime / getOriginalAudioDuration()) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Regenerated Segment Waveform */}
              {mergePreview.newSegment?.blob && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-teal-600">Regenerated Segment</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.floor(getNewSegmentDuration() / 60).toString().padStart(2, '0')}:
                      {Math.floor(getNewSegmentDuration() % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="relative w-full h-20 border rounded bg-muted/50 overflow-hidden">
                    <AudioVisualizer
                      blob={mergePreview.newSegment.blob}
                      width={800}
                      height={80}
                      barWidth={2}
                      gap={1}
                      barColor="rgb(20, 184, 166)"
                      barPlayedColor="rgb(16, 185, 129)"
                      currentTime={(() => {
                        const segStart = mergePreview.newSegment.startTime || 0
                        const segDur = getNewSegmentDuration()
                        const t = mergePreviewCurrentTime
                        if (t <= segStart) return 0
                        if (t >= segStart + segDur) return segDur
                        return t - segStart
                      })()}
                      style={{ width: '100%', height: '100%' }}
                    />
                    {/* Progress indicator for regenerated segment */}
                    {(() => {
                      const segStart = mergePreview.newSegment.startTime || 0
                      const segDur = getNewSegmentDuration()
                      const t = mergePreviewCurrentTime
                      if (t < segStart || t > segStart + segDur || segDur <= 0) return null
                      const left = ((t - segStart) / segDur) * 100
                      return (
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
                          style={{ left: `${left}%` }}
                        />
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* Playback Controls */}
              <div className="flex items-center justify-center gap-4 py-4">
                <Button variant="outline" size="icon" onClick={() => skipTime(-5)}>
                  <SkipBack className="h-4 w-4" />
                </Button>

                <Button size="icon" onClick={togglePlayPause} className="h-12 w-12">
                  {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
                </Button>

                <Button variant="outline" size="icon" onClick={() => skipTime(5)}>
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>

              {/* Time Display */}
              <div className="flex justify-center">
                <div className="text-xs text-muted-foreground font-mono">
                  {Math.floor(mergePreviewCurrentTime / 60).toString().padStart(2, '0')}:
                  {Math.floor(mergePreviewCurrentTime % 60).toString().padStart(2, '0')} / {' '}
                  {Math.floor(getTotalDuration() / 60).toString().padStart(2, '0')}:
                  {Math.floor(getTotalDuration() % 60).toString().padStart(2, '0')}
                </div>
              </div>
            </div>

            <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Compare the original and regenerated segments above. The regenerated audio will replace the selected portion.
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
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              onPlay={handlePlay}
              onPause={handlePause}
              style={{ display: 'none' }}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={onConfirmMerge} 
            className="bg-teal-600 hover:bg-teal-700 text-white"
            disabled={isMerging}
          >
            {isMerging ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Merging...
              </>
            ) : (
              "Merge Audio"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
