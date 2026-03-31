import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ScheduleResponse } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import CalendarTutorial from '@/components/CalendarTutorial'
import IcsSubscribeLink from '@/components/IcsSubscribeLink'
import AppFooter from '@/components/AppFooter'

function formatTime(iso: string, timezone: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  })
}

function formatDate(iso: string, timezone: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  })
}

function formatRelative(iso: string | null) {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 0) {
    const abs = -diff
    if (abs < 60000) return 'Any moment'
    if (abs < 3600000) return `in ${Math.floor(abs / 60000)}m`
    const h = Math.floor(abs / 3600000)
    const m = Math.floor((abs % 3600000) / 60000)
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
  }
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString()
}

interface Props {
  userTimezone: string
}

export default function Dashboard({ userTimezone }: Props) {
  const navigate = useNavigate()
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null)
  const [icsUrl, setIcsUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.schedule.get(), api.schedule.icsUrl()])
      .then(([sched, ics]) => {
        setSchedule(sched)
        setIcsUrl(ics.url)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [navigate])

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>

  const upcoming = schedule?.shifts.filter(s => new Date(s.end_time) > new Date()) ?? []
  const past = schedule?.shifts.filter(s => new Date(s.end_time) <= new Date()) ?? []

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ fontFamily: "'Dancing Script', cursive" }}>Starbies Schedule Sync</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>Settings</Button>
      </div>

      {/* Scrape status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sync status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last synced</span>
            <span>{formatRelative(schedule?.last_scraped_at ?? null)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Next sync</span>
            <span>{schedule?.next_scrape_at ? formatRelative(schedule.next_scrape_at) : 'Pending first sync'}</span>
          </div>
          <p className="text-xs text-muted-foreground pt-1">Syncs run automatically every 16–24 hours.</p>
        </CardContent>
      </Card>

      {/* Calendar subscription */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Subscribe to your calendar</CardTitle>
          <CardDescription>
            Copy this URL and subscribe in any calendar app (Apple Calendar, Google Calendar, etc.)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <IcsSubscribeLink icsUrl={icsUrl} />
          <CalendarTutorial icsUrl={icsUrl} />
        </CardContent>
      </Card>

      {/* Upcoming shifts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Upcoming shifts</CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No upcoming shifts found. Your schedule will sync automatically.
            </p>
          ) : (
            <div className="space-y-1">
              {upcoming.map(shift => (
                <div key={shift.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{formatDate(shift.start_time, userTimezone)}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatTime(shift.start_time, userTimezone)} – {formatTime(shift.end_time, userTimezone)}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary">{shift.job_name}</Badge>
                    <div className="text-xs text-muted-foreground mt-0.5">{shift.net_hours}h</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground mb-2">Recent past shifts</p>
              {past.slice(-3).reverse().map(shift => (
                <div key={shift.id} className="flex items-center justify-between py-1.5 text-sm opacity-50">
                  <div>
                    <div>{formatDate(shift.start_time, userTimezone)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTime(shift.start_time, userTimezone)} – {formatTime(shift.end_time, userTimezone)}
                    </div>
                  </div>
                  <Badge variant="outline">{shift.job_name}</Badge>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
      <AppFooter />
    </div>
  )
}
