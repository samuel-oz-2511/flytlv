import { chromium, type Browser, type BrowserContext } from 'playwright';
import { childLogger } from '../utils/logger.js';

const log = childLogger('browser-pool');

const PROXY_URL = process.env.SCRAPER_PROXY || ''; // e.g. socks5://127.0.0.1:1080

/**
 * Shared browser instance for all Playwright-based scrapers.
 * Reuses a single Chromium process to save memory.
 */
let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    const args = ['--disable-blink-features=AutomationControlled'];
    if (PROXY_URL) {
      args.push(`--proxy-server=${PROXY_URL}`);
      log.info({ proxy: PROXY_URL }, 'Launching Chromium with proxy');
    } else {
      log.info('Launching Chromium...');
    }
    browser = await chromium.launch({ headless: true, args });
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
