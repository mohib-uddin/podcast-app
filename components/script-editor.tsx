import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Play, RefreshCw } from "lucide-react"

interface ScriptEditorProps {
  script: string
  onScriptChange: (script: string) => void
  onGenerateAudio: () => void
  isGenerating: boolean
}

export function ScriptEditor({
  script,
  onScriptChange,
  onGenerateAudio,
  isGenerating
}: ScriptEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Podcast Script</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="Write your podcast script here..."
          value={script}
          onChange={(e) => onScriptChange(e.target.value)}
          className="min-h-[200px] text-base leading-relaxed"
        />
        <Button 
          onClick={onGenerateAudio} 
          disabled={!script.trim() || isGenerating} 
          className="w-full"
        >
          {isGenerating ? "Generating Audio..." : "Generate Audio"}
        </Button>
      </CardContent>
    </Card>
  )
}
