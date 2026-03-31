import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'

export default function AppFooter() {
  const [sha, setSha] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    api.config().then(c => { setSha(c.commit_sha); setUrl(c.commit_url) }).catch(() => {})
  }, [])

  return (
    <p className="text-center text-xs text-muted-foreground pb-2">
      <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy & Your Data</Link>
      {' · '}
      Starbies Schedule Scraper by Liz M. A. et. al.
      {sha && (
        <> &mdash; commit{' '}
          {url
            ? <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{sha}</a>
            : sha
          }
        </>
      )}
    </p>
  )
}
