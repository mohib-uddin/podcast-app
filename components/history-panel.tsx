import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Undo, Redo } from "lucide-react"
import { HistoryState } from "@/lib/types"

interface HistoryPanelProps {
  history: HistoryState[]
  historyIndex: number
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

export function HistoryPanel({
  history,
  historyIndex,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: HistoryPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onUndo} disabled={!canUndo}>
              <Undo className="h-4 w-4 mr-2" />
              Undo
            </Button>
            <Button variant="outline" size="sm" onClick={onRedo} disabled={!canRedo}>
              <Redo className="h-4 w-4 mr-2" />
              Redo
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            {history.length > 0 && (
              <span>
                Step {historyIndex + 1} of {history.length}
                {history[historyIndex] && ` - ${history[historyIndex].action}`}
              </span>
            )}
            {history.length === 0 && <span>No actions yet</span>}
          </div>
        </div>

        <div className="text-xs text-muted-foreground mt-2">
          Use Ctrl+Z (Cmd+Z) to undo, Ctrl+Y (Cmd+Shift+Z) to redo
        </div>
      </CardContent>
    </Card>
  )
}
