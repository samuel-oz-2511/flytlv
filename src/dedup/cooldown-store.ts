import { offerFingerprint } from './fingerprint.js';
import type { NormalizedOffer } from '../types/offer.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('cooldown');

interface CooldownEntry {
  lastSent: number;
  lastPrice: number;
}

/**
 * In-memory dedup store with configurable cooldown window.
 *
 * Prevents repeated alerts for the same offer within the window.
 * Allows re-alert if price drops materially (>5%).
 */
export class CooldownStore {
  private readonly store = new Map<string, CooldownEntry>();
  private readonly cooldownMs: number;
  private readonly priceDrop = 0.05; // 5% material drop

  constructor(cooldownMinutes: number) {
    this.cooldownMs = cooldownMinutes * 60_000;
  }

  /**
   * Returns true if the offer should be sent (not in cooldown or price dropped).
   */
  shouldAlert(offer: NormalizedOffer): boolean {
    const fp = offerFingerprint(offer);
    const now = Date.now();
    const existing = this.store.get(fp);

    if (!existing) {
      this.store.set(fp, { lastSent: now, lastPrice: offer.totalPrice });
      return true;
    }

    // Cooldown expired
    if (now - existing.lastSent >= this.cooldownMs) {
      this.store.set(fp, { lastSent: now, lastPrice: offer.totalPrice });
      return true;
    }

    // Material price drop
    if (offer.totalPrice < existing.lastPrice * (1 - this.priceDrop)) {
      log.info(
        { fp, oldPrice: existing.lastPrice, newPrice: offer.totalPrice },
        'Price drop detected — re-alerting',
      );
      this.store.set(fp, { lastSent: now, lastPrice: offer.totalPrice });
      return true;
    }

    log.debug({ fp, cooldownRemaining: this.cooldownMs - (now - existing.lastSent) }, 'Offer in cooldown');
    return false;
  }

  /** Periodically clean expired entries to prevent memory leaks. */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [fp, entry] of this.store) {
      if (now - entry.lastSent > this.cooldownMs * 3) {
        this.store.delete(fp);
        removed++;
      }
    }
    if (removed > 0) {
      log.debug({ removed, remaining: this.store.size }, 'Cleanup complete');
    }
  }

  get size(): number {
    return this.store.size;
  }
}
