import axios from 'axios';
import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import type { AppConfig } from '../types/config.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { withRetry } from '../utils/retry.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('air-haifa');

/**
 * Air Haifa adapter using GO7/AeroCRS API.
 *
 * Two-step flow:
 * 1. getAvailability — lightweight check for seat availability
 * 2. getFares — only called when availability exists (saves API calls)
 *
 * No bookings/PNRs are created. Compliant with GO7 terms.
 */
export class AirHaifaAdapter implements AirlineAdapter {
  readonly source = AirlineSource.AIR_HAIFA;
  readonly name = 'Air Haifa';

  private readonly rateLimiter = new RateLimiter(60, 60_000); // 60 calls/min

  constructor(private readonly config: AppConfig['aerocrs']) {}

  isEnabled(): boolean {
    return !!(this.config.entity && this.config.token && this.config.password);
  }

  async searchOffers(query: SearchQuery): Promise<NormalizedOffer[]> {
    if (!this.isEnabled()) return [];

    // Step 1: Check availability
    const availability = await this.getAvailability(query);
    if (!availability || availability.length === 0) {
      log.debug({ route: `${query.origin}-${query.destination}`, date: query.departureDate }, 'No availability');
      return [];
    }

    // Step 2: Get fares only when availability exists
    const fares = await this.getFares(query);
    if (!fares || fares.length === 0) {
      log.debug({ route: `${query.origin}-${query.destination}`, date: query.departureDate }, 'No fares for available flights');
      return [];
    }

    return this.combineAndNormalize(availability, fares, query);
  }

  private async getAvailability(query: SearchQuery): Promise<AeroCRSAvailability[]> {
    await this.rateLimiter.waitForToken();

    const url = `${this.config.baseUrl}/v5/getAvailability`;
    const params = {
      entity: this.config.entity,
      token: this.config.token,
      password: this.config.password,
      from: query.origin,
      to: query.destination,
      date: query.departureDate,
      adults: query.passengers.adults,
      children: query.passengers.children,
      infants: query.passengers.infants,
    };

    log.debug({ url, from: query.origin, to: query.destination, date: query.departureDate }, 'Calling getAvailability');

    const response = await withRetry(
      () => axios.get(url, { params, timeout: 15_000 }),
      'aerocrs-availability',
    );

    return (response.data?.flights ?? response.data ?? []) as AeroCRSAvailability[];
  }

  private async getFares(query: SearchQuery): Promise<AeroCRSFare[]> {
    await this.rateLimiter.waitForToken();

    const url = `${this.config.baseUrl}/v4/getFares`;
    const params = {
      entity: this.config.entity,
      token: this.config.token,
      password: this.config.password,
      from: query.origin,
      to: query.destination,
      date: query.departureDate,
    };

    log.debug({ url, from: query.origin, to: query.destination, date: query.departureDate }, 'Calling getFares');

    const response = await withRetry(
      () => axios.get(url, { params, timeout: 15_000 }),
      'aerocrs-fares',
    );

    return (response.data?.fares ?? response.data ?? []) as AeroCRSFare[];
  }

  private combineAndNormalize(
    availability: AeroCRSAvailability[],
    fares: AeroCRSFare[],
    query: SearchQuery,
  ): NormalizedOffer[] {
    const fareMap = new Map<string, AeroCRSFare>();
    for (const fare of fares) {
      const key = `${fare.flight_number ?? fare.flightNumber ?? ''}`;
      if (key) fareMap.set(key, fare);
    }

    const offers: NormalizedOffer[] = [];

    for (const flight of availability) {
      const flightNum = flight.flight_number ?? flight.flightNumber ?? '';
      const fare = fareMap.get(flightNum) ?? fares[0]; // fallback to first fare

      if (!fare) continue;

      const adultPrice = fare.adult_price ?? fare.adultPrice ?? 0;
      const childPrice = fare.child_price ?? fare.childPrice ?? adultPrice * 0.75;
      const totalPrice =
        adultPrice * query.passengers.adults + childPrice * query.passengers.children;

      if (totalPrice <= 0) continue;

      const seatsAvail = flight.seats_available ?? flight.seatsAvailable ?? null;
      const totalPax = query.passengers.adults + query.passengers.children + query.passengers.infants;
      if (seatsAvail !== null && seatsAvail < totalPax) continue;

      offers.push({
        id: `AH-${flightNum}-${query.departureDate}`,
        airline: 'Air Haifa',
        origin: query.origin,
        destination: query.destination,
        departureDate: query.departureDate,
        departureTime: flight.departure_time ?? flight.departureTime ?? '',
        arrivalTime: flight.arrival_time ?? flight.arrivalTime ?? '',
        flightNumber: flightNum,
        cabinClass: flight.cabin_class ?? flight.cabinClass ?? 'Economy',
        totalPrice,
        currency: fare.currency ?? 'ILS',
        pricePerAdult: adultPrice,
        pricePerChild: childPrice,
        seatsAvailable: seatsAvail,
        passengerMix: query.passengers,
        bookingUrl: this.buildBookingUrl(query),
        offerIdOrRef: null,
        rulesSummary: fare.rules ?? fare.conditions ?? '',
        fetchedAt: new Date(),
        source: 'aerocrs',
      });
    }

    log.info({ count: offers.length, route: `${query.origin}-${query.destination}` }, 'Normalized offers');
    return offers;
  }

  private buildBookingUrl(query: SearchQuery): string {
    // Deep link to Air Haifa booking page with pre-filled route/date
    return `https://www.airhaifa.com/booking?from=${query.origin}&to=${query.destination}&date=${query.departureDate}&adults=${query.passengers.adults}&children=${query.passengers.children}`;
  }
}

// AeroCRS response shapes (flexible to handle camelCase or snake_case)
interface AeroCRSAvailability {
  flight_number?: string;
  flightNumber?: string;
  departure_time?: string;
  departureTime?: string;
  arrival_time?: string;
  arrivalTime?: string;
  seats_available?: number;
  seatsAvailable?: number;
  cabin_class?: string;
  cabinClass?: string;
  [key: string]: unknown;
}

interface AeroCRSFare {
  flight_number?: string;
  flightNumber?: string;
  adult_price?: number;
  adultPrice?: number;
  child_price?: number;
  childPrice?: number;
  currency?: string;
  rules?: string;
  conditions?: string;
  [key: string]: unknown;
}
