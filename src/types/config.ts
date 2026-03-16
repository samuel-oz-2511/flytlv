export interface AppConfig {
  aerocrs: {
    entity: string;
    token: string;
    password: string;
    baseUrl: string;
  };
  duffel: {
    accessToken: string;
    env: 'test' | 'live';
  };
  arkia: { enabled: boolean };
  israir: { enabled: boolean };
  slack: {
    mode: 'webhook' | 'bot';
    webhookUrl: string;
    botToken: string;
    channelId: string;
  };
  scheduler: {
    pollIntervalMinutes: number;
    pollHoursStart: number;
    pollHoursEnd: number;
    timezone: string;
  };
  dedup: {
    cooldownMinutes: number;
  };
  logLevel: string;
}

export interface SearchDefinition {
  name: string;
  origins: string[];
  destinations: string[];
  rolling_days: number;
  date_range?: {
    from: string;
    to: string;
  };
  days_of_week?: number[];
  passengers: {
    adults: number;
    children: number;
    infants?: number;
  };
  adapters?: string[];
}

export interface SearchesConfig {
  searches: SearchDefinition[];
}
