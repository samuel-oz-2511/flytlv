import { Duffel } from '@duffel/api';
import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import type { AppConfig } from '../types/config.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { withRetry } from '../utils/retry.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('elal');

const ELAL_IATA = 'LY';

/**
 * El Al adapter using Duffel API.
 *
 * Duffel returns priced offers directly — no separate pricing step needed.
 * We filter results to only El Al-operated flights (IATA: LY).
 */
export class ElAlAdapter implements AirlineAdapter {
  readonly source = AirlineSource.ELAL;
  readonly name = 'El Al';

  private readonly duffel: Duffel;
  private readonly rateLimiter = new RateLimiter(30, 60_000); // conservative

  constructor(private readonly config: AppConfig['duffel']) {
    this.duffel = new Duffel({
      token: config.accessToken,
    });
  }

  isEnabled(): boolean {
    return !!this.config.accessToken;
  }

  async searchOffers(query: SearchQuery): Promise<NormalizedOffer[]> {
    if (!this.isEnabled()) return [];

    await this.rateLimiter.waitForToken();

    // Duffel v2+ API: adults use { type: 'adult' }, children use { age: N }
    const passengers: Array<{ type?: string; age?: number }> = [];
    for (let i = 0; i < query.passengers.adults; i++) {
      passengers.push({ type: 'adult' });
    }
    for (let i = 0; i < query.passengers.children; i++) {
      passengers.push({ age: 8 });
    }
    for (let i = 0; i < query.passengers.infants; i++) {
      passengers.push({ age: 1 });
    }

    log.debug({
      route: `${query.origin}-${query.destination}`,
      date: query.departureDate,
      pax: passengers.length,
    }, 'Searching Duffel for El Al offers');

    try {
      const response = await withRetry(
        () =>
          this.duffel.offerRequests.create({
            slices: [
              {
                origin: query.origin,
                destination: query.destination,
                departure_date: query.departureDate,
              },
            ],
            passengers,
            cabin_class: 'economy',
            return_offers: true,
          } as any),
        'duffel-offer-request',
      );

      const offers = (response.data as any).offers ?? [];

      // In live mode, filter to El Al only. In test mode, accept all (sandbox has mock airlines).
      const isTest = this.config.env === 'test';
      const filtered = isTest
        ? offers
        : offers.filter((o: any) => o.owner?.iata_code === ELAL_IATA);

      log.info({
        total: offers.length,
        filtered: filtered.length,
        testMode: isTest,
        route: `${query.origin}-${query.destination}`,
      }, 'Duffel search results');

      return filtered.map((o: any) => this.normalize(o, query));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg, route: `${query.origin}-${query.destination}` }, 'Duffel search failed');
      return [];
    }
  }

  private normalize(offer: any, query: SearchQuery): NormalizedOffer {
    const slice = offer.slices?.[0];
    const segment = slice?.segments?.[0];

    const adultPax = offer.passengers?.filter((p: any) => p.type === 'adult') ?? [];
    const childPax = offer.passengers?.filter((p: any) => p.type === 'child') ?? [];

    const adultPrice = adultPax.length
      ? parseFloat(offer.total_amount) / (adultPax.length + childPax.length * 0.75) // approximate split
      : parseFloat(offer.total_amount) / 3;
    const childPrice = adultPrice * 0.75;

    return {
      id: `DUF-${offer.id}`,
      airline: offer.owner?.name ?? 'El Al',
      origin: query.origin,
      destination: query.destination,
      departureDate: query.departureDate,
      departureTime: segment?.departing_at?.slice(11, 16) ?? '',
      arrivalTime: segment?.arriving_at?.slice(11, 16) ?? '',
      flightNumber: segment?.operating_carrier_flight_number
        ? `${segment.operating_carrier?.iata_code ?? 'LY'}${segment.operating_carrier_flight_number}`
        : segment?.marketing_carrier_flight_number
          ? `${segment.marketing_carrier?.iata_code ?? 'LY'}${segment.marketing_carrier_flight_number}`
          : '',
      cabinClass: slice?.fare_brand_name ?? segment?.passengers?.[0]?.cabin_class ?? 'economy',
      totalPrice: parseFloat(offer.total_amount),
      currency: offer.total_currency ?? 'ILS',
      pricePerAdult: adultPrice,
      pricePerChild: childPrice,
      seatsAvailable: offer.available_services ? null : null,
      passengerMix: query.passengers,
      bookingUrl: null, // Duffel provides offer ID for booking, not a URL
      offerIdOrRef: offer.id,
      rulesSummary: offer.conditions?.refund_before_departure?.allowed
        ? 'Refundable'
        : 'Non-refundable',
      fetchedAt: new Date(),
      source: 'duffel',
    };
  }
}
