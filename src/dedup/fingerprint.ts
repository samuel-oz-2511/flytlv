import { createHash } from 'node:crypto';
import type { NormalizedOffer } from '../types/offer.js';

/**
 * Create a deterministic fingerprint for an offer.
 *
 * Price is excluded so that the same flight at a different price
 * doesn't bypass dedup. Price-drop logic is handled separately.
 */
export function offerFingerprint(offer: NormalizedOffer): string {
  const input = [
    offer.airline,
    offer.flightNumber,
    offer.departureDate,
    offer.origin,
    offer.destination,
    offer.cabinClass,
  ].join('|');

  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
