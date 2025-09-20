import { useRef, useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Volume2 } from "lucide-react"
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
}

export function MergeDialog({
  open,
  onOpenChange,
  mergePreview,
  selectedText,
  onConfirmMerge,
  mergePreviewUrl,
  mergePreviewBlob
}: MergeDialogProps) {
  const mergePreviewAudioRef = useRef<HTMLAudioElement>(null)
  const [mergePreviewCurrentTime, setMergePreviewCurrentTime] = useState(0)

  const handleClose = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                      if (el.paused) { 
                        el.currentTime = 0
                        el.play() 
                      } else { 
                        el.pause() 
                      }
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
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={onConfirmMerge} className="bg-teal-600 hover:bg-teal-700 text-white">
            Merge Audio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
