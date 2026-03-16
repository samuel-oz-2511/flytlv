import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
  redact: {
    paths: [
      'aerocrs.password',
      'aerocrs.token',
      'duffel.accessToken',
      'slack.webhookUrl',
      'slack.botToken',
    ],
    censor: '[REDACTED]',
  },
});

export function childLogger(name: string) {
  return logger.child({ component: name });
}
