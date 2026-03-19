import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { childLogger } from '../utils/logger.js';

const log = childLogger('user-store');

const SALT_ROUNDS = 10;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_COOLDOWN_MS = 60 * 1000; // 1 minute between resends

export interface UserPreferences {
  adults: number;
  children: number;
  infants: number;
  destinations: string; // comma-separated IATA codes, empty = all
  sort_by: string;      // 'departure' | 'price'
}

const DEFAULT_PREFS: UserPreferences = {
  adults: 1, children: 0, infants: 0,
  destinations: '', sort_by: 'departure',
};

export class UserStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), 'data', 'users.db');
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
    log.info({ path: resolvedPath }, 'User store initialized');
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        verified INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        adults INTEGER DEFAULT 1,
        children INTEGER DEFAULT 0,
        infants INTEGER DEFAULT 0,
        destinations TEXT DEFAULT '',
        sort_by TEXT DEFAULT 'departure',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS otp_codes (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        code TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempts INTEGER DEFAULT 0
      );
    `);

    // Migrations for existing DBs
    const cols = this.db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!cols.some(c => c.name === 'verified')) {
      this.db.exec('ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0');
    }
    if (!cols.some(c => c.name === 'first_name')) {
      this.db.exec("ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
    }
    if (!cols.some(c => c.name === 'last_name')) {
      this.db.exec("ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
    }
    if (!cols.some(c => c.name === 'phone')) {
      this.db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
    }
  }

  register(fields: { email: string; password: string; firstName: string; lastName: string; phone: string }): { id: string; email: string } | { error: string } {
    const normalizedEmail = fields.email.toLowerCase().trim();
    const firstName = fields.firstName.trim();
    const lastName = fields.lastName.trim();
    const phone = fields.phone.trim().replace(/[\s\-()]/g, '');

    if (!normalizedEmail.includes('@') || normalizedEmail.length < 5) {
      return { error: 'Please enter a valid email address.' };
    }
    if (fields.password.length < 6) {
      return { error: 'Password must be at least 6 characters.' };
    }
    if (!firstName || !lastName) {
      return { error: 'First name and last name are required.' };
    }
    // Israeli phone: 05X-XXXXXXX or +9725X... (10 digits starting with 05, or 12 digits starting with +9725)
    const phoneClean = phone.replace(/^\+/, '');
    const validPhone = /^05\d{8}$/.test(phoneClean) || /^9725\d{8}$/.test(phoneClean);
    if (!validPhone) {
      return { error: 'Please enter a valid Israeli mobile number (e.g. 050-1234567).' };
    }

    const existing = this.db.prepare('SELECT id, verified FROM users WHERE email = ?').get(normalizedEmail) as any;
    if (existing) {
      if (!existing.verified) {
        // Update name/phone for unverified re-registration
        this.db.prepare('UPDATE users SET first_name = ?, last_name = ?, phone = ? WHERE id = ?').run(firstName, lastName, phone, existing.id);
        return { id: existing.id, email: normalizedEmail };
      }
      return { error: 'An account with this email already exists.' };
    }

    const id = crypto.randomUUID();
    const hash = bcrypt.hashSync(fields.password, SALT_ROUNDS);
    const now = new Date().toISOString();

    this.db.prepare('INSERT INTO users (id, email, password, first_name, last_name, phone, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)').run(id, normalizedEmail, hash, firstName, lastName, phone, now);
    this.db.prepare('INSERT INTO user_preferences (user_id, adults, children, infants, destinations, sort_by, updated_at) VALUES (?, 1, 0, 0, \'\', \'departure\', ?)').run(id, now);

    log.info({ email: normalizedEmail }, 'User registered (pending verification)');
    return { id, email: normalizedEmail };
  }

  authenticate(email: string, password: string): { id: string; email: string; verified: boolean } | null {
    const normalizedEmail = email.toLowerCase().trim();
    const user = this.db.prepare('SELECT id, email, password, verified FROM users WHERE email = ?').get(normalizedEmail) as any;
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.password)) return null;
    return { id: user.id, email: user.email, verified: !!user.verified };
  }

  isVerified(userId: string): boolean {
    const row = this.db.prepare('SELECT verified FROM users WHERE id = ?').get(userId) as any;
    return row ? !!row.verified : false;
  }

  markVerified(userId: string): void {
    this.db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(userId);
    log.info({ userId }, 'User email verified');
  }

  // OTP management
  generateOTP(userId: string): { code: string } | { error: string } {
    // Check cooldown
    const existing = this.db.prepare('SELECT created_at FROM otp_codes WHERE user_id = ?').get(userId) as any;
    if (existing && (Date.now() - existing.created_at) < OTP_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - existing.created_at)) / 1000);
      return { error: `Please wait ${wait}s before requesting a new code.` };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    this.db.prepare('INSERT OR REPLACE INTO otp_codes (user_id, code, created_at, attempts) VALUES (?, ?, ?, 0)').run(userId, code, Date.now());
    return { code };
  }

  verifyOTP(userId: string, code: string): { success: boolean; error?: string } {
    const row = this.db.prepare('SELECT code, created_at, attempts FROM otp_codes WHERE user_id = ?').get(userId) as any;
    if (!row) return { success: false, error: 'No verification code found. Request a new one.' };

    if (row.attempts >= 5) {
      this.db.prepare('DELETE FROM otp_codes WHERE user_id = ?').run(userId);
      return { success: false, error: 'Too many attempts. Please request a new code.' };
    }

    if ((Date.now() - row.created_at) > OTP_EXPIRY_MS) {
      this.db.prepare('DELETE FROM otp_codes WHERE user_id = ?').run(userId);
      return { success: false, error: 'Code expired. Please request a new one.' };
    }

    if (row.code !== code.trim()) {
      this.db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE user_id = ?').run(userId);
      return { success: false, error: 'Incorrect code. Please try again.' };
    }

    // Success
    this.db.prepare('DELETE FROM otp_codes WHERE user_id = ?').run(userId);
    this.markVerified(userId);
    return { success: true };
  }

  // Session management
  createSession(userId: string): string {
    const sid = crypto.randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    this.db.prepare('INSERT OR REPLACE INTO sessions (sid, user_id, expires_at) VALUES (?, ?, ?)').run(sid, userId, expiresAt);
    return sid;
  }

  getSession(sid: string): { userId: string } | null {
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE sid = ?').get(sid) as any;
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return null;
    }
    return { userId: row.user_id };
  }

  destroySession(sid: string): void {
    this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
  }

  getUserById(id: string): { id: string; email: string; verified: boolean } | null {
    const row = this.db.prepare('SELECT id, email, verified FROM users WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { id: row.id, email: row.email, verified: !!row.verified };
  }

  getPreferences(userId: string): UserPreferences {
    const row = this.db.prepare('SELECT adults, children, infants, destinations, sort_by FROM user_preferences WHERE user_id = ?').get(userId) as any;
    return row || { ...DEFAULT_PREFS };
  }

  updatePreferences(userId: string, prefs: Partial<UserPreferences>): UserPreferences {
    const current = this.getPreferences(userId);
    const updated = {
      adults: Math.max(1, Math.min(9, prefs.adults ?? current.adults)),
      children: Math.max(0, Math.min(9, prefs.children ?? current.children)),
      infants: Math.max(0, Math.min(4, prefs.infants ?? current.infants)),
      destinations: prefs.destinations ?? current.destinations,
      sort_by: prefs.sort_by === 'price' ? 'price' : 'departure',
    };

    this.db.prepare(`
      INSERT INTO user_preferences (user_id, adults, children, infants, destinations, sort_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        adults = excluded.adults, children = excluded.children, infants = excluded.infants,
        destinations = excluded.destinations, sort_by = excluded.sort_by, updated_at = excluded.updated_at
    `).run(userId, updated.adults, updated.children, updated.infants, updated.destinations, updated.sort_by, new Date().toISOString());

    return updated;
  }

  cleanupSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }

  close(): void {
    this.db.close();
  }
}
