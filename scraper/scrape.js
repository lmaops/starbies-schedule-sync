#!/usr/bin/env node
'use strict';

/**
 * Starbucks schedule scraper module.
 *
 * Fetches credentials from the app API using the scrape key:
 *   GET {SCRAPE_API_URL}/internal/scrape/{SCRAPE_KEY}/credentials
 *   -> { "username": "...", "password": "...", "security_questions": [...] }
 *
 * Env vars:
 *   SCRAPE_KEY      — unique key for this scrape run (required)
 *   SCRAPE_API_URL  — base URL of the app API for callbacks (required)
 *
 * On success: POSTs shifts to {SCRAPE_API_URL}/internal/scrape/{SCRAPE_KEY}/shifts
 * On failure: POSTs logs + screenshots to {SCRAPE_API_URL}/internal/scrape/{SCRAPE_KEY}/failure
 *
 * Exits 0 on success, 1 on failure.
 */

const puppeteer = require('puppeteer');

const STARBUCKS_LOGIN_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/rp/login';
const STARBUCKS_HOME_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/portal';
const STARBUCKS_SCHEDULE_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/portal/page?libraryContext=84bf32f75f0f0a6c1e719ee3bd358e7fc5a5eb2c8ecbff333a1280869185e4cf&menu=Partner-Self-Service-MeZVjkkVQXSIxAIfoPKGvA#wfmess-myschedule////';
const WEEKS_EACH_DIRECTION = 1;

const SCRAPE_KEY = process.env.SCRAPE_KEY;
const SCRAPE_API_URL = process.env.SCRAPE_API_URL;

if (!SCRAPE_KEY || !SCRAPE_API_URL) {
  process.stderr.write('[scraper] SCRAPE_KEY and SCRAPE_API_URL env vars are required\n');
  process.exit(1);
}

// ── Logging & diagnostics ──────────────────────────────────────────────

const logLines = [];
const screenshots = [];

const log = (...args) => {
  const line = '[scraper] ' + args.join(' ');
  process.stderr.write(line + '\n');
  logLines.push(line);
};

const delay = ms => new Promise(r => setTimeout(r, ms));

async function takeScreenshot(page, label) {
  try {
    const b64 = await page.screenshot({ encoding: 'base64', type: 'png' });
    screenshots.push({ label, data: b64 });
    log(`Screenshot captured: ${label}`);
  } catch (e) {
    log(`Screenshot failed (${label}): ${e.message}`);
  }
}

// ── API helpers ────────────────────────────────────────────────────────

async function postJSON(path, body) {
  const url = `${SCRAPE_API_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} returned ${res.status}`);
  }
  return res.json();
}

async function fetchCredentials() {
  const url = `${SCRAPE_API_URL}/internal/scrape/${SCRAPE_KEY}/credentials`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    throw new Error(`GET ${url} returned ${res.status}`);
  }
  return res.json();
}

// ── Schedule data helpers ──────────────────────────────────────────────

function findSecurityAnswer(pageText, securityQuestions) {
  const normalized = pageText.toLowerCase();
  for (const entry of securityQuestions) {
    if (entry.question && normalized.includes(entry.question.toLowerCase())) {
      log(`Matched security question: "${entry.question}"`);
      return entry.answer;
    }
  }
  log('No security question matched page text; using first entry as fallback');
  return securityQuestions[0].answer;
}

function mergeScheduleData(weeksData) {
  if (weeksData.length === 0) return { days: [], homeSite: null };
  const merged = { ...weeksData[0], days: [] };
  const seen = new Set();
  for (const week of weeksData) {
    if (!week.days) continue;
    for (const day of week.days) {
      if (!seen.has(day.businessDate)) {
        seen.add(day.businessDate);
        merged.days.push(day);
      }
    }
  }
  merged.days.sort((a, b) => new Date(a.businessDate) - new Date(b.businessDate));
  return merged;
}

function extractShifts(scheduleData) {
  const shifts = [];
  if (!scheduleData.days) return shifts;
  const location = scheduleData.homeSite?.name || 'Work';
  for (const day of scheduleData.days) {
    if (!day.payScheduledShifts?.length) continue;
    for (const shift of day.payScheduledShifts) {
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

// ── Auth helpers ───────────────────────────────────────────────────────

async function submitForm(page) {
  const submitBtn = await page.$('input[type="submit"], button[type="submit"], button');
  if (submitBtn) {
    await Promise.all([
      submitBtn.click(),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    ]);
  } else {
    await Promise.all([
      page.keyboard.press('Enter'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    ]);
  }
}

async function handleSASLogin(page, username) {
  log('SAS Level 3 login detected, entering username...');

  await page.waitForFunction(
    (sels) => {
      for (const sel of sels) {
        const elem = document.querySelector(sel);
        if (elem && elem.offsetParent !== null) return true;
      }
      return false;
    },
    { timeout: 15000 },
    ['input[type="text"]', 'input[type="password"]', 'input[name="username"]',
     'input[name="user"]', 'input.username', 'input#username',
     'form input:not([type="submit"]):not([type="button"]):not([type="hidden"])']
  );

  await delay(1000);

  const selectors = [
    'input[type="text"]', 'input[name="username"]', 'input#username',
    'input[name="user"]', 'input.username',
    'form input:not([type="submit"]):not([type="button"]):not([type="hidden"])',
  ];
  let inputField = null;
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && await el.isIntersectingViewport()) { inputField = el; break; }
  }
  if (!inputField) throw new Error('Could not find username input on SAS page');

  await inputField.type(username, { delay: 50 });
  log('Username entered, submitting...');
  await submitForm(page);
  log('SAS login form submitted');
}

async function bypassPushNotification(page, password, securityQuestions) {
  log('Push notification page detected, using security question bypass...');
  await takeScreenshot(page, 'push-notification-page');

  // Click "Device too far away" link
  await page.evaluate(() => {
    const link = Array.from(document.querySelectorAll('a'))
      .find(a => a.textContent.includes('Device too far away'));
    if (link) link.click();
  });

  // Wait for and fill security question
  await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const answer = findSecurityAnswer(pageText, securityQuestions);
  log('Entering security question answer...');
  const secField = await page.$('input[type="password"]');
  await secField.type(answer, { delay: 50 });
  await takeScreenshot(page, 'security-question');
  await submitForm(page);

  // Wait for and fill password
  await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
  log('Entering password...');
  const pwField = await page.$('input[type="password"]');
  await pwField.type(password, { delay: 50 });
  await takeScreenshot(page, 'password-entry');
  await submitForm(page);

  log('Push notification bypass complete');
}

async function waitForAuthentication(page, password, securityQuestions) {
  log('Waiting for authentication...');
  const targetDomain = 'starbucks-wfmr.jdadelivers.com';
  const maxWait = 60000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    if (page.url().includes(targetDomain)) {
      log('Authenticated successfully');
      return;
    }

    const hasDeviceTooFar = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .some(a => a.textContent.includes('Device too far away'))
    ).catch(() => false);

    if (hasDeviceTooFar) {
      await bypassPushNotification(page, password, securityQuestions);
      return;
    }

    await delay(500);
  }

  log('Authentication timeout - continuing anyway');
}

