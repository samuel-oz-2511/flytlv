import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { createContext } from './browser-pool.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('israir');

/**
 * Israir scraper via israir.co.il search API
 *
 * Strategy: Navigate to the search results page with URL params, which
 * triggers the SPA to call /api/search/FLIGHTS internally. We intercept
 * that response to get full flight package data with pricing.
 *
 * Key discoveries:
 * - subject=ALL returns FLIGHT_PACKAGE data (round-trip packages with outbound legs)
 * - searchRange=[] returns all available dates
 * - API returns paginated results (80 per page, up to 173 total)
 * - Each package has: flight segments, seats, pricing (USD per person), deepLinkURL
 * - Manual fetch() calls return 405/500 — must navigate via SPA
 * - One page load per destination required
 */
export class IsrairScraperAdapter implements AirlineAdapter {
  readonly source = AirlineSource.ISRAIR;
  readonly name = 'Israir';

  /** Cache per destination: destination code -> { offers, timestamp } */
  private destCache = new Map<string, { offers: NormalizedOffer[]; ts: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  /** Active destinations from engine API */
  private activeDestinations: Set<string> | null = null;

  isEnabled(): boolean {
    return true;
  }

  async searchOffers(query: SearchQuery): Promise<NormalizedOffer[]> {
    // Check destination cache
    const cached = this.destCache.get(query.destination);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      const dateFiltered = cached.offers.filter((o) => o.departureDate === query.departureDate);
      log.debug({
        route: `${query.origin}-${query.destination}`,
        date: query.departureDate,
        cached: true,
        offers: dateFiltered.length,
      }, 'Israir cache hit');
      return dateFiltered;
    }

    // Load active destinations if unknown
    if (!this.activeDestinations) {
      await this.loadActiveDestinations();
    }

    // Skip if destination not served by Israir
    if (this.activeDestinations && !this.activeDestinations.has(query.destination)) {
      log.debug({ destination: query.destination }, 'Israir: destination not served');
      return [];
    }

    // Scrape all flights for this destination
    const allOffers = await this.scrapeDestination(query);
    this.destCache.set(query.destination, { offers: allOffers, ts: Date.now() });

    return allOffers.filter((o) => o.departureDate === query.departureDate);
  }

  /**
   * Load the list of active Israir destinations from the engine API.
   * This is done via intercepting the homepage's auto-fired API calls.
   */
  private async loadActiveDestinations(): Promise<void> {
    const context = await createContext();
    const page = await context.newPage();

    try {
      let destList: string[] | null = null;

      page.on('response', async (res) => {
        const url = res.url();
        if (url.includes('/api/engine') && url.includes('ONEWAY_FLIGHT') && !destList) {
          try {
            const body = await res.text();
            if (body.length > 100) {
              const data = JSON.parse(body);
              destList = data.data?.destLocations || data.data?.activeDestinations || [];
            }
          } catch {}
        }
      });

      await page.goto('https://www.israir.co.il/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(5000);

      if (destList && destList.length > 0) {
        this.activeDestinations = new Set(destList);
        log.info({ count: destList.length }, 'Israir: loaded active destinations');
      } else {
        // Fallback: accept any destination
        this.activeDestinations = null;
        log.warn('Israir: could not load destinations, accepting all');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg }, 'Israir: failed to load destinations');
    } finally {
      await page.close();
      await context.close();
    }
  }

