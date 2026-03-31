#!/usr/bin/env node
'use strict';

/**
 * Starbucks schedule scraper module.
 *
 * Fetches credentials from the app API:
 *   GET {SCRAPE_API_URL}/internal/scrape/{SCRAPE_KEY}/credentials
 *
 * On success: POSTs shifts to /internal/scrape/{SCRAPE_KEY}/shifts
 * On failure: POSTs logs + screenshots to /internal/scrape/{SCRAPE_KEY}/failure
 *
 * Env vars:
 *   SCRAPE_KEY      — unique key for this scrape run (required)
 *   SCRAPE_API_URL  — base URL of the app API for callbacks (required)
 */

const puppeteer = require('puppeteer');

const LOGIN_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/rp/login';
const HOME_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/portal';
const SCHEDULE_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/portal/page?libraryContext=84bf32f75f0f0a6c1e719ee3bd358e7fc5a5eb2c8ecbff333a1280869185e4cf&menu=Partner-Self-Service-MeZVjkkVQXSIxAIfoPKGvA#wfmess-myschedule////';
const TARGET_DOMAIN = 'starbucks-wfmr.jdadelivers.com';
const WEEKS_EACH_DIRECTION = 1;

const SCRAPE_KEY = process.env.SCRAPE_KEY;
const SCRAPE_API_URL = process.env.SCRAPE_API_URL;

if (!SCRAPE_KEY || !SCRAPE_API_URL) {
  process.stderr.write('[scraper] SCRAPE_KEY and SCRAPE_API_URL env vars are required\n');
  process.exit(1);
}

// ── Diagnostics ────────────────────────────────────────────────────────

const logLines = [];
const screenshots = [];

const log = (...args) => {
  const line = '[scraper] ' + args.join(' ');
  process.stderr.write(line + '\n');
  logLines.push(line);
};

const delay = ms => new Promise(r => setTimeout(r, ms));

async function screenshot(page, label) {
  try {
    const b64 = await page.screenshot({ encoding: 'base64', type: 'png' });
    screenshots.push({ label, data: b64 });
    log(`Screenshot: ${label}`);
  } catch (e) {
    log(`Screenshot failed (${label}): ${e.message}`);
  }
}

// ── API ────────────────────────────────────────────────────────────────

async function postJSON(path, body) {
  const url = `${SCRAPE_API_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} returned ${res.status}`);
  return res.json();
}

async function fetchCredentials() {
  const url = `${SCRAPE_API_URL}/internal/scrape/${SCRAPE_KEY}/credentials`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  return res.json();
}

// ── Page helpers ───────────────────────────────────────────────────────
// Every helper that reads from or acts on the page retries once after a
// short settle delay.  This guards against the navigation race condition
// where Puppeteer's execution context is briefly invalid after a redirect
// even though networkidle2 has fired.

/** Retry-safe page title fetch. */
async function getTitle(page) {
  try {
    return await page.title();
  } catch (_) {
    await delay(500);
    return await page.title().catch(() => '');
  }
}

/** Retry-safe page.evaluate wrapper. */
async function evaluate(page, fn, ...args) {
  try {
    return await page.evaluate(fn, ...args);
  } catch (_) {
    await delay(500);
    return await page.evaluate(fn, ...args);
  }
}

/**
 * Wait for one of `selectors` to be visible, then return the first
 * visible element handle.  Throws with a screenshot on failure.
 */
async function findVisibleInput(page, selectors, { timeout = 15000, label = 'input' } = {}) {
  await page.waitForFunction(
    (sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return true;
      }
      return false;
    },
    { timeout },
    selectors,
  );

  // Small settle delay for any JS init after the element appears
  await delay(500);

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && await el.isIntersectingViewport().catch(() => false)) return el;
  }

  await screenshot(page, `${label}-not-found`);
  throw new Error(`No visible ${label} found (tried: ${selectors.join(', ')})`);
}

/** Type into a field with human-like delay. */
async function typeInto(page, selectors, text, opts = {}) {
  const el = await findVisibleInput(page, selectors, opts);
  await el.type(text, { delay: 50 });
  return el;
}

