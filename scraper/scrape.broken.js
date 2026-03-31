#!/usr/bin/env node
'use strict';

/**
 * Starbucks schedule scraper module.
 *
 * Fetches credentials from the app API using the scrape key:
 *   GET {SCRAPE_API_URL}/internal/scrape/{SCRAPE_KEY}/credentials
 *   -> { "username": "...", "password": "...", "security_questions": [{"question": "...", "answer": "..."}] }
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

function findSecurityAnswer(pageText, securityQuestions) {
  const normalized = pageText.toLowerCase();
  for (const entry of securityQuestions) {
    if (entry.question && normalized.includes(entry.question.toLowerCase())) {
      return entry.answer;
    }
  }
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

async function run() {
  const creds = await fetchCredentials();
  const { username, password, security_questions: securityQuestions } = creds;

  if (!username || !password || !securityQuestions?.length) {
    throw new Error('Missing required credential fields');
  }

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

    // Intercept schedule API responses
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

    const pageTitle = await page.title().catch(() => '');
    if (pageTitle.includes('SAS - Level 3')) {
      log('SAS Level 3 login detected, entering username...');
      await page.waitForFunction(
        () => document.querySelector('input[type="text"], input[type="password"], input[name="username"]')?.offsetParent !== null,
        { timeout: 15000 }
      );
      await delay(500);

      const selectors = ['input[type="text"]', 'input[name="username"]', 'input#username'];
      let inputField = null;
      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el && await el.isIntersectingViewport()) { inputField = el; break; }
      }
      if (!inputField) throw new Error('Could not find username input on SAS page');

      await inputField.type(username, { delay: 50 });
      const submitBtn = await page.$('input[type="submit"], button[type="submit"], button');
      if (submitBtn) {
        await Promise.all([submitBtn.click(), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })]);
      } else {
        await Promise.all([page.keyboard.press('Enter'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })]);
      }
      await takeScreenshot(page, 'after-sas-username');
    }

    // Step 2: Wait for auth / bypass push notification
    log('Waiting for authentication...');
    const targetDomain = 'starbucks-wfmr.jdadelivers.com';
    const maxWait = 60000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      if (page.url().includes(targetDomain)) {
        log('Authenticated successfully');
        break;
      }

      const hasDeviceTooFar = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a')).some(a => a.textContent.includes('Device too far away'))
      ).catch(() => false);

      if (hasDeviceTooFar) {
        log('Push notification page detected, using security question bypass...');
        await takeScreenshot(page, 'push-notification-page');
        await page.evaluate(() => {
          const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Device too far away'));
          if (link) link.click();
        });

        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
        const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
        const answer = findSecurityAnswer(pageText, securityQuestions);
        log('Entering security question answer...');
        const secField = await page.$('input[type="password"]');
        await secField.type(answer, { delay: 50 });
        await takeScreenshot(page, 'security-question');

        const btn1 = await page.$('input[type="submit"], button[type="submit"], button');
        if (btn1) {
          await Promise.all([btn1.click(), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })]);
        } else {
          await Promise.all([page.keyboard.press('Enter'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })]);
        }

        await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
        log('Entering password...');
        const pwField = await page.$('input[type="password"]');
        await pwField.type(password, { delay: 50 });
        await takeScreenshot(page, 'password-entry');

        const btn2 = await page.$('input[type="submit"], button[type="submit"], button');
        if (btn2) {
          await Promise.all([btn2.click(), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })]);
        } else {
          await Promise.all([page.keyboard.press('Enter'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })]);
        }
        break;
      }

      await delay(500);
    }

    await takeScreenshot(page, 'post-auth');

    // Step 3: Navigate to schedule page
    log('Navigating to home page...');
    await page.goto(STARBUCKS_HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    log('Navigating to schedule page...');
    await page.evaluate(url => { window.location.href = url; }, STARBUCKS_SCHEDULE_URL);

    await page.waitForSelector('#button-1028', { visible: true, timeout: 15000 });
    await page.waitForSelector('#button-1029', { visible: true, timeout: 15000 });
    log('Schedule page loaded');
    await takeScreenshot(page, 'schedule-page');

    // Step 4: Navigate weeks to capture schedule data
    const clickAndWait = async (selector, label) => {
      await delay(1000);
      const responsePromise = page.waitForResponse(
        r => r.url().includes('/mySchedules/') && r.status() === 200,
        { timeout: 8000 }
      ).catch(() => null);
      await page.click(selector);
      await responsePromise;
      log(`${label} done`);
    };

    for (let i = 0; i < WEEKS_EACH_DIRECTION; i++) {
      await clickAndWait('#button-1028', `← week -${i + 1}`);
    }
    for (let i = 0; i < WEEKS_EACH_DIRECTION * 2; i++) {
      await clickAndWait('#button-1029', `→ week +${i + 1}`);
    }

    await delay(1000);
    await takeScreenshot(page, 'schedule-captured');

    log(`Total weeks captured: ${capturedWeeks.length}`);

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
  // Capture a final screenshot if possible — browser may already be closed
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
