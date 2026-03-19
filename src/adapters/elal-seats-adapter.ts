import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { childLogger } from '../utils/logger.js';

const log = childLogger('elal-seats');
const PROXY_URL = process.env.SCRAPER_PROXY || '';
const proxyAgent = PROXY_URL ? new SocksProxyAgent(PROXY_URL) : undefined;

const API_URL = 'https://www.elal.com/api/SeatAvailability/lang/heb/flights';

interface SeatApiResponse {
  responseCode: number;
  runDateTime: string;
  dateRange: { dates: string[] };
  flightsFromIsrael: RouteGroup[];
  flightsToIsrael: RouteGroup[];
}

interface RouteGroup {
  origin?: string;
  destination?: string;
  flights: FlightEntry[];
}

interface FlightEntry {
  flightCarrier: string;
  flightNumber: string;
  routeFrom: string;
  routeTo: string;
  segmentDepTime: string;
  isFlightAvailable: boolean;
  originDetails?: { destinationName: string; cityName: string; countryName: string };
  flightsDates: DateEntry[];
}

interface DateEntry {
  flightsDate: string; // "16.03"
  seatCount?: number;
  seatType?: string;  // "Y" = Economy, "N/A" = none
}

/**
 * El Al seat availability adapter.
 *
 * Uses the public seat-availability API which returns 8 days of data
 * for all routes in a single call. No Playwright needed — plain HTTP fetch.
 *
 * Note: This API only provides seat counts, not pricing.
 * Offers are created with price=0 and flagged accordingly.
 */
export class ElAlSeatsAdapter implements AirlineAdapter {
  readonly source = AirlineSource.ELAL;
  readonly name = 'El Al';

  private cache: { data: SeatApiResponse; ts: number } | null = null;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  isEnabled(): boolean {
    return true;
  }

  async searchOffers(query: SearchQuery): Promise<NormalizedOffer[]> {
    // Fetch fresh data if cache expired
    const data = await this.fetchData();
    if (!data) return [];

    // We only care about outbound flights from Israel (TLV→destination)
    const offers: NormalizedOffer[] = [];
    const year = new Date().getFullYear();

    for (const routeGroup of data.flightsFromIsrael || []) {
      for (const flight of routeGroup.flights || []) {
        // Filter: must match query destination
        if (flight.routeTo !== query.destination) continue;
        if (flight.routeFrom !== query.origin) continue;

        for (const dateEntry of flight.flightsDates || []) {
          if (!dateEntry.seatCount || dateEntry.seatCount <= 0) continue;

          // Convert "16.03" to "2026-03-16"
          const [dd, mm] = dateEntry.flightsDate.split('.');
          const departureDate = `${year}-${mm}-${dd}`;

          // Filter: must match query date
          if (departureDate !== query.departureDate) continue;

          offers.push({
            id: `ELAL-${flight.flightNumber}-${departureDate}-${flight.segmentDepTime}`,
            airline: 'El Al',
            origin: flight.routeFrom,
            destination: flight.routeTo,
            departureDate,
            departureTime: flight.segmentDepTime,
            arrivalTime: '',
            flightNumber: flight.flightNumber,
            cabinClass: dateEntry.seatType === 'J' ? 'Business' : 'Economy',
            totalPrice: 0,
            currency: 'USD',
            pricePerAdult: 0,
            pricePerChild: 0,
            seatsAvailable: dateEntry.seatCount,
            passengerMix: query.passengers,
            bookingUrl: `https://www.elal.com/heb/seat-availability?d=0`,
            offerIdOrRef: null,
            rulesSummary: `${dateEntry.seatCount} economy seats available`,
            fetchedAt: new Date(),
            source: 'elal.com (seat availability)',
          });
        }
      }
    }

    log.debug({
      route: `${query.origin}-${query.destination}`,
      date: query.departureDate,
      offers: offers.length,
    }, 'El Al search complete');

    return offers;
  }

  private async fetchData(): Promise<SeatApiResponse | null> {
    if (this.cache && Date.now() - this.cache.ts < this.CACHE_TTL_MS) {
      return this.cache.data;
    }

    try {
      const fetchOpts: RequestInit & { dispatcher?: unknown } = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
      };
      // Node 18+ fetch doesn't natively support agent; use undici dispatcher
      // For SOCKS proxy, we use https module fallback via socks-proxy-agent
      let res: Response;
      if (proxyAgent) {
        const https = await import('https');
        const data = await new Promise<string>((resolve, reject) => {
          const req = https.get(API_URL, { agent: proxyAgent, headers: fetchOpts.headers as Record<string, string> }, (resp) => {
            let body = '';
            resp.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            resp.on('end', () => resolve(body));
          });
          req.on('error', reject);
        });
        const parsed = JSON.parse(data) as SeatApiResponse;
        this.cache = { data: parsed, ts: Date.now() };
        const routeCount = [...(parsed.flightsFromIsrael || []), ...(parsed.flightsToIsrael || [])].length;
        log.info({ routes: routeCount }, 'El Al seat data refreshed (via proxy)');
        return parsed;
      }
      res = await fetch(API_URL, fetchOpts);

      if (!res.ok) {
        log.error({ status: res.status }, 'El Al API returned error');
        return this.cache?.data || null;
      }

      const data = await res.json() as SeatApiResponse;

      // Count available flights for logging
      let availableCount = 0;
      for (const rg of [...(data.flightsFromIsrael || []), ...(data.flightsToIsrael || [])]) {
        for (const f of rg.flights || []) {
          for (const d of f.flightsDates || []) {
            if (d.seatCount && d.seatCount > 0) availableCount++;
          }
        }
      }

      log.info({
        dates: data.dateRange?.dates?.length,
        fromIsrael: data.flightsFromIsrael?.length,
        toIsrael: data.flightsToIsrael?.length,
        available: availableCount,
      }, 'El Al seat data fetched');

      this.cache = { data, ts: Date.now() };
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg }, 'El Al API fetch failed');
      return this.cache?.data || null;
    }
  }
}
