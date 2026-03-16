import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import type { NormalizedOffer } from '../types/offer.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('offer-store');

export interface StoredOffer {
  id: string;
  fingerprint: string;
  airline: string;
  flight_number: string;
  origin: string;
  destination: string;
  departure_date: string;
  departure_time: string;
  arrival_time: string;
  cabin_class: string;
  total_price: number;
  currency: string;
  price_per_adult: number;
  price_per_child: number;
  seats_available: number | null;
  booking_url: string | null;
  source: string;
  conditions: string;
  status: 'available' | 'gone';
  first_seen: string;
  last_seen: string;
  gone_at: string | null;
  alert_count: number;
}

export class OfferStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), 'data', 'offers.db');
    mkdirSync(path.dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
    log.info({ path: resolvedPath }, 'Offer store initialized');
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS offers (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        airline TEXT NOT NULL,
        flight_number TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        departure_date TEXT NOT NULL,
        departure_time TEXT NOT NULL,
        arrival_time TEXT NOT NULL,
        cabin_class TEXT DEFAULT 'Economy',
        total_price REAL NOT NULL,
        currency TEXT DEFAULT 'USD',
        price_per_adult REAL NOT NULL,
        price_per_child REAL NOT NULL,
        seats_available INTEGER,
        booking_url TEXT,
        source TEXT NOT NULL,
        conditions TEXT DEFAULT '',
        status TEXT DEFAULT 'available',
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        gone_at TEXT,
        alert_count INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
      CREATE INDEX IF NOT EXISTS idx_offers_fingerprint ON offers(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_offers_departure ON offers(departure_date);
      CREATE INDEX IF NOT EXISTS idx_offers_airline ON offers(airline);

      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_fingerprint TEXT NOT NULL,
        price REAL NOT NULL,
        seats INTEGER,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ph_fingerprint ON price_history(offer_fingerprint);
    `);
  }

  /**
   * Record offers from a poll cycle.
   */
  recordOffers(offers: NormalizedOffer[], fingerprinter: (o: NormalizedOffer) => string): void {
    const now = new Date().toISOString();

    const upsert = this.db.prepare(`
      INSERT INTO offers (id, fingerprint, airline, flight_number, origin, destination,
        departure_date, departure_time, arrival_time, cabin_class, total_price, currency,
        price_per_adult, price_per_child, seats_available, booking_url, source, conditions,
        status, first_seen, last_seen, alert_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        total_price = excluded.total_price,
        seats_available = excluded.seats_available,
        status = 'available',
        last_seen = excluded.last_seen,
        gone_at = NULL
    `);

    const recordPrice = this.db.prepare(`
      INSERT INTO price_history (offer_fingerprint, price, seats, recorded_at)
      VALUES (?, ?, ?, ?)
    `);

    const lastPrice = this.db.prepare(`
      SELECT price FROM price_history WHERE offer_fingerprint = ? ORDER BY recorded_at DESC LIMIT 1
    `);

    const upsertMany = this.db.transaction((offerList: NormalizedOffer[]) => {
      for (const o of offerList) {
        const fp = fingerprinter(o);
        upsert.run(
          o.id, fp, o.airline, o.flightNumber, o.origin, o.destination,
          o.departureDate, o.departureTime, o.arrivalTime, o.cabinClass,
          o.totalPrice, o.currency, o.pricePerAdult, o.pricePerChild,
          o.seatsAvailable, o.bookingUrl, o.source, o.rulesSummary,
          now, now
        );
        // Only record price if it changed
        const prev = lastPrice.get(fp) as { price: number } | undefined;
        if (!prev || prev.price !== o.totalPrice) {
          recordPrice.run(fp, o.totalPrice, o.seatsAvailable, now);
        }
      }
    });

    upsertMany(offers);
    log.debug({ recorded: offers.length }, 'Offers recorded');
  }

  /**
   * Mark offers as "gone" if they haven't been seen since the cutoff.
   */
  markGone(airline: string, cutoffMinutes: number = 15): number {
    const cutoff = new Date(Date.now() - cutoffMinutes * 60_000).toISOString();
    const result = this.db.prepare(`
      UPDATE offers SET status = 'gone', gone_at = ?
      WHERE airline = ? AND status = 'available' AND last_seen < ?
      AND departure_date >= date('now')
    `).run(new Date().toISOString(), airline, cutoff);
    return result.changes;
  }

  /** Get all current + recent offers for the dashboard */
  getAllOffers(options?: { status?: string; airline?: string; destination?: string }): StoredOffer[] {
    let sql = `SELECT * FROM offers WHERE departure_date >= date('now')`;
    const params: string[] = [];

    if (options?.status) {
      sql += ` AND status = ?`;
      params.push(options.status);
    }
    if (options?.airline) {
      sql += ` AND airline = ?`;
      params.push(options.airline);
    }
    if (options?.destination) {
      sql += ` AND destination = ?`;
      params.push(options.destination);
    }

    sql += ` ORDER BY status ASC, departure_date ASC, departure_time ASC`;
    return this.db.prepare(sql).all(...params) as StoredOffer[];
  }

  /** Get price history for a specific offer */
  getPriceHistory(fingerprint: string): { price: number; seats: number | null; recorded_at: string }[] {
    return this.db.prepare(
      `SELECT price, seats, recorded_at FROM price_history WHERE offer_fingerprint = ? ORDER BY recorded_at ASC`
    ).all(fingerprint) as any[];
  }

  /** Dashboard summary stats */
  getStats(): { available: number; gone: number; airlines: string[]; destinations: string[] } {
    const available = (this.db.prepare(
      `SELECT COUNT(*) as c FROM offers WHERE status = 'available' AND departure_date >= date('now')`
    ).get() as any).c;
    const gone = (this.db.prepare(
      `SELECT COUNT(*) as c FROM offers WHERE status = 'gone' AND departure_date >= date('now')`
    ).get() as any).c;
    const airlines = (this.db.prepare(
      `SELECT DISTINCT airline FROM offers WHERE departure_date >= date('now') ORDER BY airline`
    ).all() as any[]).map(r => r.airline);
    const destinations = (this.db.prepare(
      `SELECT DISTINCT destination FROM offers WHERE departure_date >= date('now') ORDER BY destination`
    ).all() as any[]).map(r => r.destination);
    return { available, gone, airlines, destinations };
  }

  close(): void {
    this.db.close();
  }
}
