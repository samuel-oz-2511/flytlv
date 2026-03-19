import cron from 'node-cron';
import type { AirlineAdapter } from '../types/airline.js';
import { AirlineSource } from '../types/airline.js';
import type { AppConfig } from '../types/config.js';
import type { SearchesConfig } from '../types/config.js';
import { expandSearches } from '../planner/query-planner.js';
import { PollExecutor } from './poll-executor.js';
import { CooldownStore } from '../dedup/cooldown-store.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('scheduler');

/**
 * Per-adapter poll intervals (minutes).
 *
 * El Al:     API-only, no browser → every 2 min
 * Air Haifa: Light browser scrape  → every 3 min
 * Arkia:     Playwright, ~2 min cycle → every 5 min
 * Israir:    Playwright, ~1-2 min cycle → every 5 min
 */
const ADAPTER_INTERVALS: Record<string, number> = {
  [AirlineSource.ELAL]: 2,
  [AirlineSource.AIR_HAIFA]: 3,
  [AirlineSource.ARKIA]: 5,
  [AirlineSource.ISRAIR]: 5,
};

export class Scheduler {
  private readonly tasks: cron.ScheduledTask[] = [];
  private readonly cleanupTask: cron.ScheduledTask;
  /** Prevent overlapping runs per adapter */
  private readonly running = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly searchesConfig: SearchesConfig,
    private readonly adapters: AirlineAdapter[],
    private readonly executor: PollExecutor,
    private readonly cooldown: CooldownStore,
  ) {
    this.cleanupTask = cron.schedule('0 * * * *', () => {
      this.cooldown.cleanup();
    }, { timezone: config.scheduler.timezone });
  }

  start(): void {
    const { timezone } = this.config.scheduler;

    for (const adapter of this.adapters) {
      if (!adapter.isEnabled()) continue;

      const minutes = ADAPTER_INTERVALS[adapter.source] || 10;
      const cronExpr = `*/${minutes} * * * *`;

      log.info({ adapter: adapter.name, interval: `${minutes}m`, cron: cronExpr }, 'Scheduling adapter');

      const task = cron.schedule(cronExpr, () => {
        this.runAdapter(adapter);
      }, { timezone });

      this.tasks.push(task);
    }

    this.cleanupTask.start();
    log.info({
      adapters: this.adapters
        .filter(a => a.isEnabled())
        .map(a => `${a.name} (${ADAPTER_INTERVALS[a.source] || 10}m)`),
    }, 'Scheduler started');

    // Run all immediately on startup
    setImmediate(() => {
      log.info('Running initial poll cycle on startup');
      this.runOnce().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, 'Initial poll cycle failed');
      });
    });
  }

  private async runAdapter(adapter: AirlineAdapter): Promise<void> {
    if (this.running.has(adapter.source)) {
      log.warn({ adapter: adapter.name }, 'Skipping — previous cycle still running');
      return;
    }

    this.running.add(adapter.source);
    try {
      const queries = expandSearches(this.searchesConfig, adapter.source);
      if (queries.length === 0) {
        log.debug({ adapter: adapter.name }, 'No queries for this adapter');
        return;
      }
      await this.executor.execute(adapter, queries);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ adapter: adapter.name, error: msg }, 'Adapter poll failed');
    } finally {
      this.running.delete(adapter.source);
    }
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.cleanupTask.stop();
    log.info('Scheduler stopped');
  }

  async runOnce(): Promise<void> {
    for (const adapter of this.adapters) {
      if (!adapter.isEnabled()) continue;
      await this.runAdapter(adapter);
    }
  }
}
