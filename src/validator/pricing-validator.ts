import type { NormalizedOffer, PassengerMix } from '../types/offer.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('validator');

/**
 * Validates that an offer truly satisfies the "bookable now" criteria:
 * - Priced for the exact passenger mix (2A + 1C)
 * - Non-zero total price
 * - Enough seats available (if seat count is known)
 * - Has a purchase path (booking URL or offer ID)
 */
export function validateOffer(
  offer: NormalizedOffer,
  requiredMix: PassengerMix,
): { valid: boolean; reason?: string } {
  // Check passenger mix matches
  if (
    offer.passengerMix.adults !== requiredMix.adults ||
    offer.passengerMix.children !== requiredMix.children
  ) {
    return {
      valid: false,
      reason: `Passenger mix mismatch: got ${offer.passengerMix.adults}A+${offer.passengerMix.children}C, need ${requiredMix.adults}A+${requiredMix.children}C`,
    };
  }

  // Non-zero price (skip for seat-availability-only sources like El Al)
  const isSeatsOnly = offer.source.includes('seat availability');
  if (!isSeatsOnly && offer.totalPrice <= 0) {
    return { valid: false, reason: 'Zero or negative price' };
  }

  // Seat availability check
  const totalPax = requiredMix.adults + requiredMix.children + requiredMix.infants;
  if (offer.seatsAvailable !== null && offer.seatsAvailable < totalPax) {
    return {
      valid: false,
      reason: `Insufficient seats: ${offer.seatsAvailable} available, ${totalPax} needed`,
    };
  }

  // Must have a purchase path
  if (!offer.bookingUrl && !offer.offerIdOrRef) {
    return { valid: false, reason: 'No purchase path (no booking URL or offer ID)' };
  }

  return { valid: true };
}

export function validateOffers(
  offers: NormalizedOffer[],
  requiredMix: PassengerMix,
): NormalizedOffer[] {
  const valid: NormalizedOffer[] = [];

  for (const offer of offers) {
    const result = validateOffer(offer, requiredMix);
    if (result.valid) {
      valid.push(offer);
    } else {
      log.debug({ id: offer.id, reason: result.reason }, 'Offer rejected');
    }
  }

  log.info({ input: offers.length, valid: valid.length }, 'Validation complete');
  return valid;
}
