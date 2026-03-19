import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import path from 'path';
import { childLogger } from '../utils/logger.js';

const log = childLogger('analytics');

const MILESTONES = [50, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export interface AnalyticsEvent {
  type: 'page_view' | 'enter_dashboard' | 'beacon';
  ip: string;
  page: string;
  referrer?: string;
  userAgent?: string;
  country?: string;
}

export interface DailyRow {
  date: string;
  page_views: number;
  unique_visitors: number;
  dashboard_enters: number;
}

export class AnalyticsStore {
  private db: Database.Database;
  private dailySalt: string;
  private saltDate: string;
  private cachedTotal: number = 0;
  private nextMilestone: number = 0;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), 'data', 'analytics.db');
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.dailySalt = randomBytes(32).toString('hex');
    this.saltDate = this.todayISR();
    this.init();
    this.warmCaches();
    log.info({ path: resolvedPath }, 'Analytics store initialized');
  }

  private todayISR(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        visitor_hash TEXT NOT NULL,
        page TEXT NOT NULL,
        referrer TEXT,
        device_type TEXT NOT NULL,
        country TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ev_created ON events(created_at);
      CREATE INDEX IF NOT EXISTS idx_ev_visitor ON events(visitor_hash);
      CREATE INDEX IF NOT EXISTS idx_ev_type ON events(event_type);

      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        page_views INTEGER DEFAULT 0,
        unique_visitors INTEGER DEFAULT 0,
        dashboard_enters INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS milestones (
        milestone INTEGER PRIMARY KEY,
        reached_at TEXT NOT NULL
      );
    `);
  }

  private warmCaches() {
    this.cachedTotal = (this.db.prepare(
      `SELECT COUNT(DISTINCT visitor_hash) as c FROM events`
    ).get() as any).c;

    const reached = (this.db.prepare(
      `SELECT MAX(milestone) as m FROM milestones`
    ).get() as any).m || 0;

    this.nextMilestone = MILESTONES.find(m => m > reached) || 0;
  }

  private rotateSalt() {
    const today = this.todayISR();
    if (today !== this.saltDate) {
      this.dailySalt = randomBytes(32).toString('hex');
      this.saltDate = today;
    }
  }

  private hashVisitor(ip: string): string {
    this.rotateSalt();
    return createHash('sha256').update(ip + this.dailySalt).digest('hex').slice(0, 16);
  }

  private detectDevice(ua: string): 'mobile' | 'desktop' {
    return /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : 'desktop';
  }

  private isBot(ua: string): boolean {
    return /bot|crawler|spider|googlebot|bingbot|yandex|slurp|duckduck|facebookexternalhit|whatsapp|telegram|preview/i.test(ua);
  }

  recordEvent(ev: AnalyticsEvent): { milestone?: number } | null {
    if (!ev.userAgent || this.isBot(ev.userAgent)) return null;

    const hash = this.hashVisitor(ev.ip);
    const device = this.detectDevice(ev.userAgent || '');
    const today = this.todayISR();
    const referrer = ev.referrer && ev.referrer !== '' && !ev.referrer.includes('claim.travel') ? ev.referrer : null;

    this.db.prepare(`
      INSERT INTO events (event_type, visitor_hash, page, referrer, device_type, country)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ev.type, hash, ev.page, referrer, device, ev.country || null);

    // Update daily stats
    const isNewVisitor = !(this.db.prepare(
      `SELECT 1 FROM events WHERE visitor_hash = ? AND date(created_at) = ? AND id != last_insert_rowid() LIMIT 1`
    ).get(hash, today));

    this.db.prepare(`
      INSERT INTO daily_stats (date, page_views, unique_visitors, dashboard_enters)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        page_views = page_views + ?,
        unique_visitors = unique_visitors + ?,
        dashboard_enters = dashboard_enters + ?
    `).run(
      today,
      ev.type === 'page_view' ? 1 : 0,
      isNewVisitor ? 1 : 0,
      ev.type === 'enter_dashboard' ? 1 : 0,
      ev.type === 'page_view' ? 1 : 0,
      isNewVisitor ? 1 : 0,
      ev.type === 'enter_dashboard' ? 1 : 0,
    );

    if (isNewVisitor) this.cachedTotal++;

    // Check milestones
    if (this.nextMilestone > 0 && this.cachedTotal >= this.nextMilestone) {
      const milestone = this.nextMilestone;
      this.db.prepare(`INSERT OR IGNORE INTO milestones (milestone, reached_at) VALUES (?, datetime('now'))`).run(milestone);
      this.nextMilestone = MILESTONES.find(m => m > milestone) || 0;
      log.info({ milestone, totalVisitors: this.cachedTotal }, `Traffic milestone reached: ${milestone} unique visitors`);
      return { milestone };
    }

    return null;
  }

  getDashboard(range: '7d' | '30d' | 'all' = '30d') {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 9999;
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const daily = this.db.prepare(
      `SELECT * FROM daily_stats WHERE date >= ? ORDER BY date ASC`
    ).all(since) as DailyRow[];

    const totals = this.db.prepare(`
      SELECT
        COUNT(*) as total_events,
        COUNT(DISTINCT visitor_hash) as total_visitors
      FROM events WHERE date(created_at) >= ?
    `).get(since) as any;

    const totalAllTime = this.cachedTotal;

    const topReferrers = this.db.prepare(`
      SELECT referrer, COUNT(*) as count
      FROM events WHERE referrer IS NOT NULL AND date(created_at) >= ?
      GROUP BY referrer ORDER BY count DESC LIMIT 10
    `).all(since) as { referrer: string; count: number }[];

    const devices = this.db.prepare(`
      SELECT device_type, COUNT(DISTINCT visitor_hash) as count
      FROM events WHERE date(created_at) >= ?
      GROUP BY device_type
    `).all(since) as { device_type: string; count: number }[];

    const countries = this.db.prepare(`
      SELECT country, COUNT(DISTINCT visitor_hash) as count
      FROM events WHERE country IS NOT NULL AND date(created_at) >= ?
      GROUP BY country ORDER BY count DESC LIMIT 10
    `).all(since) as { country: string; count: number }[];

    const todayStats = this.db.prepare(
      `SELECT * FROM daily_stats WHERE date = ?`
    ).get(this.todayISR()) as DailyRow | undefined;

    const milestonesReached = this.db.prepare(
      `SELECT * FROM milestones ORDER BY milestone ASC`
    ).all() as { milestone: number; reached_at: string }[];

    const dashboardEnters = (this.db.prepare(`
      SELECT COUNT(*) as c FROM events WHERE event_type = 'enter_dashboard' AND date(created_at) >= ?
    `).get(since) as any).c;

    return {
      daily,
      totals: { ...totals, totalAllTime },
      today: todayStats || { date: this.todayISR(), page_views: 0, unique_visitors: 0, dashboard_enters: 0 },
      topReferrers,
      devices,
      countries,
      milestones: milestonesReached,
      dashboardEnters,
    };
  }

  close() {
    this.db.close();
  }
}
