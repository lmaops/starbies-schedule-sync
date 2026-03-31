export interface User {
  id: string
  email: string
  is_admin: boolean
  timezone: string
  created_at: string
}

export interface Shift {
  id: string
  job_name: string
  location: string
  start_time: string
  end_time: string
  net_hours: number
}

export interface ScheduleResponse {
  shifts: Shift[]
  last_scraped_at: string | null
  next_scrape_at: string | null
}

export interface ScrapeLog {
  id: string
  user_id: string
  email?: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'success' | 'failure'
  shifts_found: number | null
  shifts_new: number | null
  error_message: string | null
  log_output: string | null
  failure_screenshots: string | null
}

export interface ScrapeStatus {
  status: 'running' | 'success' | 'failure' | null
  started_at: string | null
  finished_at: string | null
  error_message: string | null
  shifts_found: number | null
  failure_screenshots: string[] | null
  log_output: string[] | null
}

export interface OnboardingStatus {
  has_credentials: boolean
  has_successful_scrape: boolean
}

// Cache a promise so concurrent/repeated calls share one in-flight request.
const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined
  if (!p) {
    p = fn().catch(err => { cache.delete(key); throw err })
    cache.set(key, p)
  }
  return p
}

function handleBotBarrier(): never {
  sessionStorage.setItem('returnPath', window.location.pathname + window.location.search)
  window.location.href = '/'
  throw new Error('Bot barrier challenge required')
}

async function request<T>(path: string, options: RequestInit = {}, redirectOn401 = true): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    handleBotBarrier()
  }

  if (res.status === 401) {
    if (redirectOn401) window.location.href = '/login'
    throw new Error('Not authenticated')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  config: () => cached('config', () => request<{ dev_mode: boolean; commit_sha: string; commit_url: string }>('/api/config', {}, false)),
  auth: {
    requestPin: (email: string) =>
      request('/api/auth/request-pin', { method: 'POST', body: JSON.stringify({ email }) }),
    verifyPin: (email: string, pin: string) =>
      request<User>('/api/auth/verify-pin', { method: 'POST', body: JSON.stringify({ email, pin }) }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    me: () => request<User>('/api/auth/me', {}, false),
    devLogin: () => request<User>('/api/auth/dev-login', { method: 'POST' }, false),
  },
  credentials: {
    save: (data: { username: string; password: string; security_questions: { question: string; answer: string }[] }) =>
      request('/api/credentials', { method: 'POST', body: JSON.stringify(data) }),
    update: (data: { username: string; password: string; security_questions: { question: string; answer: string }[] }) =>
      request('/api/credentials', { method: 'PUT', body: JSON.stringify(data) }),
  },
  schedule: {
    get: () => request<ScheduleResponse>('/api/schedule'),
    icsUrl: () => cached('icsUrl', () => request<{ url: string }>('/api/calendar/ics-url')),
  },
  account: {
    delete: () => request('/api/account', { method: 'DELETE' }),
  },
  settings: {
    updateTimezone: (timezone: string) =>
      request<User>('/api/settings/timezone', { method: 'PATCH', body: JSON.stringify({ timezone }) }),
  },
  scrapeStatus: () => request<ScrapeStatus>('/api/scrape-status'),
  scrapeLogs: () => request<{ logs: ScrapeLog[] }>('/api/scrape-logs'),
  onboardingStatus: () => request<OnboardingStatus>('/api/onboarding-status'),
  admin: {
    logs: () => request<{ logs: ScrapeLog[] }>('/api/admin/scrape-logs'),
    users: () => request<{ users: unknown[] }>('/api/admin/users'),
    triggerScrape: (userId: string) => request(`/api/admin/trigger-scrape/${userId}`, { method: 'POST' }),
  },
}
