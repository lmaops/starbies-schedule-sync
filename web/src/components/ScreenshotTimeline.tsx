import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  screenshots: string[]
}

export default function ScreenshotTimeline({ screenshots }: Props) {
  const total = screenshots.length
  const [index, setIndex] = useState(total - 1)

  useEffect(() => {
    setIndex(screenshots.length - 1)
  }, [screenshots])

  if (total === 0) return null

  const src = screenshots[index]
  const dataUri = src.startsWith('data:') ? src : `data:image/png;base64,${src}`

  return (
    <div className="space-y-2">
      <div className="border rounded overflow-hidden bg-muted">
        <img src={dataUri} alt={`Screenshot ${index + 1} of ${total}`} className="w-full" />
      </div>
      {total > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={index === 0}
            onClick={() => setIndex(i => i - 1)}
            aria-label="Previous screenshot"
          >
            ‹
          </Button>
          <input
            type="range"
            min={0}
            max={total - 1}
            value={index}
            onChange={e => setIndex(Number(e.target.value))}
            className="flex-1 h-1.5 accent-primary cursor-pointer"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={index === total - 1}
            onClick={() => setIndex(i => i + 1)}
            aria-label="Next screenshot"
          >
            ›
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
            {index + 1} / {total}
          </span>
        </div>
      )}
    </div>
  )
}
