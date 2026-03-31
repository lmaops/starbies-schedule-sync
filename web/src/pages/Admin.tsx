import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ScrapeLog } from '@/lib/api'
import ScreenshotTimeline from '@/components/ScreenshotTimeline'
import AppFooter from '@/components/AppFooter'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return <Badge className="bg-green-100 text-green-800">Success</Badge>
  if (status === 'failure') return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="secondary">Running</Badge>
}

function duration(start: string, end: string | null) {
  if (!end) return '…'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return `${Math.round(ms / 1000)}s`
}

function tryParseJSON(value: string | null): string[] | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function ScrapeLogDetails({ log }: { log: ScrapeLog }) {
  const logs = tryParseJSON(log.log_output)
  const screenshots = tryParseJSON(log.failure_screenshots)

  if (!logs?.length && !screenshots?.length) return null

  return (
    <div className="mt-2 space-y-3">
      {logs && logs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Scraper logs</p>
          <pre className="text-xs bg-muted rounded px-3 py-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
            {logs.join('\n')}
          </pre>
        </div>
      )}
      {screenshots && screenshots.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Failure screenshots</p>
          <ScreenshotTimeline screenshots={screenshots} />
        </div>
      )}
    </div>
  )
}

export default function Admin() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState<ScrapeLog[]>([])
  const [users, setUsers] = useState<{ id: string; email: string; shift_count: number; last_status: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())

  const load = () => {
    Promise.all([api.admin.logs(), api.admin.users()])
      .then(([l, u]) => {
        setLogs(l.logs)
        setUsers(u.users as { id: string; email: string; shift_count: number; last_status: string | null }[])
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const trigger = async (userId: string) => {
    await api.admin.triggerScrape(userId)
    setTimeout(load, 1000)
  }

  const toggleExpand = (logId: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev)
      if (next.has(logId)) next.delete(logId)
      else next.add(logId)
      return next
    })
  }

  const hasDetails = (log: ScrapeLog) =>
    (log.log_output && log.log_output !== '[]') || (log.failure_screenshots && log.failure_screenshots !== '[]')

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>← Dashboard</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{u.email}</div>
                  <div className="text-xs text-muted-foreground">{u.shift_count} shifts</div>
                </div>
                <div className="flex items-center gap-2">
                  {u.last_status && <StatusBadge status={u.last_status} />}
                  <Button size="sm" variant="outline" onClick={() => trigger(u.id)}>
                    Scrape now
                  </Button>
                </div>
              </div>
            ))}
            {users.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No users yet.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scrape logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="py-2 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{log.email ?? log.user_id.slice(0, 8)}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{duration(log.started_at, log.finished_at)}</span>
                    <StatusBadge status={log.status} />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(log.started_at).toLocaleString()}
                  {log.shifts_found != null && ` · ${log.shifts_found} shifts found, ${log.shifts_new} new`}
                </div>
                {log.error_message && (
                  <p className="text-xs text-destructive font-mono">{log.error_message}</p>
                )}
                {hasDetails(log) && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6 px-2"
                      onClick={() => toggleExpand(log.id)}
                    >
                      {expandedLogs.has(log.id) ? 'Hide details' : 'Show details'}
                    </Button>
                    {expandedLogs.has(log.id) && <ScrapeLogDetails log={log} />}
                  </>
                )}
              </div>
            ))}
            {logs.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No scrape logs yet.</p>}
          </div>
        </CardContent>
      </Card>
      <AppFooter />
    </div>
  )
}
