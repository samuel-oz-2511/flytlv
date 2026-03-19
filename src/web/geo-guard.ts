import type { Request, Response, NextFunction } from 'express';
import { childLogger } from '../utils/logger.js';

const log = childLogger('geo-guard');

/** Cache IP → country for 1 hour to avoid hammering the lookup API */
const cache = new Map<string, { country: string; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

const ALLOWED_COUNTRIES = new Set(['IL']);

/** Bypass list for local dev, health checks, etc. */
function isLocalIP(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost'
    || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
}

function getClientIP(req: Request): string {
  // Respect X-Forwarded-For behind reverse proxy (Caddy, Cloudflare, etc.)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',')[0].trim();
    return first;
  }
  return req.ip || req.socket.remoteAddress || '';
}

async function lookupCountry(ip: string): Promise<string> {
  const cached = cache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.country;

  try {
    // Free, no-key-needed geo-IP API
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode,status`);
    const data = await res.json() as { status: string; countryCode?: string };
    const country = data.status === 'success' ? (data.countryCode || 'XX') : 'XX';
    cache.set(ip, { country, ts: Date.now() });
    return country;
  } catch {
    // On lookup failure, allow through (fail open for availability)
    return 'IL';
  }
}

/**
 * Express middleware that restricts access to Israeli IPs.
 * Applied to all routes. API and page requests from non-IL IPs get a 403.
 */
export function geoGuard() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = getClientIP(req);

    if (isLocalIP(ip)) {
      next();
      return;
    }

    const country = await lookupCountry(ip);

    if (ALLOWED_COUNTRIES.has(country)) {
      next();
      return;
    }

    log.warn({ ip, country, path: req.path }, 'Blocked non-IL access');

    if (req.path.startsWith('/api/')) {
      res.status(403).json({ error: 'This service is only available in Israel.' });
    } else {
      res.status(403).send(`
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><title>FlyTLV</title>
        <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f6f8;color:#0f172a;text-align:center}
        .box{max-width:400px;padding:48px 32px;background:#fff;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
        h1{font-size:24px;margin-bottom:8px}p{color:#475569;font-size:15px;line-height:1.6}</style></head>
        <body><div class="box"><h1>FlyTLV</h1><p>This service is currently available only to users in Israel.</p></div></body></html>
      `);
    }
  };
}
