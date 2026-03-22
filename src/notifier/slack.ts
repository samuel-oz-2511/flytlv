import axios from 'axios';
import type { NormalizedOffer } from '../types/offer.js';
import type { AppConfig } from '../types/config.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('slack');

/**
 * Slack notifier.
 *
 * Supports two modes:
 * - webhook: POST to incoming webhook URL (simpler, channel-locked)
 * - bot: POST via chat.postMessage with bot token (more control)
 *
 * Rate limited to 1 msg/sec to comply with Slack limits.
 */
export class SlackNotifier {
  private readonly rateLimiter = new RateLimiter(1, 1_000); // 1 msg/sec

  constructor(private readonly config: AppConfig['slack']) {}

  isEnabled(): boolean {
    if (this.config.mode === 'webhook') return !!this.config.webhookUrl;
    return !!(this.config.botToken && this.config.channelId);
  }

  async sendAlert(offer: NormalizedOffer): Promise<void> {
    if (!this.isEnabled()) {
      log.warn('Slack not configured — skipping alert');
      return;
    }

    await this.rateLimiter.waitForToken();

    const payload = this.buildPayload(offer);

    try {
      if (this.config.mode === 'webhook') {
        await axios.post(this.config.webhookUrl, payload, { timeout: 10_000 });
      } else {
        await axios.post('https://slack.com/api/chat.postMessage', {
          channel: this.config.channelId,
          ...payload,
        }, {
          headers: { Authorization: `Bearer ${this.config.botToken}` },
          timeout: 10_000,
        });
      }

      log.info({ offerId: offer.id, airline: offer.airline }, 'Slack alert sent');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg, offerId: offer.id }, 'Failed to send Slack alert');
    }
  }

  async sendFamilyAlert(offer: NormalizedOffer): Promise<void> {
    if (!this.isEnabled()) return;
    await this.rateLimiter.waitForToken();

    const seats = offer.seatsAvailable !== null ? offer.seatsAvailable : '?';
    const price4 = offer.totalPrice === 0
      ? 'Check airline for pricing'
      : `Est. family price: ${offer.currency} ${(offer.pricePerAdult * 2 + offer.pricePerChild * 1 + offer.pricePerAdult * 0.1).toFixed(0)} (2A+1K+1I)`;

    const payload = {
      text: `FAMILY MATCH: ${offer.airline} ${offer.origin}->${offer.destination} ${offer.departureDate} — ${seats} seats — ${price4}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `👨‍👩‍👦 FAMILY MATCH — ${offer.airline}`, emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Route:*\n${offer.origin} → ${offer.destination}` },
            { type: 'mrkdwn', text: `*Date:*\n${offer.departureDate}` },
            { type: 'mrkdwn', text: `*Time:*\n${offer.departureTime || '—'}` },
            { type: 'mrkdwn', text: `*Seats:*\n${seats}` },
            { type: 'mrkdwn', text: `*${price4}*` },
            { type: 'mrkdwn', text: `*Book:*\n${offer.bookingUrl ? `<${offer.bookingUrl}|Book Now>` : 'Check airline'}` },
          ],
        },
        { type: 'divider' },
      ],
    };

    try {
      if (this.config.mode === 'webhook') {
        await axios.post(this.config.webhookUrl, payload, { timeout: 10_000 });
      } else {
        await axios.post('https://slack.com/api/chat.postMessage', {
          channel: this.config.channelId, ...payload,
        }, { headers: { Authorization: `Bearer ${this.config.botToken}` }, timeout: 10_000 });
      }
      log.info({ offerId: offer.id }, 'Family alert sent');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ error: msg }, 'Failed to send family alert');
    }
  }

  private buildPayload(offer: NormalizedOffer): Record<string, unknown> {
    const isSeatsOnly = offer.totalPrice === 0; // El Al seat availability (no pricing)

    const priceBreakdown = isSeatsOnly
      ? 'Price not available (seat availability only)'
      : `${offer.pricePerAdult} x ${offer.passengerMix.adults} adults + ${offer.pricePerChild} x ${offer.passengerMix.children} child`;

    const purchasePath = offer.bookingUrl
      ? `<${offer.bookingUrl}|Book Now>`
      : offer.offerIdOrRef
        ? `Offer ID: \`${offer.offerIdOrRef}\``
        : 'No direct link';

    const isRoundTrip = offer.rulesSummary?.includes('Round-trip') ?? false;
    const priceLabel = isRoundTrip ? 'Round-trip Price' : 'One-way Price';

    const priceFields = isSeatsOnly
      ? [
          { type: 'mrkdwn', text: `*Seats Available:*\n🟢 ${offer.seatsAvailable}` },
          { type: 'mrkdwn', text: `*Info:*\nSeat availability only — check elal.com for pricing` },
        ]
      : [
          { type: 'mrkdwn', text: `*${priceLabel}:*\n${offer.currency} ${offer.totalPrice.toFixed(2)}` },
          { type: 'mrkdwn', text: `*Breakdown:*\n${priceBreakdown}` },
        ];

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `✈️ ${offer.airline} — ${offer.flightNumber}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Route:*\n${offer.origin} → ${offer.destination}` },
          { type: 'mrkdwn', text: `*Date:*\n${offer.departureDate}` },
          { type: 'mrkdwn', text: `*Departure:*\n${offer.departureTime}` },
          { type: 'mrkdwn', text: `*Arrival:*\n${offer.arrivalTime || '—'}` },
          ...priceFields,
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Cabin:*\n${offer.cabinClass}` },
          ...(!isSeatsOnly ? [{
            type: 'mrkdwn',
            text: `*Seats:*\n${offer.seatsAvailable !== null ? offer.seatsAvailable : 'Unknown'}`,
          }] : []),
          { type: 'mrkdwn', text: `*Conditions:*\n${offer.rulesSummary || 'N/A'}` },
          { type: 'mrkdwn', text: `*Source:*\n${offer.source}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Purchase:* ${purchasePath}` },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Fetched at ${offer.fetchedAt.toISOString()} | Passengers: ${offer.passengerMix.adults}A + ${offer.passengerMix.children}C`,
          },
        ],
      },
      { type: 'divider' },
    ];

    const fallbackText = isSeatsOnly
      ? `${offer.airline} ${offer.flightNumber}: ${offer.origin}→${offer.destination} on ${offer.departureDate} — ${offer.seatsAvailable} seats available`
      : `${offer.airline} ${offer.flightNumber}: ${offer.origin}→${offer.destination} on ${offer.departureDate} — ${offer.currency} ${offer.totalPrice.toFixed(2)}`;

    return { text: fallbackText, blocks };
  }
}
