import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ScrapeLog } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import StarbucksCredentialsForm, { type CredentialsFormData } from '@/components/StarbucksCredentialsForm'
import ScreenshotTimeline from '@/components/ScreenshotTimeline'
import AppFooter from '@/components/AppFooter'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

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

export default function Settings() {
  const navigate = useNavigate()
  const [credResult, setCredResult] = useState({ error: '', success: false })
  const [deleting, setDeleting] = useState(false)
  const [logs, setLogs] = useState<ScrapeLog[]>([])
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  useEffect(() => {
    api.scrapeLogs().then(r => setLogs(r.logs)).catch(() => {})
  }, [])

  const handleUpdateCredentials = async (data: CredentialsFormData) => {
    setCredResult({ error: '', success: false })
    try {
      await api.credentials.update(data)
      setCredResult({ error: '', success: true })
    } catch (err) {
      setCredResult({ error: errorMessage(err), success: false })
      throw err
    }
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await api.account.delete()
      window.location.href = '/login'
    } catch {
      setDeleting(false)
    }
  }

  const handleLogout = async () => {
    await api.auth.logout()
    navigate('/login')
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

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ fontFamily: "'Dancing Script', cursive" }}>Settings</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>← Dashboard</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Update Starbucks credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StarbucksCredentialsForm
            onSubmit={handleUpdateCredentials}
            submitLabel="Update credentials"
            error={credResult.error}
          />
          {credResult.success && <p className="text-sm text-green-600">Credentials updated successfully.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scrapes</CardTitle>
          <CardDescription>Your last 5 schedule sync runs.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="py-2 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">{new Date(log.started_at).toLocaleString()}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{duration(log.started_at, log.finished_at)}</span>
                    <StatusBadge status={log.status} />
                  </div>
                </div>
                {log.shifts_found != null && (
                  <div className="text-xs text-muted-foreground">
                    {log.shifts_found} shifts found, {log.shifts_new} new
                  </div>
                )}
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
            {logs.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No scrape history yet.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" className="w-full" onClick={handleLogout}>Sign out</Button>

          <AlertDialog>
            <AlertDialogTrigger className="w-full">
              <Button variant="destructive" className="w-full">Delete my account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes your account, stored credentials, and all synced schedule data.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete my account'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <AppFooter />
    </div>
  )
}
