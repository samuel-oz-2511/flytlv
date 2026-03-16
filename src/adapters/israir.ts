import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('israir');

/**
 * Israir adapter — placeholder.
 *
 * Israir uses Amadeus Altéa PSS. Integration options:
 * - Amadeus Self-Service APIs (amadeus.com/self-service)
 * - Amadeus for Developers Flight Offers Search
 * - Amadeus Enterprise (requires commercial agreement)
 *
 * When access is obtained, implement using the `amadeus` npm SDK:
 * - amadeus.shopping.flightOffersSearch.get({ ... })
 * - Filter by carrier code (6H = Israir)
 */
export class IsrairAdapter implements AirlineAdapter {
  readonly source = AirlineSource.ISRAIR;
  readonly name = 'Israir';

  constructor(private readonly enabled: boolean) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async searchOffers(_query: SearchQuery): Promise<NormalizedOffer[]> {
    if (!this.enabled) {
      log.debug('Israir adapter disabled — requires Amadeus API access');
      return [];
    }

    // TODO: Implement Amadeus integration
    // 1. Call flightOffersSearch.get({ originLocationCode, destinationLocationCode, departureDate, adults, children })
    // 2. Filter results by carrier '6H'
    // 3. Normalize to NormalizedOffer[]
    log.warn('Israir adapter enabled but not yet implemented');
    return [];
  }
}
