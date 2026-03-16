import { chromium, type Browser, type BrowserContext } from 'playwright';
import { childLogger } from '../utils/logger.js';

const log = childLogger('browser-pool');

/**
 * Shared browser instance for all Playwright-based scrapers.
 * Reuses a single Chromium process to save memory.
 */
let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    log.info('Launching Chromium...');
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  return browser;
}

export async function createContext(locale = 'he-IL'): Promise<BrowserContext> {
  const b = await getBrowser();
  return b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale,
    timezoneId: 'Asia/Jerusalem',
  });
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    log.info('Browser closed');
  }
}
