import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('arkia');

/**
 * Arkia adapter — placeholder.
 *
 * Arkia uses Sabre Radixx as its PSS. Integration requires a contracted
 * API agreement with Radixx ConnectPoint.
 *
 * When access is obtained, implement:
 * - SOAP client to Radixx ConnectPoint WSDL
 * - RetrieveAvailability for schedule/seat check
 * - RetrieveFareQuote for pricing validation
 */
export class ArkiaAdapter implements AirlineAdapter {
  readonly source = AirlineSource.ARKIA;
  readonly name = 'Arkia';

  constructor(private readonly enabled: boolean) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async searchOffers(_query: SearchQuery): Promise<NormalizedOffer[]> {
    if (!this.enabled) {
      log.debug('Arkia adapter disabled — requires Radixx ConnectPoint contract');
      return [];
    }

    // TODO: Implement Radixx ConnectPoint integration
    // 1. Call RetrieveAvailability(origin, destination, date, paxCount)
    // 2. If available, call RetrieveFareQuote for pricing
    // 3. Normalize response to NormalizedOffer[]
    log.warn('Arkia adapter enabled but not yet implemented');
    return [];
  }
}
