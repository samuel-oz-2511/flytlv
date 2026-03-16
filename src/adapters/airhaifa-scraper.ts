import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { createContext } from './browser-pool.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('airhaifa');

/**
 * Air Haifa (E2) scraper via airhaifa.com calendar API
 *
 * Strategy: Load the AeroCRS-powered homepage, fill in origin/destination
 * via EasyAutocomplete, and read the calendar data that is automatically
 * fetched by the SPA's fetchDatesOnChange() function.
 *
 * Key discoveries:
 * - AeroCRS tenant 558, IATA code E2
 * - Incapsula WAF blocks direct navigation to /flight-results and /controllers/flights/*
 * - But the homepage loads fine and the calendar data is populated by internal XHR
 * - searchCalendar[] contains per-day { fare, flight } for ~7 months
 * - When flight=true, fare contains the price (USD per person)
 * - Air Haifa currently operates "rescue flights" from TLV with very limited/last-minute availability
 * - Destinations: ATH, LCA, PFO, RHO, ETM, HFA
 * - One homepage load can check multiple destinations by changing flightTo
 */
export class AirHaifaScraperAdapter implements AirlineAdapter {
  readonly source = AirlineSource.AIR_HAIFA;
  readonly name = 'Air Haifa';

  /** Cache all destinations per scrape session */
  private allOffersCache: { offers: NormalizedOffer[]; ts: number } | null = null;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  /** Known Air Haifa destinations from TLV */
  private static readonly DESTINATIONS = ['ATH', 'LCA', 'PFO', 'RHO'];

  private static readonly DEST_NAMES: Record<string, string> = {
    ATH: ' Athens',
    LCA: ' Larnaca',
    PFO: ' Paphos',
    RHO: ' Rhodes',
    ETM: ' Eilat',
    HFA: ' Haifa',
  };

  isEnabled(): boolean {
    return true;
  }

  async searchOffers(query: SearchQuery): Promise<NormalizedOffer[]> {
    // Check cache
    if (this.allOffersCache && Date.now() - this.allOffersCache.ts < this.CACHE_TTL_MS) {
      const filtered = this.allOffersCache.offers.filter(
        (o) => o.destination === query.destination && o.departureDate === query.departureDate,
      );
      log.debug({
        route: `${query.origin}-${query.destination}`,
        date: query.departureDate,
        cached: true,
        offers: filtered.length,
      }, 'Air Haifa cache hit');
      return filtered;
    }

    // Scrape all destinations in one browser session
    const allOffers = await this.scrapeAllDestinations(query);
    this.allOffersCache = { offers: allOffers, ts: Date.now() };

    return allOffers.filter(
      (o) => o.destination === query.destination && o.departureDate === query.departureDate,
    );
  }

  /**
   * Load the Air Haifa homepage once and check all destinations
   * by changing the flightTo value and reading calendar data.
   */
  private async scrapeAllDestinations(query: SearchQuery): Promise<NormalizedOffer[]> {
    const context = await createContext('en-US');
    const page = await context.newPage();

    try {
      // Load homepage and wait for jQuery/AeroCRS to be ready
      await page.goto('https://www.airhaifa.com/en', {
        waitUntil: 'networkidle',
        timeout: 45000,
      }).catch(() => {});
      await page.waitForFunction(
        () => typeof (window as any).jQuery === 'function' && typeof (window as any).fetchDatesOnChange === 'function',
        { timeout: 15000 },
      ).catch(() => {});
      await page.waitForTimeout(1000);

      // Dismiss cookie consent and overlays
      await page.click('button:has-text("Agree to all")').catch(() => {});
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        document.querySelectorAll('.overlay, .overlay1').forEach((el) => {
          (el as HTMLElement).style.display = 'none';
        });
      });

      // Select one-way
      await page.evaluate(() => {
        const ow = document.getElementById('type_OW') as HTMLInputElement;
        if (ow) { ow.checked = true; ow.click(); }
      });
      await page.waitForTimeout(500);

