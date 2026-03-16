import { loadConfig } from './config.js';
import { loadSearches } from './planner/query-planner.js';
import { AirHaifaScraperAdapter } from './adapters/airhaifa-scraper.js';
import { ElAlSeatsAdapter } from './adapters/elal-seats-adapter.js';
import { ArkiaScraperAdapter } from './adapters/arkia-scraper.js';
import { IsrairScraperAdapter } from './adapters/israir-scraper.js';
import { CooldownStore } from './dedup/cooldown-store.js';
import { SlackNotifier } from './notifier/slack.js';
import { PollExecutor } from './poller/poll-executor.js';
import { Scheduler } from './poller/scheduler.js';
import { OfferStore } from './store/offer-store.js';
import { startWebServer } from './web/server.js';
import { closeBrowser } from './adapters/browser-pool.js';
import { logger } from './utils/logger.js';

async function main() {
  const config = loadConfig();
  const searchesConfig = loadSearches();

  logger.info('Flight Monitor starting...');

  // Initialize adapters
  const adapters = [
    new AirHaifaScraperAdapter(),
    new ElAlSeatsAdapter(),
    new ArkiaScraperAdapter(),
    new IsrairScraperAdapter(),
  ];

  const enabledAdapters = adapters.filter((a) => a.isEnabled());
  logger.info(
    { enabled: enabledAdapters.map((a) => a.name) },
    `${enabledAdapters.length} adapter(s) enabled`,
  );

  if (enabledAdapters.length === 0) {
    logger.warn('No adapters enabled. Configure API credentials in .env');
    logger.warn('Exiting. Set at least one adapter credential to start monitoring.');
    process.exit(0);
  }

  // Initialize pipeline components
  const cooldown = new CooldownStore(config.dedup.cooldownMinutes);
  const slack = new SlackNotifier(config.slack);
  const offerStore = new OfferStore();
  const executor = new PollExecutor(cooldown, slack);
  executor.setOfferStore(offerStore);
  const scheduler = new Scheduler(config, searchesConfig, adapters, executor, cooldown);

  // Start dashboard web server
  startWebServer(offerStore, 3737);
  logger.info('Dashboard available at http://localhost:3737');

  if (!slack.isEnabled()) {
    logger.warn('Slack not configured — alerts will be logged only');
  }

  // Run once immediately on startup, then schedule
  const runOnce = process.argv.includes('--once');

  if (runOnce) {
    logger.info('Running single poll cycle (--once mode)');
    await scheduler.runOnce();
    logger.info('Single cycle complete');
    process.exit(0);
  }

  // Start scheduled polling
  scheduler.start();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    scheduler.stop();
    offerStore.close();
    await closeBrowser();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Periodic health log
  setInterval(() => {
    logger.info({
      cooldownEntries: cooldown.size,
      uptime: Math.floor(process.uptime()),
    }, 'Health check');
  }, 300_000); // every 5 minutes

  logger.info('Flight Monitor running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  logger.fatal({ error: err instanceof Error ? err.message : String(err) }, 'Fatal error');
  process.exit(1);
});
