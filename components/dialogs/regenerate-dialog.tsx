import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

interface RegenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedText: string
  isRegenerating: boolean
  onRegenerate: () => void
}

export function RegenerateDialog({
  open,
  onOpenChange,
  selectedText,
  isRegenerating,
  onRegenerate
}: RegenerateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate Audio Segment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Selected text:</p>
            <div className="p-3 bg-muted rounded-lg border-l-4 border-orange-500">
              <p className="text-sm">"{selectedText}"</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            This will regenerate the audio for the selected text portion and show you a merge preview.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onRegenerate} disabled={isRegenerating}>
            {isRegenerating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Regenerating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate Selection
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
