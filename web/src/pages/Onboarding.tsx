import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ScrapeStatus } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import ScreenshotTimeline from '@/components/ScreenshotTimeline'
import StarbucksCredentialsForm, { type CredentialsFormData } from '@/components/StarbucksCredentialsForm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import AppFooter from '@/components/AppFooter'

type OnboardingStep = 'loading' | 'form' | 'scraping' | 'success' | 'failure'

const POLL_INTERVAL = 3000
const SLOW_THRESHOLD = 150_000 // 2.5 minutes
const TIMEOUT_THRESHOLD = 240_000 // 4 minutes

interface OnboardingProps {
  onScrapeSuccess?: () => void
}

export default function Onboarding({ onScrapeSuccess }: OnboardingProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<OnboardingStep>('loading')
  const [error, setError] = useState('')
  const [isRetry, setIsRetry] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<ScrapeStatus | null>(null)
  const [isSlow, setIsSlow] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrapeStartRef = useRef<number>(0)
  // when true, wait for a fresh 'running' log before accepting terminal status;
  // prevents latching onto the previous scrape result
  const awaitingNewScrapeRef = useRef(false)

  // on mount, check if there's already a running scrape
  useEffect(() => {
    api.scrapeStatus()
      .then(status => {
        if (status.status === 'running') {
          scrapeStartRef.current = Date.now()
          awaitingNewScrapeRef.current = false
          setStep('scraping')
          startPolling()
        } else {
          setStep('form')
        }
      })
      .catch(() => setStep('form'))

    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const startPolling = () => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const status = await api.scrapeStatus()
        const elapsed = Date.now() - scrapeStartRef.current

        if (elapsed > SLOW_THRESHOLD) setIsSlow(true)

        // waiting for new scrape: only accept 'running'; skip stale terminal states
        if (awaitingNewScrapeRef.current) {
          if (status.status === 'running') {
            awaitingNewScrapeRef.current = false
          } else if (elapsed > TIMEOUT_THRESHOLD) {
            // gave up waiting — scrape never appeared; fall through to timeout handler
            awaitingNewScrapeRef.current = false
          } else {
            // still seeing old/null result — keep polling
            return
          }
        }

        if (status.status === 'success') {
          stopPolling()
          setScrapeResult(status)
          onScrapeSuccess?.()
          setStep('success')
        } else if (status.status === 'failure') {
          stopPolling()
          setScrapeResult(status)
          setStep('failure')
        } else if (elapsed > TIMEOUT_THRESHOLD) {
          stopPolling()
          setScrapeResult({
            status: 'failure',
            started_at: null,
            finished_at: null,
            error_message: 'The connection attempt timed out. Please try again.',
            shifts_found: null,
            failure_screenshots: null,
            log_output: null,
          })
          setStep('failure')
        }
      } catch {
        // network error — keep polling
      }
    }, POLL_INTERVAL)
  }

  const handleSubmit = async (data: CredentialsFormData) => {
    setError('')
    try {
      if (isRetry) {
        await api.credentials.update(data)
      } else {
        await api.credentials.save(data)
      }
      scrapeStartRef.current = Date.now()
      awaitingNewScrapeRef.current = true
      setIsSlow(false)
      setStep('scraping')
      startPolling()
    } catch (err) {
      setError(errorMessage(err))
      throw err // re-throw so the form resets its submitting state
    }
  }

  const handleRetry = () => {
    setIsRetry(true)
    setScrapeResult(null)
    setIsSlow(false)
    setStep('form')
  }

  if (step === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-background p-4 text-muted-foreground">Loading…</div>
  }

  const screenshots = scrapeResult?.failure_screenshots ?? []

  let card: React.ReactNode
  if (step === 'scraping') {
    card = (
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle>Connecting to Starbucks…</CardTitle>
          <CardDescription>
            We're signing in and fetching your schedule. This usually takes about a minute.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-muted border-t-primary" />
          {isSlow && (
            <p className="text-sm text-muted-foreground text-center">
              Taking longer than expected… still working on it.
            </p>
          )}
        </CardContent>
      </Card>
    )
  } else if (step === 'success') {
    card = (
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle>You're all set!</CardTitle>
          <CardDescription>
            {scrapeResult?.shifts_found != null
              ? `We found ${scrapeResult.shifts_found} shift${scrapeResult.shifts_found === 1 ? '' : 's'} on your schedule.`
              : 'Your schedule has been synced successfully.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={() => navigate('/dashboard')}>View your schedule</Button>
        </CardContent>
      </Card>
    )
  } else if (step === 'failure') {
    card = (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Connection failed</CardTitle>
          <CardDescription>
            Your credentials may be incorrect or a security question didn't match.
            {screenshots.length > 0 && ' The screenshots below show where the connection failed.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {screenshots.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Failure screenshots</p>
              <ScreenshotTimeline screenshots={screenshots} />
            </div>
          )}
          <Button onClick={handleRetry} className="w-full">
            Try again with different credentials
          </Button>
        </CardContent>
      </Card>
    )
  } else {
    card = (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{isRetry ? 'Update your credentials' : 'Connect your Starbucks account'}</CardTitle>
          <CardDescription>
            {isRetry
              ? 'Double-check your global username, password, and security questions, then try again.'
              : 'Your credentials are encrypted and stored securely. We use them to fetch your schedule automatically.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StarbucksCredentialsForm
            onSubmit={handleSubmit}
            submitLabel={isRetry ? 'Update & retry' : 'Connect account & start syncing'}
            submittingLabel="Saving..."
            error={error}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background p-4">
      <div className="flex-1 flex items-center justify-center">
        {card}
      </div>
      <AppFooter />
    </div>
  )
}
