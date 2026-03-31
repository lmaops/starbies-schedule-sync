import { useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { api, type User } from '@/lib/api'
import Login from '@/pages/Login'
import Onboarding from '@/pages/Onboarding'
import Dashboard from '@/pages/Dashboard'
import Settings from '@/pages/Settings'
import Admin from '@/pages/Admin'
import Landing from '@/pages/Landing'
import Privacy from '@/pages/Privacy'

function ReturnPathRedirect() {
  const navigate = useNavigate()
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current) return
    checked.current = true
    const returnPath = sessionStorage.getItem('returnPath')
    if (returnPath && returnPath !== '/' && returnPath !== window.location.pathname) {
      sessionStorage.removeItem('returnPath')
      navigate(returnPath, { replace: true })
    }
  }, [navigate])
  return null
}

function Guard({ ok, redirectTo, children }: { ok: boolean; redirectTo: string; children: React.ReactNode }) {
  if (!ok) return <Navigate to={redirectTo} replace />
  return <>{children}</>
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [onboarded, setOnboarded] = useState(false)

  useEffect(() => {
    Promise.all([api.config().catch(() => ({ dev_mode: false })), api.auth.me().catch(() => null)])
      .then(async ([config, me]) => {
        if (!me && config.dev_mode) {
          me = await api.auth.devLogin().catch(() => null)
        }
        if (me) {
          const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
          if (browserTz && me.timezone !== browserTz) {
            await api.settings.updateTimezone(browserTz).catch(() => {})
            me.timezone = browserTz
          }
          const status = await api.onboardingStatus().catch(() => ({ has_credentials: false, has_successful_scrape: false }))
          // set both atomically so OnboardingGuard doesn't see stale onboarded=false
          setOnboarded(status.has_successful_scrape)
          setUser(me)
        } else {
          setUser(null)
        }
      })
  }, [])

  if (user === undefined) return null // loading

  return (
    <BrowserRouter>
      <ReturnPathRedirect />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/login" element={user ? <Navigate to={onboarded ? '/dashboard' : '/setup'} replace /> : <Login onLogin={async (u) => {
          const status = await api.onboardingStatus().catch(() => ({ has_credentials: false, has_successful_scrape: false }))
          setOnboarded(status.has_successful_scrape)
          setUser(u)
        }} />} />
        <Route path="/setup" element={
          <Guard ok={!!user} redirectTo="/login">
            <Onboarding onScrapeSuccess={() => setOnboarded(true)} />
          </Guard>
        } />
        <Route path="/dashboard" element={
          <Guard ok={!!user} redirectTo="/login">
            <Guard ok={onboarded} redirectTo="/setup">
              <Dashboard userTimezone={user?.timezone ?? 'America/Chicago'} />
            </Guard>
          </Guard>
        } />
        <Route path="/settings" element={
          <Guard ok={!!user} redirectTo="/login">
            <Guard ok={onboarded} redirectTo="/setup">
              <Settings />
            </Guard>
          </Guard>
        } />
        <Route path="/admin" element={
          <Guard ok={!!user} redirectTo="/login">
            <Guard ok={!!user?.is_admin} redirectTo="/dashboard">
              <Admin />
            </Guard>
          </Guard>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
