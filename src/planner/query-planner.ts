import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import type { SearchesConfig, SearchDefinition } from '../types/config.js';
import type { SearchQuery } from '../types/offer.js';
import { AirlineSource } from '../types/airline.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('query-planner');

export function loadSearches(configPath?: string): SearchesConfig {
  const path = configPath ?? resolve(process.cwd(), 'config', 'searches.yaml');
  const raw = readFileSync(path, 'utf-8');
  return yaml.load(raw) as SearchesConfig;
}

/**
 * Expand search definitions into concrete SearchQuery objects.
 * One query per origin/destination/date combination.
 */
export function expandSearches(
  config: SearchesConfig,
  adapterFilter?: AirlineSource,
): SearchQuery[] {
  const queries: SearchQuery[] = [];

  for (const def of config.searches) {
    if (adapterFilter && def.adapters && !def.adapters.includes(adapterFilter)) {
      continue;
    }

    const dates = generateDates(def);

    for (const origin of def.origins) {
      for (const dest of def.destinations) {
        for (const date of dates) {
          queries.push({
            origin,
            destination: dest,
            departureDate: date,
            passengers: {
              adults: def.passengers.adults,
              children: def.passengers.children,
              infants: def.passengers.infants ?? 0,
            },
          });
        }
      }
    }
  }

  log.info({ count: queries.length, adapter: adapterFilter }, 'Expanded search queries');
  return queries;
}

function generateDates(def: SearchDefinition): string[] {
  const dates: string[] = [];
  const allowedDays = def.days_of_week ? new Set(def.days_of_week) : null;

  if (def.rolling_days) {
    // Rolling window: today + N days
    const today = new Date();
    for (let i = 0; i <= def.rolling_days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dayOfWeek = d.getDay();
      if (!allowedDays || allowedDays.has(dayOfWeek)) {
        dates.push(d.toISOString().slice(0, 10));
      }
    }
  } else if (def.date_range) {
    // Fixed date range (legacy)
    const from = new Date(def.date_range.from);
    const to = new Date(def.date_range.to);
    const cursor = new Date(from);
    while (cursor <= to) {
      const dayOfWeek = cursor.getDay();
      if (!allowedDays || allowedDays.has(dayOfWeek)) {
        dates.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return dates;
}