// ── Schedule navigation ────────────────────────────────────────────────

async function clickWeekButton(page, selector, label) {
  await delay(1000);
  log(`${label}: Clicking...`);

  const responsePromise = page.waitForResponse(
    r => r.url().includes('/mySchedules/') && r.status() === 200,
    { timeout: 8000 },
  ).catch(() => {
    log(`${label}: Response timeout (continuing)`);
    return null;
  });

  await page.click(selector);
  const response = await responsePromise;

  if (response) {
    log(`${label}: API response received`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function run() {
  // Fetch credentials from the service
  log('Fetching credentials...');
  const creds = await fetchCredentials();
  const { username, password, security_questions: securityQuestions } = creds;

  if (!username || !password || !securityQuestions?.length) {
    throw new Error('Missing required credential fields');
  }

  log('Launching browser...');
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
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

    // Set up response listener to capture schedule API responses
    page.on('response', async response => {
      if (response.url().includes('/mySchedules/')) {
        try {
          const data = await response.json();
          if (data?.days) {
            capturedWeeks.push(data);
            log(`Captured week data (${data.days.length} days), total: ${capturedWeeks.length}`);
          }
        } catch (_) {}
      }
    });

    // Step 1: Navigate to login
    log('Navigating to login page...');
    await page.goto(STARBUCKS_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await takeScreenshot(page, 'login-page');

    // Handle SAS Level 3 login if present
    const pageTitle = await page.title().catch(() => '');
    if (pageTitle.includes('SAS - Level 3')) {
      await handleSASLogin(page, username);
      await takeScreenshot(page, 'after-sas-username');
    }

    // Step 2: Wait for auth (push notification bypass or manual)
    await waitForAuthentication(page, password, securityQuestions);
    await takeScreenshot(page, 'post-auth');

    // Step 3: Navigate to schedule page
    log('Navigating to home page...');
    await page.goto(STARBUCKS_HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    log('Navigating to schedule page...');
    await page.evaluate(url => { window.location.href = url; }, STARBUCKS_SCHEDULE_URL);

    // Wait for navigation buttons to confirm schedule SPA has loaded
    try {
      await page.waitForSelector('#button-1028', { visible: true, timeout: 15000 });
      await page.waitForSelector('#button-1029', { visible: true, timeout: 15000 });
      log('Schedule page loaded');
    } catch (error) {
      await takeScreenshot(page, 'schedule-load-failed');
      throw new Error('Navigation buttons not found - schedule page failed to load');
    }
    await takeScreenshot(page, 'schedule-page');

    // Step 4: Navigate weeks to capture schedule data
    // Go backward
    for (let i = 0; i < WEEKS_EACH_DIRECTION; i++) {
      await clickWeekButton(page, '#button-1028', `← week -${i + 1}`);
    }
    // Go forward (double to get back to center and ahead)
    for (let i = 0; i < WEEKS_EACH_DIRECTION * 2; i++) {
      await clickWeekButton(page, '#button-1029', `→ week +${i + 1}`);
    }

    // Wait for any trailing responses
    const expectedWeeks = (WEEKS_EACH_DIRECTION * 2) + 1;
    let waitAttempts = 0;
    while (capturedWeeks.length < expectedWeeks && waitAttempts < 10) {
      await delay(500);
      waitAttempts++;
    }

    if (capturedWeeks.length < expectedWeeks) {
      log(`Warning: expected ${expectedWeeks} weeks but captured ${capturedWeeks.length}`);
    }
    await delay(500);
    await takeScreenshot(page, 'schedule-captured');

    log(`Total weeks captured: ${capturedWeeks.length}`);

    // Merge and extract shifts
    const merged = mergeScheduleData(capturedWeeks);
    const shifts = extractShifts(merged);
    log(`Shifts found: ${shifts.length}`);

    // POST results to the API
    await postJSON(`/internal/scrape/${SCRAPE_KEY}/shifts`, {
      shifts,
      home_site: merged.homeSite?.name || null,
    });
    log('Shifts submitted to API successfully');

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
