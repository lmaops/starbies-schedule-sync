import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  icsUrl: string | null
}

export default function IcsSubscribeLink({ icsUrl }: Props) {
  const [copied, setCopied] = useState(false)

  if (!icsUrl) return null

  const copy = () => {
    navigator.clipboard.writeText(icsUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex gap-2 min-w-0">
      <code className="flex-1 min-w-0 text-xs bg-muted rounded px-2 py-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
        {icsUrl}
      </code>
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  )
}
