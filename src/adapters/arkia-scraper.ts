import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { createContext } from './browser-pool.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('arkia');

/**
 * Arkia scraper via arkia.co.il
 *
 * Strategy: Navigate to the flights-results page with query params.
 * Arkia's Angular SPA renders flight results in the DOM with prices,
 * times, and availability status.
 *
 * URL pattern: /he/flights-results?CC=FL&IS_BACK_N_FORTH=false&OB_DEP_CITY=TLV&OB_ARV_CITY=ATH&OB_DATE=20260319&ADULTS=2&CHILDREN=1&INFANTS=0
 */
export class ArkiaScraperAdapter implements AirlineAdapter {
  readonly source = AirlineSource.ARKIA;
  readonly name = 'Arkia';

  /**
   * Route cache: stores scraped results per origin-dest pair.
   * The Arkia results page shows all available flights from the search date,
   * so we only need one page load per route per poll cycle.
   * Cache is keyed by "ORIGIN-DEST" and holds all offers for that route.
   * TTL: 10 minutes (covers a full poll cycle).
   */
  private routeCache = new Map<string, { offers: NormalizedOffer[]; ts: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  isEnabled(): boolean {
    return true;
  }

  async searchOffers(query: SearchQuery): Promise<NormalizedOffer[]> {
    const routeKey = `${query.origin}-${query.destination}`;

    // Check cache — return date-filtered offers if route was already scraped
    const cached = this.routeCache.get(routeKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      const dateFiltered = cached.offers.filter((o) => o.departureDate === query.departureDate);
      log.debug({ route: routeKey, date: query.departureDate, cached: true, offers: dateFiltered.length }, 'Arkia cache hit');
      return dateFiltered;
    }

    // Scrape the route
    const allOffers = await this.scrapeRoute(query);

    // Cache all offers for this route
    this.routeCache.set(routeKey, { offers: allOffers, ts: Date.now() });

    // Return only offers matching the requested date
    return allOffers.filter((o) => o.departureDate === query.departureDate);
  }

  private async scrapeRoute(query: SearchQuery): Promise<NormalizedOffer[]> {
    const context = await createContext();
    const page = await context.newPage();

    try {
      const dateStr = query.departureDate.replace(/-/g, '');
      const searchUrl = `https://www.arkia.co.il/he/flights-results?CC=FL&IS_BACK_N_FORTH=false&OB_DEP_CITY=${query.origin}&OB_ARV_CITY=${query.destination}&OB_DATE=${dateStr}&ADULTS=${query.passengers.adults}&CHILDREN=${query.passengers.children}&INFANTS=${query.passengers.infants}`;

      log.debug({ url: searchUrl, route: `${query.origin}-${query.destination}` }, 'Loading Arkia search');

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(12000);

      // Extract flight cards from the DOM
      const results = await page.$$eval('.search-result', (els) =>
        els.map((el) => ({
          text: el.textContent?.trim() || '',
          html: el.innerHTML?.slice(0, 500) || '',
        }))
      );

      const offers: NormalizedOffer[] = [];

      for (const result of results) {
        const parsed = this.parseFlightResult(result.text, query);
        if (parsed) offers.push(parsed);
      }

      // If no results from .search-result, try broader selector
      if (offers.length === 0) {
        const altResults = await page.$$eval('[class*="flights"] [class*="ng-star-inserted"]', (els) =>
          els.map((el) => ({
            text: el.textContent?.trim() || '',
          })).filter(e => e.text.includes('$') || e.text.includes('₪'))
        );

        for (const result of altResults) {
          const parsed = this.parseFlightResult(result.text, query);
          if (parsed) offers.push(parsed);
        }
      }

      // Deduplicate by ID
      const seen = new Set<string>();
      const unique = offers.filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
      });

      log.info({
        route: `${query.origin}-${query.destination}`,
        rawResults: results.length,
        offers: unique.length,
      }, 'Arkia route scraped');

      return unique;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg, route: `${query.origin}-${query.destination}` }, 'Arkia scrape failed');
      return [];
    } finally {
      await page.close();
      await context.close();
    }
  }

  private parseFlightResult(text: string, query: SearchQuery): NormalizedOffer | null {
    // Skip sold-out flights ("אזל" = sold out)
    if (text.includes('אזל')) return null;

    // Extract price (e.g., "$391", "₪1,234")
    const priceMatch = text.match(/[\$₪]\s*([\d,]+)/);
    if (!priceMatch) return null;

    const priceStr = priceMatch[1].replace(/,/g, '');
    const pricePerPerson = parseFloat(priceStr);
    if (isNaN(pricePerPerson) || pricePerPerson <= 0) return null;

    const currency = text.includes('₪') && !text.includes('$') ? 'ILS' : 'USD';

    // Extract total price if present (e.g., "סה"כ $1,173")
    const totalMatch = text.match(/סה"כ\s*[\$₪]\s*([\d,]+)/);
    const totalPrice = totalMatch
      ? parseFloat(totalMatch[1].replace(/,/g, ''))
      : pricePerPerson * (query.passengers.adults + query.passengers.children);

    // Extract times (e.g., "23:20", "01:30")
    const timeMatches = text.match(/(\d{1,2}:\d{2})/g) || [];

    // Extract date from Hebrew text (e.g., "16 במרץ" = 16 March)
    // If date can't be parsed, skip — don't fall back to query date (causes false positives
    // because Arkia shows ALL future flights, not just the searched date)
    const departureDate = this.extractDateFromText(text, query.departureDate);
    if (!departureDate) return null;

    // Extract flight number if present (e.g., "IZ 301")
    const flightNumMatch = text.match(/\b(IZ|6H)\s*(\d{3,4})\b/i);
    const flightNumber = flightNumMatch ? `${flightNumMatch[1]}${flightNumMatch[2]}` : '';

    return {
      id: `ARK-${query.origin}-${query.destination}-${departureDate}-${timeMatches[0] || ''}-${pricePerPerson}`,
      airline: 'Arkia',
      origin: query.origin,
      destination: query.destination,
      departureDate,
      departureTime: timeMatches[0] || '',
      arrivalTime: timeMatches[1] || '',
      flightNumber,
      cabinClass: 'Economy',
      totalPrice,
      currency,
      pricePerAdult: pricePerPerson,
      pricePerChild: pricePerPerson, // Arkia shows per-person price already calculated
      seatsAvailable: null,
      passengerMix: query.passengers,
      bookingUrl: `https://www.arkia.co.il/he/flights-results?CC=FL&IS_BACK_N_FORTH=false&OB_DEP_CITY=${query.origin}&OB_ARV_CITY=${query.destination}&OB_DATE=${query.departureDate.replace(/-/g, '')}&ADULTS=${query.passengers.adults}&CHILDREN=${query.passengers.children}&INFANTS=${query.passengers.infants}`,
      offerIdOrRef: null,
      rulesSummary: this.extractBaggage(text),
      fetchedAt: new Date(),
      source: 'arkia.co.il',
    };
  }

  /**
   * Extract the actual flight date from Hebrew text.
   * Arkia uses both full and abbreviated month names (with geresh ׳ or apostrophe ').
   * E.g. "29 במרץ" (March), "2 באפר׳" (April abbreviated)
   * Returns null if no date found — caller must skip these results.
   */
  private extractDateFromText(text: string, fallbackDate: string): string | null {
    const hebrewMonths: [string, string][] = [
      ['ינואר', '01'], ['ינו[׳\']', '01'],
      ['פברואר', '02'], ['פבר[׳\']', '02'],
      ['מרץ', '03'], ['מרס', '03'],
      ['אפריל', '04'], ['אפר[׳\']', '04'],
      ['מאי', '05'],
      ['יוני', '06'], ['יונ[׳\']', '06'],
      ['יולי', '07'], ['יול[׳\']', '07'],
      ['אוגוסט', '08'], ['אוג[׳\']', '08'],
      ['ספטמבר', '09'], ['ספט[׳\']', '09'],
      ['אוקטובר', '10'], ['אוק[׳\']', '10'],
      ['נובמבר', '11'], ['נוב[׳\']', '11'],
      ['דצמבר', '12'], ['דצמ[׳\']', '12'],
    ];

    for (const [heb, month] of hebrewMonths) {
      const match = text.match(new RegExp(`(\\d{1,2})\\s*ב${heb}`));
      if (match) {
        const day = match[1].padStart(2, '0');
        const year = fallbackDate.slice(0, 4);
        return `${year}-${month}-${day}`;
      }
    }

    return null;
  }

  private extractBaggage(text: string): string {
    if (text.includes('תיק יד')) return 'כולל תיק יד/גב (hand luggage included)';
    if (text.includes('מזוודה')) return 'כולל מזוודה (checked bag included)';
    return '';
  }
}
