import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { offerFingerprint } from './fingerprint.js';
import type { NormalizedOffer } from '../types/offer.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('cooldown');

/**
 * SQLite-backed dedup store with configurable cooldown window.
 *
 * Prevents repeated alerts for the same offer within the window.
 * Allows re-alert if price drops materially (>5%).
 * Persists across restarts so service restarts don't cause re-alerts.
 */
export class CooldownStore {
  private readonly db: Database.Database;
  private readonly cooldownMs: number;
  private readonly priceDrop = 0.05;

  constructor(cooldownMinutes: number, dbPath?: string) {
    this.cooldownMs = cooldownMinutes * 60_000;

    const resolvedPath = dbPath || path.join(process.cwd(), 'data', 'cooldown.db');
    mkdirSync(path.dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cooldown (
        fingerprint TEXT PRIMARY KEY,
        last_sent INTEGER NOT NULL,
        last_price REAL NOT NULL
      )
    `);
    log.info({ path: resolvedPath }, 'Cooldown store initialized (persistent)');
  }

  shouldAlert(offer: NormalizedOffer): boolean {
    const fp = offerFingerprint(offer);
    const now = Date.now();

    const existing = this.db.prepare(
      'SELECT last_sent, last_price FROM cooldown WHERE fingerprint = ?'
    ).get(fp) as { last_sent: number; last_price: number } | undefined;

    if (!existing) {
      this.db.prepare(
        'INSERT INTO cooldown (fingerprint, last_sent, last_price) VALUES (?, ?, ?)'
      ).run(fp, now, offer.totalPrice);
      return true;
    }

    if (now - existing.last_sent >= this.cooldownMs) {
      this.db.prepare(
        'UPDATE cooldown SET last_sent = ?, last_price = ? WHERE fingerprint = ?'
      ).run(now, offer.totalPrice, fp);
      return true;
    }

    if (offer.totalPrice < existing.last_price * (1 - this.priceDrop)) {
      log.info({ fp, oldPrice: existing.last_price, newPrice: offer.totalPrice }, 'Price drop — re-alerting');
      this.db.prepare(
        'UPDATE cooldown SET last_sent = ?, last_price = ? WHERE fingerprint = ?'
      ).run(now, offer.totalPrice, fp);
      return true;
    }

    return false;
  }

  cleanup(): void {
    const cutoff = Date.now() - this.cooldownMs * 3;
    const result = this.db.prepare('DELETE FROM cooldown WHERE last_sent < ?').run(cutoff);
    if (result.changes > 0) {
      log.debug({ removed: result.changes }, 'Cleanup complete');
    }
  }

  get size(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM cooldown').get() as any).c;
  }

  close(): void {
    this.db.close();
  }
}
