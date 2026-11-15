/**
 * SOL/USD price from Solana Compass, polled and cached in-process.
 * `get()` returns undefined when the price is stale (source down or stalled),
 * so callers omit the field rather than repeat an old value.
 */
const URL = 'https://solanacompass.com/api/prices/sol-usd/current';
const REFRESH_MS = 10_000;
const MAX_AGE_MS = 60_000;
const TIMEOUT_MS = 5_000;

export class SolPrice {
  private price: number | undefined;
  private asOf = 0; // ms epoch the price was valid at
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(): number | undefined {
    return this.price !== undefined && Date.now() - this.asOf <= MAX_AGE_MS ? this.price : undefined;
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { price?: unknown; timestamp?: unknown };
      const price = Number(data.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error(`bad price: ${data.price}`);
      // Age by the source's own timestamp so a stalled source goes stale too;
      // never trust a timestamp ahead of our clock.
      const now = Date.now();
      const ts = typeof data.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
      this.asOf = Number.isFinite(ts) ? Math.min(ts, now) : now;
      this.price = Math.round(price * 100) / 100;
    } catch (err: any) {
      console.error('SolPrice: refresh failed:', err?.message ?? err);
    }
  }
}
