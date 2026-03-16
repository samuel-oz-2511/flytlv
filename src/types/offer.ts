export interface PassengerMix {
  adults: number;
  children: number;
  infants: number;
}

export interface SearchQuery {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: PassengerMix;
}

export interface NormalizedOffer {
  id: string;
  airline: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  flightNumber: string;
  cabinClass: string;
  totalPrice: number;
  currency: string;
  pricePerAdult: number;
  pricePerChild: number;
  seatsAvailable: number | null;
  passengerMix: PassengerMix;
  bookingUrl: string | null;
  offerIdOrRef: string | null;
  rulesSummary: string;
  fetchedAt: Date;
  source: string;
  raw?: unknown;
}