  /**
   * Scrape all available flights for a specific destination.
   * Navigates to the search results page and intercepts the /api/search/FLIGHTS response.
   */
  private async scrapeDestination(query: SearchQuery): Promise<NormalizedOffer[]> {
    const context = await createContext();
    const page = await context.newPage();

    try {
      // First load homepage to establish session
      await page.goto('https://www.israir.co.il/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      // Intercept the search API response
      let flightsBody = '';
      page.on('response', async (res) => {
        if (res.url().includes('/api/search/FLIGHTS') && !flightsBody) {
          try {
            flightsBody = await res.text();
          } catch {}
        }
      });

      // Navigate to search results page with params
      // subject=ALL returns flight packages; searchRange=[] returns all dates
      const searchUrl = `https://www.israir.co.il/he-IL/reservation/search/flights-abroad/results?origin=${query.origin}&destination=${query.destination}&searchRange=[]&adults=${query.passengers.adults}&children=${query.passengers.children}&infants=${query.passengers.infants}&subject=ALL&searchTime=${new Date().toISOString()}`;

      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3000);

      if (!flightsBody) {
        log.warn({ destination: query.destination }, 'Israir: no API response intercepted');
        return [];
      }

      const data = JSON.parse(flightsBody);
      const offers: NormalizedOffer[] = [];

      // Parse packages from both main and additional responses
      const mainPkgs = data.data?.ltsPackages || [];
      const addPkgs = data.data?.additionalPackagesResponse?.ltsPackages || [];
      const allPkgs = [...mainPkgs, ...addPkgs];

      for (const pkg of allPkgs) {
        const parsed = this.parsePackage(pkg, query);
        if (parsed) offers.push(parsed);
      }

      // Deduplicate by outbound flight+date
      const seen = new Set<string>();
      const unique = offers.filter((o) => {
        const key = `${o.flightNumber}-${o.departureDate}-${o.departureTime}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      log.info({
        destination: query.destination,
        packages: allPkgs.length,
        offers: unique.length,
      }, 'Israir: destination scraped');

      return unique;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg, destination: query.destination }, 'Israir scrape failed');
      return [];
    } finally {
      await page.close();
      await context.close();
    }
  }

  /**
   * Parse a single flight package into a NormalizedOffer.
   * Extracts outbound flight leg data and pricing.
   */
  private parsePackage(pkg: any, query: SearchQuery): NormalizedOffer | null {
    try {
      // Get outbound leg (first leg group, first leg)
      const outboundLeg = pkg.legGroups?.[0]?.legList?.[0]?.legOptionList?.[0];
      if (!outboundLeg) return null;

      const segment = outboundLeg.legSegmentList?.[0];
      if (!segment) return null;

      // Parse departure date/time from "DD/MM/YYYY HH:MM:SS" format
      const depDateTime = segment.depLoc?.scheduledDateTime;
      const arrDateTime = segment.arrLoc?.scheduledDateTime;
      if (!depDateTime) return null;

      const [depDatePart, depTimePart] = depDateTime.split(' ');
      const [dd, mm, yyyy] = depDatePart.split('/');
      const departureDate = `${yyyy}-${mm}-${dd}`;
      const departureTime = depTimePart?.slice(0, 5) || '';

      let arrivalTime = '';
      if (arrDateTime) {
        arrivalTime = arrDateTime.split(' ')[1]?.slice(0, 5) || '';
      }

      // Extract pricing
      const pricePerPerson = pkg.packageFare?.amount?.amount || 0;
      const currency = pkg.packageFare?.amount?.currency || 'USD';

      if (pricePerPerson <= 0) return null;

      // Calculate total price for the passenger mix
      const adults = query.passengers.adults;
      const children = query.passengers.children;
      const infants = query.passengers.infants;
      const totalPrice = pricePerPerson * adults + pricePerPerson * 0.75 * children;

      const seats = parseInt(segment.seats, 10) || 0;

      // Skip flights with no available seats — API returns seats:0 for sold-out flights
      if (seats === 0) return null;

      // Check return leg seats — round-trip packages store both legs in
      // legGroups[0].legList[0] (outbound) and legGroups[0].legList[1] (return).
      const returnLeg = pkg.legGroups?.[0]?.legList?.[1]?.legOptionList?.[0]
                      || pkg.legGroups?.[1]?.legList?.[0]?.legOptionList?.[0]; // fallback
      let returnDate = '';
      const totalPax = query.passengers.adults + query.passengers.children + query.passengers.infants;

      if (returnLeg) {
        const returnSegment = returnLeg.legSegmentList?.[0];
        if (returnSegment) {
          const returnSeats = parseInt(returnSegment.seats, 10) || 0;
          if (returnSeats === 0) {
            log.debug({ destination: query.destination, date: departureDate }, 'Skipping: return leg has 0 seats');
            return null;
          }
          // Extract return date
          const retDateTime = returnSegment.depLoc?.scheduledDateTime;
          if (retDateTime) {
            const [retDatePart] = retDateTime.split(' ');
            const [rdd, rmm, ryyyy] = retDatePart.split('/');
            returnDate = `${ryyyy}-${rmm}-${rdd}`;
          }
        }
      }

      // Skip if not enough seats for the full passenger mix on outbound
      if (seats < totalPax) {
        log.debug({ destination: query.destination, date: departureDate, seats, needed: totalPax }, 'Skipping: not enough seats for passenger mix');
        return null;
      }

      const flightNumber = `6H${segment.flightNumber || ''}`;
      const destCode = pkg.destCode || segment.arrLoc?.location || query.destination;

      // Build booking URL — fix the deepLinkURL passenger count (defaults to 1 adult)
      let bookingUrl: string;
      if (pkg.deepLinkURL) {
        const fixedLink = pkg.deepLinkURL
          .replace(/adultsNum=\d+/, `adultsNum=${adults}`)
          .replace(/childrenNum=\d+/, `childrenNum=${children}`);
        bookingUrl = `https://www.israir.co.il${fixedLink}`;
      } else {
        bookingUrl = `https://www.israir.co.il/he-IL/reservation/search/flights-abroad/results?origin=${query.origin}&destination=${destCode}&adults=${adults}&children=${children}&infants=${infants}&subject=ALL`;
      }

      return {
        id: `ISR-${flightNumber}-${departureDate}-${departureTime}-${pricePerPerson}`,
        airline: 'Israir',
        origin: segment.depLoc?.location || query.origin,
        destination: destCode,
        departureDate,
        departureTime,
        arrivalTime,
        flightNumber,
        cabinClass: segment.flightClass === 'J' ? 'Business' : 'Economy',
        totalPrice,
        currency,
        pricePerAdult: pricePerPerson,
        pricePerChild: pricePerPerson * 0.75,
        seatsAvailable: seats > 0 ? seats : null,
        passengerMix: query.passengers,
        bookingUrl,
        offerIdOrRef: pkg.packageUUID || null,
        rulesSummary: [
          returnDate ? `Round-trip (return ${returnDate})` : '',
          seats > 0 ? `${seats} seats` : '',
          segment.baggageIndicator === 'NOT_INCLUDED_IN_PRICE' ? 'baggage not included' : '',
        ].filter(Boolean).join(', '),
        fetchedAt: new Date(),
        source: 'israir.co.il',
      };
    } catch {
      return null;
    }
  }
}
