import { useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Play, RefreshCw } from "lucide-react"
import { AudioData } from "@/lib/types"

interface ScriptPlaybackProps {
  words: string[]
  highlightedWordIndex: number
  isWordHighlighted: boolean[]
  selectedText: string
  audioData?: AudioData | null
  onTextSelection: () => void
  onPlaySelectedText: () => void
  onShowRegenerateDialog: () => void
}

export function ScriptPlayback({
  words,
  highlightedWordIndex,
  isWordHighlighted,
  selectedText,
  audioData,
  onTextSelection,
  onPlaySelectedText,
  onShowRegenerateDialog
}: ScriptPlaybackProps) {
  const textRef = useRef<HTMLDivElement>(null)

  // Add selection change listener for better mobile support
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      
      const text = selection.toString().trim()
      if (!text) return
      
      // Check if selection is within our text container
      const range = selection.getRangeAt(0)
      if (!textRef.current?.contains(range.commonAncestorContainer)) return
      
      // Trigger selection handler with a small delay for mobile
      setTimeout(() => {
        onTextSelection()
      }, 50)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [onTextSelection])

  return (
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
          className="text-base leading-relaxed select-text cursor-text touch-manipulation"
          style={{
            WebkitUserSelect: 'text',
            userSelect: 'text',
            WebkitTouchCallout: 'default'
          }}
          onMouseUp={onTextSelection}
          onTouchEnd={(e) => {
            // Prevent default touch behavior that might interfere with text selection
            e.preventDefault()
            // Small delay to ensure selection is complete
            setTimeout(() => {
              onTextSelection()
            }, 100)
          }}
          onTouchStart={(e) => {
            // Allow text selection to work properly on mobile
            e.stopPropagation()
          }}
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
              <Button variant="outline" size="sm" onClick={onPlaySelectedText}>
                <Play className="h-4 w-4 mr-2" />
                Play Selection
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onShowRegenerateDialog}
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
  )
}