/** Find and click a submit button, or press Enter.  Waits for navigation. */
async function submitForm(page) {
  const btn = await page.$('input[type="submit"], button[type="submit"], button');
  if (btn) {
    await Promise.all([
      btn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    ]);
  } else {
    await Promise.all([
      page.keyboard.press('Enter'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    ]);
  }
}

/**
 * Click `selector` and wait for a matching API response.
 * Returns the response or null on timeout.
 */
async function clickAndWaitForAPI(page, selector, urlPattern, { timeout = 8000, settleMs = 1000 } = {}) {
  await delay(settleMs);
  const responsePromise = page.waitForResponse(
    r => r.url().includes(urlPattern) && r.status() === 200,
    { timeout },
  ).catch(() => null);
  await page.click(selector);
  return responsePromise;
}

/**
 * Poll until `checkFn(page)` returns truthy, up to `maxMs`.
 * Returns the truthy value, or null on timeout.
 */
async function pollUntil(page, checkFn, { maxMs = 60000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const result = await checkFn(page);
    if (result) return result;
    await delay(intervalMs);
  }
  return null;
}

// ── Data helpers ───────────────────────────────────────────────────────

function findSecurityAnswer(pageText, questions) {
  const normalized = pageText.toLowerCase();
  for (const entry of questions) {
    if (entry.question && normalized.includes(entry.question.toLowerCase())) {
      log(`Matched security question: "${entry.question}"`);
      return entry.answer;
    }
  }
  log('No security question matched; using first entry');
  return questions[0].answer;
}

function mergeScheduleData(weeks) {
  if (!weeks.length) return { days: [], homeSite: null };
  const merged = { ...weeks[0], days: [] };
  const seen = new Set();
  for (const week of weeks) {
    for (const day of week.days || []) {
      if (!seen.has(day.businessDate)) {
        seen.add(day.businessDate);
        merged.days.push(day);
      }
    }
  }
  merged.days.sort((a, b) => new Date(a.businessDate) - new Date(b.businessDate));
  return merged;
}

function extractShifts(data) {
  const shifts = [];
  if (!data.days) return shifts;
  const location = data.homeSite?.name || 'Work';
  for (const day of data.days) {
    for (const shift of day.payScheduledShifts || []) {
      shifts.push({
        start: shift.start,
        end: shift.end,
        job_name: shift.job?.name || 'Shift',
        net_hours: shift.netHours || 0,
        shift_id_ext: String(shift.scheduledShiftId),
        location,
      });
    }
  }
  return shifts;
}

// ── Username input selectors (broadest set that works) ─────────────────

const USERNAME_SELECTORS = [
  'input[type="text"]',
  'input[name="username"]',
  'input#username',
  'input[name="user"]',
  'input.username',
  'form input:not([type="submit"]):not([type="button"]):not([type="hidden"])',
];

// ── Main ───────────────────────────────────────────────────────────────

async function run() {
  log('Fetching credentials...');
  const creds = await fetchCredentials();
  const { username, password, security_questions: securityQuestions } = creds;
  if (!username || !password || !securityQuestions?.length) {
    throw new Error('Missing required credential fields');
  }

  log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const page = await browser.newPage();
    const capturedWeeks = [];

    // Intercept schedule API responses as they come in
    page.on('response', async response => {
      if (!response.url().includes('/mySchedules/')) return;
      try {
        const data = await response.json();
        if (data?.days) {
          capturedWeeks.push(data);
          log(`Captured week (${data.days.length} days), total: ${capturedWeeks.length}`);
        }
      } catch (_) {}
    });

    // ── Step 1: Login page ─────────────────────────────────────────────

    log('Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await screenshot(page, 'login-page');

    const title = await getTitle(page);
    if (title.includes('SAS - Level 3')) {
      log('SAS login detected, entering username...');
      await typeInto(page, USERNAME_SELECTORS, username, { label: 'username' });
      await submitForm(page);
      await screenshot(page, 'after-username');
    }

    // ── Step 2: Authentication ─────────────────────────────────────────

    log('Waiting for authentication...');
    const authenticated = await pollUntil(page, async (p) => {
      // Already on the target domain means we're through
      if (p.url().includes(TARGET_DOMAIN)) return 'domain';

      // Check for push notification bypass opportunity
      const hasBypass = await evaluate(p, () =>
        Array.from(document.querySelectorAll('a'))
          .some(a => a.textContent.includes('Device too far away'))
      ).catch(() => false);
      if (hasBypass) return 'bypass';

      return false;
    });

    if (authenticated === 'bypass') {
      log('Bypassing push notification via security question...');
      await screenshot(page, 'push-notification');

      await evaluate(page, () => {
        const link = Array.from(document.querySelectorAll('a'))
          .find(a => a.textContent.includes('Device too far away'));
        if (link) link.click();
      });

      // Security question
      await typeInto(page, ['input[type="password"]'],
        findSecurityAnswer(
          await evaluate(page, () => document.body.innerText).catch(() => ''),
          securityQuestions,
        ),
        { label: 'security-answer' },
      );
      await screenshot(page, 'security-question');
      await submitForm(page);

      // Password
      log('Entering password...');
      await typeInto(page, ['input[type="password"]'], password, { label: 'password' });
      await screenshot(page, 'password-entry');
      await submitForm(page);
    } else if (authenticated === 'domain') {
      log('Authenticated (redirected to portal)');
    } else {
      log('Authentication timeout — continuing anyway');
    }

    await screenshot(page, 'post-auth');

    // ── Step 3: Navigate to schedule ───────────────────────────────────

    log('Navigating to schedule page...');
    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await evaluate(page, url => { window.location.href = url; }, SCHEDULE_URL);

    const prevBtn = await findVisibleInput(page, ['#button-1028'], { label: 'prev-week button', timeout: 15000 })
      .catch(async (err) => { await screenshot(page, 'schedule-load-failed'); throw err; });
    await findVisibleInput(page, ['#button-1029'], { label: 'next-week button', timeout: 15000 });
    log('Schedule page loaded');
    await screenshot(page, 'schedule-page');

    // ── Step 4: Capture schedule weeks ─────────────────────────────────

    for (let i = 0; i < WEEKS_EACH_DIRECTION; i++) {
      await clickAndWaitForAPI(page, '#button-1028', '/mySchedules/');
      log(`← week -${i + 1}`);
    }
    for (let i = 0; i < WEEKS_EACH_DIRECTION * 2; i++) {
      await clickAndWaitForAPI(page, '#button-1029', '/mySchedules/');
      log(`→ week +${i + 1}`);
    }

    // Wait for any trailing API responses
    const expected = (WEEKS_EACH_DIRECTION * 2) + 1;
    await pollUntil(page, () => capturedWeeks.length >= expected, { maxMs: 5000 });
    if (capturedWeeks.length < expected) {
      log(`Warning: expected ${expected} weeks but captured ${capturedWeeks.length}`);
    }
    await screenshot(page, 'schedule-captured');

    // ── Step 5: Submit results ─────────────────────────────────────────

    const merged = mergeScheduleData(capturedWeeks);
    const shifts = extractShifts(merged);
    log(`${capturedWeeks.length} weeks, ${shifts.length} shifts`);

    await postJSON(`/internal/scrape/${SCRAPE_KEY}/shifts`, {
      shifts,
      home_site: merged.homeSite?.name || null,
    });
    log('Shifts submitted successfully');

  } finally {
    await browser.close();
  }
}

run().catch(async err => {
  log(`Error: ${err.message}`);
  try {
    await postJSON(`/internal/scrape/${SCRAPE_KEY}/failure`, {
      logs: logLines,
      screenshots: screenshots.map(s => s.data),
    });
  } catch (postErr) {
    process.stderr.write(`[scraper] Failed to post failure report: ${postErr.message}\n`);
  }
  process.exit(1);
});
