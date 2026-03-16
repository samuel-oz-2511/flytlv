import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { childLogger } from '../utils/logger.js';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const log = childLogger('elal');

const PROFILE_DIR = resolve(process.cwd(), '.elal-profile');

/**
 * El Al scraper via elal.com
 *
 * Strategy: El Al uses Akamai + Radware bot protection. Bypass requires:
 * 1. Headed (non-headless) Chromium with persistent profile
 * 2. Loading www.elal.com/en/ to get the search widget initialized
 * 3. The widget auto-solves Radware challenge and creates JWT session
 * 4. Intercepting BFM API responses for flight data
 *
 * The search widget on elal.com loads from booking.elal.com and handles
 * all session management internally. We interact with the DOM search form
 * and capture the resulting API traffic.
 */
export class ElAlScraperAdapter implements AirlineAdapter {
  readonly source = AirlineSource.ELAL;
  readonly name = 'El Al';

  private routeCache = new Map<string, { offers: NormalizedOffer[]; ts: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  /** Dedicated headed browser for El Al (separate from shared headless pool) */
  private browser: Browser | null = null;

  isEnabled(): boolean {
    return true;
  }

  async searchOffers(query: SearchQuery): Promise<NormalizedOffer[]> {
    const routeKey = `${query.origin}-${query.destination}`;

    const cached = this.routeCache.get(routeKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      const dateFiltered = cached.offers.filter((o) => o.departureDate === query.departureDate);
      log.debug({ route: routeKey, date: query.departureDate, cached: true, offers: dateFiltered.length }, 'El Al cache hit');
      return dateFiltered;
    }

    const allOffers = await this.scrapeRoute(query);
    this.routeCache.set(routeKey, { offers: allOffers, ts: Date.now() });
    return allOffers.filter((o) => o.departureDate === query.departureDate);
  }

  private async getContext(): Promise<BrowserContext> {
    mkdirSync(PROFILE_DIR, { recursive: true });

    // Use persistent context with headed browser for Akamai bypass
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--window-position=-10000,-10000', // Off-screen so it doesn't disturb user
      ],
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'Asia/Jerusalem',
    });

    return context;
  }

  private async scrapeRoute(query: SearchQuery): Promise<NormalizedOffer[]> {
    let context: BrowserContext | null = null;

    try {
      context = await this.getContext();
      const page = await context.newPage();

      // Stealth: remove webdriver flag
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Intercept BFM API responses
      const bfmResponses: { url: string; body: string }[] = [];
      page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('booking.elal.com/bfm') || url.includes('/service/extly/')) {
          try {
            const ct = res.headers()['content-type'] || '';
            if (ct.includes('json')) {
              const body = await res.text();
              if (body.length > 50) {
                bfmResponses.push({ url, body });
              }
            }
          } catch {}
        }
      });

      // Load the main site — the search widget will initialize
      log.debug({ route: `${query.origin}-${query.destination}` }, 'Loading El Al homepage');
      await page.goto('https://www.elal.com/en/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(10000); // Wait for widget + Radware challenge

      // Check if Akamai blocked us
      const bodyText = await page.textContent('body');
      if (bodyText?.includes('Access Denied') || bodyText?.includes('blocked')) {
        log.warn('El Al: Akamai blocked — waiting for challenge resolution');
        await page.waitForTimeout(10000); // Give more time for challenge
        const bodyText2 = await page.textContent('body');
        if (bodyText2?.includes('Access Denied')) {
          log.error('El Al: Akamai block persists');
          await page.close();
          return [];
        }
      }

      // Try to interact with the search widget
      const offers: NormalizedOffer[] = [];

      // Look for the search widget
      const widgetExists = await page.$('elal-search-widget, [class*="search-widget"], [class*="SearchWidget"]');

      if (widgetExists) {
        log.debug('El Al: Search widget found — attempting search');

        // Try to fill in search form
        // The widget is an Angular component with shadow DOM
        try {
          // Click "One Way" option if available
          const oneWayBtn = page.locator('text=One Way').first();
          if (await oneWayBtn.count() > 0) {
            await oneWayBtn.click();
            await page.waitForTimeout(500);
          }

          // Try to find and fill destination input
          const destInput = page.locator('[aria-label*="destination"], [placeholder*="destination"], [aria-label*="To"], input[name*="dest"]').first();
          if (await destInput.count() > 0) {
            await destInput.click();
            await page.waitForTimeout(500);
            await destInput.fill(query.destination);
            await page.waitForTimeout(1000);

            // Click the first autocomplete option
            const option = page.locator('[role="option"], [class*="option"], [class*="suggestion"]').first();
            if (await option.count() > 0) {
              await option.click();
              await page.waitForTimeout(500);
            }
          }

          // Try to set departure date
          const dateInput = page.locator('[aria-label*="departure"], [aria-label*="date"], input[name*="date"]').first();
          if (await dateInput.count() > 0) {
            await dateInput.click();
            await page.waitForTimeout(500);
          }

          // Try to click search button
          const searchBtn = page.locator('button:has-text("Search"), button:has-text("Find"), button[type="submit"]').first();
          if (await searchBtn.count() > 0) {
            await searchBtn.click();
            log.debug('El Al: Search button clicked');
            await page.waitForTimeout(15000); // Wait for results
          }
        } catch (err: unknown) {
          log.debug({ error: err instanceof Error ? err.message : String(err) }, 'El Al: Widget interaction failed');
        }
      }

      // Parse intercepted BFM API responses
      for (const resp of bfmResponses) {
        try {
          const data = JSON.parse(resp.body);

          // Parse destination list
          if (resp.url.includes('locations/destination') && Array.isArray(data)) {
            log.debug({ destinations: data.length }, 'El Al: Got destination list');
          }

          // Parse flight search results
          if (resp.url.includes('search/cash') || resp.url.includes('search/calendar')) {
            const parsed = this.parseBfmResponse(data, query);
            offers.push(...parsed);
          }
        } catch {}
      }

      // Also try DOM scraping for any visible flight results
      const flightElements = await page.$$eval(
        '[class*="flight"], [class*="Flight"], [class*="result"], [class*="Result"]',
        (els) => els.map((el) => ({
          text: el.textContent?.trim().slice(0, 500) || '',
        })).filter(e => e.text.includes('$') || e.text.includes('₪'))
      );

      for (const el of flightElements) {
        const parsed = this.parseFlightText(el.text, query);
        if (parsed) offers.push(parsed);
      }

      // Deduplicate
      const seen = new Set<string>();
      const unique = offers.filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
      });

      log.info({
        route: `${query.origin}-${query.destination}`,
        date: query.departureDate,
        bfmResponses: bfmResponses.length,
        domFlights: flightElements.length,
        offers: unique.length,
      }, 'El Al search complete');

      await page.close();
      return unique;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg, route: `${query.origin}-${query.destination}` }, 'El Al scrape failed');
      return [];
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }

  private parseBfmResponse(data: any, query: SearchQuery): NormalizedOffer[] {
    const offers: NormalizedOffer[] = [];
    if (!data || typeof data !== 'object') return offers;

    // Calendar prices response: { dates: [{ date, price, currency }] }
    if (Array.isArray(data.dates || data.calendarDays)) {
      const days = data.dates || data.calendarDays;
      for (const day of days) {
        const price = day.price || day.lowestPrice || day.amount || 0;
        if (price <= 0) continue;

        offers.push({
          id: `LY-${query.origin}-${query.destination}-${day.date || query.departureDate}-${price}`,
          airline: 'El Al',
          origin: query.origin,
          destination: query.destination,
          departureDate: day.date || query.departureDate,
          departureTime: '',
          arrivalTime: '',
          flightNumber: '',
          cabinClass: 'Economy',
          totalPrice: price,
          currency: day.currency || 'USD',
          pricePerAdult: price,
          pricePerChild: price * 0.75,
          seatsAvailable: null,
          passengerMix: query.passengers,
          bookingUrl: `https://www.elal.com/en/booking/flight-select/?isRoundTrip=false&ADT=${query.passengers.adults}&CHD=${query.passengers.children}&INF=${query.passengers.infants}&Origin=${query.origin}&Destination=${query.destination}&DepDate=${day.date || query.departureDate}`,
          offerIdOrRef: null,
          rulesSummary: '',
          fetchedAt: new Date(),
          source: 'elal.com',
        });
      }
    }

    // Flight list response: { flights: [...] }
    const flights = data.flights || data.outbound || data.bounds || [];
    if (Array.isArray(flights)) {
      for (const f of flights) {
        const price = f.price || f.totalPrice || f.fare?.total || f.lowestPrice || 0;
        if (price <= 0) continue;

        const depTime = f.departureTime || f.departure?.time || f.segments?.[0]?.departureTime || '';
        const arrTime = f.arrivalTime || f.arrival?.time || f.segments?.[0]?.arrivalTime || '';
        const flightNum = f.flightNumber || f.marketingFlight || f.segments?.[0]?.flightNumber || '';

        offers.push({
          id: `LY-${flightNum || query.destination}-${query.departureDate}-${depTime}-${price}`,
          airline: 'El Al',
          origin: query.origin,
          destination: query.destination,
          departureDate: query.departureDate,
          departureTime: depTime,
          arrivalTime: arrTime,
          flightNumber: flightNum,
          cabinClass: f.cabinClass || f.class || 'Economy',
          totalPrice: price,
          currency: f.currency || 'USD',
          pricePerAdult: price,
          pricePerChild: price * 0.75,
          seatsAvailable: null,
          passengerMix: query.passengers,
          bookingUrl: `https://www.elal.com/en/booking/flight-select/?isRoundTrip=false&ADT=${query.passengers.adults}&CHD=${query.passengers.children}&INF=${query.passengers.infants}&Origin=${query.origin}&Destination=${query.destination}&DepDate=${query.departureDate}`,
          offerIdOrRef: null,
          rulesSummary: '',
          fetchedAt: new Date(),
          source: 'elal.com',
        });
      }
    }

    return offers;
  }

  private parseFlightText(text: string, query: SearchQuery): NormalizedOffer | null {
    const priceMatch = text.match(/[\$₪€]\s*([\d,]+)|(\d[\d,]+)\s*[\$₪€]/);
    if (!priceMatch) return null;

    const priceStr = (priceMatch[1] || priceMatch[2]).replace(/,/g, '');
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) return null;

    const currency = text.includes('₪') ? 'ILS' : text.includes('€') ? 'EUR' : 'USD';
    const timeMatches = text.match(/(\d{1,2}:\d{2})/g) || [];
    const flightNumMatch = text.match(/\b(LY)\s*(\d{3,4})\b/i);
    const flightNumber = flightNumMatch ? `${flightNumMatch[1]}${flightNumMatch[2]}` : '';

    return {
      id: `LY-${query.origin}-${query.destination}-${query.departureDate}-${timeMatches[0] || ''}-${price}`,
      airline: 'El Al',
      origin: query.origin,
      destination: query.destination,
      departureDate: query.departureDate,
      departureTime: timeMatches[0] || '',
      arrivalTime: timeMatches[1] || '',
      flightNumber,
      cabinClass: 'Economy',
      totalPrice: price,
      currency,
      pricePerAdult: price,
      pricePerChild: price * 0.75,
      seatsAvailable: null,
      passengerMix: query.passengers,
      bookingUrl: `https://www.elal.com/en/booking/flight-select/?isRoundTrip=false&ADT=${query.passengers.adults}&CHD=${query.passengers.children}&INF=${query.passengers.infants}&Origin=${query.origin}&Destination=${query.destination}&DepDate=${query.departureDate}`,
      offerIdOrRef: null,
      rulesSummary: '',
      fetchedAt: new Date(),
      source: 'elal.com',
    };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