      // Set origin to TLV via autocomplete
      await page.click('#flightFrom', { force: true });
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        (document.getElementById('flightFrom') as HTMLInputElement).value = '';
      });
      await page.type('#flightFrom', 'Tel', { delay: 100 });
      await page.waitForTimeout(1500);
      await page.press('#flightFrom', 'ArrowDown');
      await page.waitForTimeout(200);
      await page.press('#flightFrom', 'Enter');
      await page.waitForTimeout(1000);

      const fromVal = await page.$eval('#flightFrom', (el) => (el as HTMLInputElement).value);
      if (!fromVal.includes('Tel Aviv')) {
        log.warn({ value: fromVal }, 'Air Haifa: origin autocomplete may have failed');
      }

      const allOffers: NormalizedOffer[] = [];

      // Check each destination
      for (const dest of AirHaifaScraperAdapter.DESTINATIONS) {
        const destName = AirHaifaScraperAdapter.DEST_NAMES[dest];
        if (!destName) continue;

        // Reset calendar
        await page.evaluate(() => {
          (window as any).searchCalendar = [];
        });

        // Set destination via JS + trigger autocomplete callback
        await page.evaluate((name: string) => {
          const to = document.getElementById('flightTo') as HTMLInputElement;
          to.disabled = false;
          to.value = name;
          const $ = (window as any).jQuery;
          if (typeof $ === 'function') {
            $('#flightTo').trigger('change');
          }
          if (typeof (window as any).toAutoComplete === 'function') {
            (window as any).toAutoComplete();
          }
        }, destName);
        await page.waitForTimeout(500);

        // Trigger calendar fetch
        await page.evaluate(() => {
          if (typeof (window as any).fetchDatesOnChange === 'function') {
            (window as any).fetchDatesOnChange(true);
          }
        });

        // Wait for calendar data
        await page.waitForTimeout(4000);

        // Read calendar and find dates with flights
        const calendarOffers = await page.evaluate(
          ({ destCode, passengers }: { destCode: string; passengers: any }) => {
            const cal = (window as any).searchCalendar;
            if (!cal || !Array.isArray(cal) || cal.length === 0) return [];

            const offers: any[] = [];
            for (const month of cal) {
              if (!month?.days) continue;
              const days = Array.isArray(month.days) ? month.days : Object.values(month.days);
              for (const day of days as any[]) {
                if (!day) continue;
                if (day.flight === true || day.flight === 'true') {
                  // Parse date: "2026/03/16" -> "2026-03-16"
                  const fullDate = day.fullDate?.replace(/\//g, '-') || '';
                  const fare = typeof day.fare === 'number' ? day.fare
                    : typeof day.fare === 'string' ? parseFloat(day.fare) : 0;

                  offers.push({
                    date: fullDate,
                    fare,
                    destCode,
                    adults: passengers.adults,
                    children: passengers.children,
                  });
                }
              }
            }
            return offers;
          },
          { destCode: dest, passengers: query.passengers },
        );

        for (const o of calendarOffers) {
          if (o.fare <= 0) continue;

          const totalPrice = o.fare * query.passengers.adults + o.fare * query.passengers.children;
          const dd = o.date.slice(8, 10);
          const mm = o.date.slice(5, 7);
          const yyyy = o.date.slice(0, 4);

          allOffers.push({
            id: `E2-TLV-${dest}-${o.date}-${o.fare}`,
            airline: 'Air Haifa',
            origin: query.origin,
            destination: dest,
            departureDate: o.date,
            departureTime: '',  // Calendar doesn't include times
            arrivalTime: '',
            flightNumber: 'E2',  // Specific flight number not available from calendar
            cabinClass: 'Economy',
            totalPrice,
            currency: 'USD',
            pricePerAdult: o.fare,
            pricePerChild: o.fare,
            seatsAvailable: null,
            passengerMix: query.passengers,
            bookingUrl: `https://www.airhaifa.com/en/flight-results/TLV-${dest}/${dd}-${mm}-${yyyy}/${dd}-${mm}-${yyyy}/${query.passengers.adults}/${query.passengers.children}/${query.passengers.infants}`,
            offerIdOrRef: null,
            rulesSummary: 'rescue flight — limited availability, book immediately',
            fetchedAt: new Date(),
            source: 'airhaifa.com',
          });
        }

        log.debug({
          route: `TLV-${dest}`,
          flights: calendarOffers.length,
        }, 'Air Haifa destination checked');
      }

      log.info({
        destinations: AirHaifaScraperAdapter.DESTINATIONS.length,
        totalOffers: allOffers.length,
      }, 'Air Haifa scrape complete');

      return allOffers;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg }, 'Air Haifa scrape failed');
      return [];
    } finally {
      await page.close();
      await context.close();
    }
  }
}
