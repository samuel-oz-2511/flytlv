import cron from 'node-cron';
import type { AirlineAdapter } from '../types/airline.js';
import type { AppConfig } from '../types/config.js';
import type { SearchesConfig } from '../types/config.js';
import { expandSearches } from '../planner/query-planner.js';
import { PollExecutor } from './poll-executor.js';
import { CooldownStore } from '../dedup/cooldown-store.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('scheduler');

export class Scheduler {
  private readonly tasks: cron.ScheduledTask[] = [];
  private readonly cleanupTask: cron.ScheduledTask;

  constructor(
    private readonly config: AppConfig,
    private readonly searchesConfig: SearchesConfig,
    private readonly adapters: AirlineAdapter[],
    private readonly executor: PollExecutor,
    private readonly cooldown: CooldownStore,
  ) {
    // Cleanup expired cooldown entries every hour
    this.cleanupTask = cron.schedule('0 * * * *', () => {
      this.cooldown.cleanup();
    }, { timezone: config.scheduler.timezone });
  }

  start(): void {
    const { pollIntervalMinutes, timezone } = this.config.scheduler;
    const cronExpr = `*/${pollIntervalMinutes} * * * *`;

    log.info({ cron: cronExpr, timezone, adapters: this.adapters.filter(a => a.isEnabled()).map(a => a.name) }, 'Scheduling all adapters');

    const task = cron.schedule(cronExpr, async () => {
      for (const adapter of this.adapters) {
        if (!adapter.isEnabled()) continue;

        const queries = expandSearches(this.searchesConfig, adapter.source);
        if (queries.length === 0) {
          log.debug({ adapter: adapter.name }, 'No queries for this adapter');
          continue;
        }

        await this.executor.execute(adapter, queries);
      }
    }, { timezone });

    this.tasks.push(task);
    this.cleanupTask.start();
    log.info({ intervalMinutes: pollIntervalMinutes }, 'Scheduler started');
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.cleanupTask.stop();
    log.info('Scheduler stopped');
  }

  /** Run one immediate poll cycle for all adapters (useful for testing). */
  async runOnce(): Promise<void> {
    for (const adapter of this.adapters) {
      if (!adapter.isEnabled()) continue;
      const queries = expandSearches(this.searchesConfig, adapter.source);
      await this.executor.execute(adapter, queries);
    }
  }

}
