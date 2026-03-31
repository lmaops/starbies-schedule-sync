const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const logger = require('./logger');
const { mergeScheduleData } = require('./utils');

const STARBUCKS_LOGIN_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/rp/login';
const STARBUCKS_SCHEDULE_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/portal/page?libraryContext=84bf32f75f0f0a6c1e719ee3bd358e7fc5a5eb2c8ecbff333a1280869185e4cf&siteId=10054&menu=Partner-Self-Service-MeZVjkkVQXSIxAIfoPKGvA#wfmess-myschedule////';

// Helper delay function (only for polling and final response wait)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const timestamp = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `[${hours}:${minutes}:${seconds}]`;
};

class WebScraper {
  constructor(profilePath, headless, loggerInstance) {
    this.profilePath = profilePath;
    this.headless = headless;
    this.logger = loggerInstance || logger;
    this.browser = null;
    this.page = null;
    this.capturedWeeks = [];
  }

  async scrape(weeksToFetch = 1, username, options = {}) {
    this.weeksToFetch = weeksToFetch;  // Store for use in other methods
    this.securityQuestions = options.securityQuestions || null;
    this.password = options.password || null;

    if (!username) {
      throw new Error('Username is required. Please run --setup to configure your username.');
    }

    this.logger.info('Launching browser...');

    // Verify profile path exists and is writable
    try {
      await fs.access(this.profilePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      this.logger.fail(`Error: Cannot access Chrome profile at: ${this.profilePath}`);
      this.logger.warn('Make sure the path exists and is writable');
      throw error;
    }

    try {
      await this._launchBrowser();
      await this._handleLogin(username);
      await this._navigateToSchedulePage();
      await this._setupResponseListener();
      await this._navigateWeeks(this.weeksToFetch);

      // Wait for any pending responses to be processed
      await this._waitForAllResponses(this.weeksToFetch);

      const allScheduleData = this.capturedWeeks;
      await this.close();

      this.logger.debug(`Complete! Captured ${allScheduleData.length} weeks of schedule data`);

      // Merge all schedule data
      return mergeScheduleData(allScheduleData);

    } catch (error) {
      // Ensure browser closes even on error
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
      throw error;
    }
  }

  _findSecurityAnswer(pageText) {
    const questions = this.securityQuestions;
    const normalizedPage = pageText.toLowerCase();

    // Try to find an entry whose question text appears on the page
    for (const entry of questions) {
      if (entry.question && normalizedPage.includes(entry.question.toLowerCase())) {
        this.logger.debug(`Matched security question: "${entry.question}"`);
        return entry.answer;
      }
    }

    // No match — fall back to the first entry
    this.logger.debug(`No security question matched page text; using first entry as fallback`);
    return questions[0].answer;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  // ===== Private Methods =====

  async _launchBrowser() {
    try {
      this.browser = await puppeteer.launch({
        headless: this.headless,
        userDataDir: this.profilePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      });
      this.page = await this.browser.newPage();
    } catch (error) {
      if (error.message.includes('Failed to launch') || error.message.includes('Could not find')) {
        this.logger.fail('Error launching browser. Possible causes:');
        this.logger.warn('   1. Chrome/Chromium might already be running with this profile');
        this.logger.warn('   2. Profile directory is locked by another process');
        this.logger.warn('   3. Chrome is not installed properly');
        this.logger.notice('Try closing all Chrome windows and run the script again');
      }
      throw error;
    }
  }

  async _handleLogin(username) {
    const totalWeeks = (this.weeksToFetch * 2) + 1;
    this.logger.debug(`Fetching ${totalWeeks} week(s) of schedule data...`);

    // Navigate to the login portal first
    this.logger.debug(`Navigating to partner portal...`);
    await this.page.goto(STARBUCKS_LOGIN_URL, { waitUntil: 'networkidle2' });
    // REMOVED: await delay(2000) - redundant with networkidle2

    // Check if we're on the SAS Level 3 login page
    // Use try-catch to handle potential navigation race condition
    let pageTitle = '';
    try {
      pageTitle = await this.page.title();
    } catch (error) {
      // Page might have navigated, wait a moment and try again
      await delay(500);
      pageTitle = await this.page.title().catch(() => '');
    }

    if (pageTitle.includes('SAS - Level 3')) {
      this.logger.info(`SAS Level 3 login detected`);
      this.logger.debug(`Page title: "${pageTitle}"`);

      // Wait for the form to be fully rendered and interactive
      this.logger.info(`Waiting for login form to load...`);

      // Wait for input field to be present and visible
      this.logger.debug(`Looking for username input field...`);

      let inputField;
      try {
        // Try multiple selectors - SAS login pages can vary
        const selectors = [
          'input[type="text"]',
          'input[type="password"]',
          'input[name="username"]',
          'input[name="user"]',
          'input.username',
          'input#username',
          'form input:not([type="submit"]):not([type="button"]):not([type="hidden"])'
        ];

        // Wait for any of these selectors to appear
        await this.page.waitForFunction(
          (sels) => {
            for (const sel of sels) {
              const elem = document.querySelector(sel);
              if (elem && elem.offsetParent !== null) return true;
            }
            return false;
          },
          { timeout: 15000 },
          selectors
        );

        this.logger.debug(`Login form found!`);

        // Give the page a moment to finish any JavaScript initialization
        await delay(1000);

        // Find the first visible input field
        for (const selector of selectors) {
          inputField = await this.page.$(selector);
          if (inputField) {
            const isVisible = await inputField.isIntersectingViewport();
            if (isVisible) {
              this.logger.debug(`Found input field with selector: ${selector}`);
              break;
            }
          }
        }

        if (!inputField) {
          throw new Error('No visible input field found');
        }
      } catch (error) {
        // Take a screenshot for debugging
        await this.page.screenshot({ path: 'sas-login-debug.png' });
        this.logger.warn(`Screenshot saved to sas-login-debug.png`);
        await this.browser.close();
        throw new Error(`Could not find username field on SAS Level 3 login page: ${error.message}`);
      }

      this.logger.info(`Entering username: ${username}`);
      await inputField.type(username, { delay: 50 }); // Type with slight delay between keystrokes
      this.logger.debug(`Username entered successfully`);

      this.logger.debug(`Looking for submit button...`);
      const submitButton = await this.page.$('input[type="submit"], button[type="submit"], button');
      if (submitButton) {
        this.logger.info(`Submitting login form (via button click)...`);
        await Promise.all([
          submitButton.click(),
          this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        ]);
        this.logger.info(`Login form submitted successfully`);
      } else {
        this.logger.info(`Submitting login form (via Enter key)...`);
        await this.page.keyboard.press('Enter');
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        this.logger.info(`Login form submitted successfully`);
      }
    }

    // Wait for authentication to complete
    await this._waitForAuthentication();
  }

  async _waitForAuthentication() {
    this.logger.info(`Waiting for authentication to complete...`);

    // Poll for the accept symbol and wait for redirect to Starbucks domain
    let symbolFound = false;
    const pollInterval = 500;
    const maxPollTime = 60000;
    const pollStartTime = Date.now();
    const targetDomain = 'starbucks-wfmr.jdadelivers.com';

    while (Date.now() - pollStartTime < maxPollTime) {
      // Check if we've been redirected to the partner portal domain
      const currentUrl = this.page.url();
      if (currentUrl.includes(targetDomain)) {
        this.logger.success(`Authentication complete`);
        return;
      }

      if (this.securityQuestions && this.password) {
        // Check if "Device too far away" link is present (push notification page)
        const hasDeviceTooFarLink = await this.page.evaluate(() =>
          Array.from(document.querySelectorAll('a')).some(a => a.textContent.includes('Device too far away'))
        ).catch(() => false);

        if (hasDeviceTooFarLink) {
          await this._bypassPushNotification();
          return;
        }
      } else {
        // Check for authentication symbol (mobile authenticator flow)
        const symbol = await this.page.$eval('.accept-symbol', el => el.textContent.trim()).catch(() => null);
        if (symbol && !symbolFound) {
          symbolFound = true;
          this.logger.info(`Press "${symbol}" on your mobile authenticator.`);
        }
      }

      await delay(pollInterval);
    }

    this.logger.warn(`Authentication timeout - continuing anyway`);
  }

  async _bypassPushNotification() {
    this.logger.info(`Push notification page detected - using security question bypass...`);

    // Click "Device too far away" link
    this.logger.debug(`Clicking "Device too far away" link...`);
    await this.page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Device too far away'));
      if (link) link.click();
    });

    // Wait for security question page to load
    this.logger.debug(`Waiting for security question field...`);
    await this.page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });

    // Read the security question text from the page
    const pageText = await this.page.evaluate(() => document.body.innerText).catch(() => '');
    const answer = this._findSecurityAnswer(pageText);
    this.logger.info(`Entering security question answer...`);
    const securityField = await this.page.$('input[type="password"]');
    await securityField.type(answer, { delay: 50 });

    // Submit security question form
    const submitBtn1 = await this.page.$('input[type="submit"], button[type="submit"], button');
    if (submitBtn1) {
      await Promise.all([
        submitBtn1.click(),
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
      ]);
    } else {
      await Promise.all([
        this.page.keyboard.press('Enter'),
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
      ]);
    }

    // Wait for password page to load
    this.logger.debug(`Waiting for password field...`);
    await this.page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });

    // Fill password
    this.logger.info(`Entering password...`);
    const passwordField = await this.page.$('input[type="password"]');
    await passwordField.type(this.password, { delay: 50 });

    // Submit password form
    const submitBtn2 = await this.page.$('input[type="submit"], button[type="submit"], button');
    if (submitBtn2) {
      await Promise.all([
        submitBtn2.click(),
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
      ]);
    } else {
      await Promise.all([
        this.page.keyboard.press('Enter'),
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
      ]);
    }

    this.logger.success(`Push notification bypass complete`);
  }

  async _navigateToSchedulePage() {
    const currentUrl = this.page.url();
    this.logger.debug(`Current URL after login: ${currentUrl}`);

    // Navigate to home page first to reset state
    this.logger.debug(`Navigating to home page...`);
    const HOME_URL = 'https://starbucks-wfmr.jdadelivers.com/retail/portal?siteId=10054';
    await this.page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    this.logger.debug(`Home page loaded`);
    // REMOVED: await delay(1000) - not needed after networkidle2

    // Now navigate to the schedule page
    this.logger.debug(`Navigating to schedule page...`);

    // Use evaluate to change the URL client-side (works better for SPAs)
    await this.page.evaluate((url) => {
      window.location.href = url;
    }, STARBUCKS_SCHEDULE_URL);

    // Wait for navigation buttons to appear (this confirms SPA has loaded)
    this.logger.debug(`Waiting for navigation buttons to appear...`);
    // REMOVED: await delay(1000) - replaced with actual element wait below

    try {
      await this.page.waitForSelector('#button-1028', { visible: true, timeout: 15000 });
      await this.page.waitForSelector('#button-1029', { visible: true, timeout: 15000 });
      this.logger.debug(`Navigation buttons found - schedule page fully loaded`);
    } catch (error) {
      this.logger.fail(`Navigation buttons not found after 15 seconds!`);
      this.logger.debug(`Current URL: ${this.page.url()}`);

      // Take a screenshot for debugging
      await this.page.screenshot({ path: 'debug-screenshot.png' });
      this.logger.warn(`Screenshot saved to debug-screenshot.png`);

      throw new Error('Navigation buttons not found. Check screenshot for page state.');
    }
  }

  async _setupResponseListener() {
    // Set up a listener to capture ALL schedule API responses
    this.capturedWeeks = [];
    this.page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/mySchedules/')) {
        try {
          const data = await response.json();
          if (data && data.days) {
            this.capturedWeeks.push(data);
            this.logger.debug(`  Captured schedule data (${data.days.length} days) - Total: ${this.capturedWeeks.length}`);
          }
        } catch (error) {
          // Ignore parsing errors
        }
      }
    });

    this.logger.debug(`Initial schedule data captured: ${this.capturedWeeks.length} week(s)`);
  }

  async _navigateWeeks(weeksToFetch) {
    this.logger.debug(`Fetching ${weeksToFetch} weeks backward and ${weeksToFetch} weeks forward...`);

    // Go backward
    this.logger.debug(`Going backward ${weeksToFetch} week(s)...`);
    for (let i = 0; i < weeksToFetch; i++) {
      await this._clickWeekButton('#button-1028', `← Week -${i + 1}`);
    }

    // Go forward
    const totalForward = weeksToFetch * 2;
    this.logger.debug(`Going forward ${totalForward} week(s)...`);
    for (let i = 0; i < totalForward; i++) {
      await this._clickWeekButton('#button-1029', `→ Week +${i + 1}`);
    }
  }

  async _clickWeekButton(selector, label) {
    // TIMING FIX: Wait for API response after each click instead of fixed delay
    try {
      // Small delay to ensure page is ready after previous navigation
      await delay(1000);

      this.logger.debug(`  ${label}: Clicking...`);

      // Set up response watcher BEFORE clicking
      const responsePromise = this.page.waitForResponse(
        response => response.url().includes('/mySchedules/') && response.status() === 200,
        { timeout: 5000 }
      ).catch(() => {
        this.logger.warn(`  ${label}: Response timeout after 5s (continuing)`);
        return null;
      });

      // Click the button
      await this.page.click(selector);
      this.logger.debug(`  ${label}: Clicked, waiting for API response...`);

      // Wait for the API response
      const response = await responsePromise;

      if (response) {
        this.logger.debug(`  ${label}: API response received`);
      }
    } catch (error) {
      this.logger.warn(`  ${label}: Error: ${error.message}`);
    }
  }

  async _waitForAllResponses(weeksToFetch) {
    // TIMING FIX: Instead of fixed delay, verify we have expected number of responses
    const expectedWeeks = (weeksToFetch * 2) + 1;
    const maxAttempts = 10;
    let attempts = 0;

    this.logger.debug(`Waiting for all API responses (expected: ${expectedWeeks}, current: ${this.capturedWeeks.length})...`);

    while (this.capturedWeeks.length < expectedWeeks && attempts < maxAttempts) {
      await delay(500);  // Check frequently
      attempts++;
    }

    if (this.capturedWeeks.length < expectedWeeks) {
      this.logger.warn(`Expected ${expectedWeeks} weeks but got ${this.capturedWeeks.length}`);
    }

    // Give a final small delay for any pending response processing
    await delay(500);
  }
}

module.exports = WebScraper;
