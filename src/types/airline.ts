import type { SearchQuery, NormalizedOffer } from './offer.js';

export enum AirlineSource {
  AIR_HAIFA = 'AIR_HAIFA',
  ARKIA = 'ARKIA',
  ISRAIR = 'ISRAIR',
  ELAL = 'ELAL',
}

export interface AirlineAdapter {
  source: AirlineSource;
  name: string;
  isEnabled(): boolean;
  searchOffers(query: SearchQuery): Promise<NormalizedOffer[]>;
}
