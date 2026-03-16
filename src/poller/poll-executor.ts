import type { AirlineAdapter } from '../types/airline.js';
import type { SearchQuery, NormalizedOffer } from '../types/offer.js';
import { validateOffers } from '../validator/pricing-validator.js';
import { CooldownStore } from '../dedup/cooldown-store.js';
import { SlackNotifier } from '../notifier/slack.js';
import type { OfferStore } from '../store/offer-store.js';
import { offerFingerprint } from '../dedup/fingerprint.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('poll-executor');

/** Max concurrent route scrapes per adapter */
const ROUTE_CONCURRENCY = 3;

/**
 * Runs the full pipeline for a given adapter:
 * queries → search → validate → dedup → notify
 *
 * Groups queries by route and processes unique routes with concurrency
 * to avoid scraping the same route for each date sequentially.
 */
export class PollExecutor {
  private offerStore: OfferStore | null = null;

  constructor(
    private readonly cooldown: CooldownStore,
    private readonly slack: SlackNotifier,
  ) {}

  setOfferStore(store: OfferStore): void {
    this.offerStore = store;
  }

  async execute(adapter: AirlineAdapter, queries: SearchQuery[]): Promise<number> {
    if (!adapter.isEnabled()) {
      log.debug({ adapter: adapter.name }, 'Adapter disabled, skipping');
      return 0;
    }

    // Group queries by route — scrapers cache per route, so only the first
    // query per route triggers an actual page load.
    const routeMap = new Map<string, SearchQuery[]>();
    for (const q of queries) {
      const key = `${q.origin}-${q.destination}`;
      const list = routeMap.get(key) || [];
      list.push(q);
      routeMap.set(key, list);
    }

    const uniqueRoutes = routeMap.size;
    log.info({ adapter: adapter.name, queryCount: queries.length, uniqueRoutes }, 'Starting poll cycle');

    let alertsSent = 0;
    const allValidOffers: NormalizedOffer[] = [];

    // Process routes with concurrency limit
    const routeEntries = [...routeMap.entries()];
    for (let i = 0; i < routeEntries.length; i += ROUTE_CONCURRENCY) {
      const batch = routeEntries.slice(i, i + ROUTE_CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(async ([routeKey, routeQueries]) => {
          let routeAlerts = 0;
          for (const query of routeQueries) {
            try {
              const rawOffers = await adapter.searchOffers(query);
              if (rawOffers.length === 0) continue;

              const validOffers = validateOffers(rawOffers, query.passengers);
              if (validOffers.length === 0) continue;

              // Collect for dashboard store
              allValidOffers.push(...validOffers);

              const newOffers = validOffers.filter((o) => this.cooldown.shouldAlert(o));
              if (newOffers.length === 0) continue;

              for (const offer of newOffers) {
                await this.slack.sendAlert(offer);
                routeAlerts++;
              }

              log.info({
                adapter: adapter.name,
                route: routeKey,
                date: query.departureDate,
                raw: rawOffers.length,
                valid: validOffers.length,
                alerted: newOffers.length,
              }, 'Query processed');
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              log.error({
                adapter: adapter.name,
                route: routeKey,
                date: query.departureDate,
                error: msg,
              }, 'Query failed');
            }
          }
          return routeAlerts;
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') alertsSent += r.value;
      }
    }

    // Record all valid offers to the dashboard store
    if (this.offerStore && allValidOffers.length > 0) {
      try {
        this.offerStore.recordOffers(allValidOffers, offerFingerprint);
        this.offerStore.markGone(adapter.name, 15);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, 'Failed to record offers to store');
      }
    }

    log.info({ adapter: adapter.name, alertsSent, uniqueRoutes }, 'Poll cycle complete');
    return alertsSent;
  }
}
