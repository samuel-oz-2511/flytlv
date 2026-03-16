/**
 * Token-bucket rate limiter.
 * Refills `maxTokens` tokens per `intervalMs` window.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly intervalMs: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.intervalMs) {
      const periods = Math.floor(elapsed / this.intervalMs);
      this.tokens = Math.min(this.maxTokens, this.tokens + periods * this.maxTokens);
      this.lastRefill += periods * this.intervalMs;
    }
  }

  canConsume(): boolean {
    this.refill();
    return this.tokens > 0;
  }

  consume(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  async waitForToken(): Promise<void> {
    while (!this.consume()) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  get remaining(): number {
    this.refill();
    return this.tokens;
  }

  get utilizationPct(): number {
    this.refill();
    return ((this.maxTokens - this.tokens) / this.maxTokens) * 100;
  }
}
