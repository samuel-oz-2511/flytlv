import 'dotenv/config';
import type { AppConfig } from './types/config.js';

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

export function loadConfig(): AppConfig {
  return {
    aerocrs: {
      entity: env('AEROCRS_ENTITY'),
      token: env('AEROCRS_TOKEN'),
      password: env('AEROCRS_PASSWORD'),
      baseUrl: env('AEROCRS_BASE_URL', 'https://api.aerocrs.com'),
    },
    duffel: {
      accessToken: env('DUFFEL_ACCESS_TOKEN'),
      env: env('DUFFEL_ENV', 'live') as 'test' | 'live',
    },
    arkia: { enabled: env('ARKIA_ENABLED') === 'true' },
    israir: { enabled: env('ISRAIR_ENABLED') === 'true' },
    slack: {
      mode: env('SLACK_MODE', 'webhook') as 'webhook' | 'bot',
      webhookUrl: env('SLACK_WEBHOOK_URL'),
      botToken: env('SLACK_BOT_TOKEN'),
      channelId: env('SLACK_CHANNEL_ID'),
    },
    scheduler: {
      pollIntervalMinutes: envInt('POLL_INTERVAL_MINUTES', 5),
      pollHoursStart: envInt('POLL_HOURS_START', 6),
      pollHoursEnd: envInt('POLL_HOURS_END', 22),
      timezone: env('TIMEZONE', 'Asia/Jerusalem'),
    },
    dedup: {
      cooldownMinutes: envInt('DEDUP_COOLDOWN_MINUTES', 45),
    },
    logLevel: env('LOG_LEVEL', 'info'),
  };
}
