/**
 * Validator identity → display name, from Solana Compass.
 * The endpoint falls back to the first 8 chars of the identity when a validator
 * has no name; those are treated as unnamed.
 */
const URL = 'https://solanacompass.com/api/live/validators';
const REFRESH_MS = 60 * 60 * 1000;

export class ValidatorNames {
  private names = new Map<string, string>();
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

  get(identity: string): string | undefined {
    return this.names.get(identity);
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, { name?: string }>;
      const next = new Map<string, string>();
      for (const [id, v] of Object.entries(data)) {
        if (v?.name && v.name !== id.slice(0, 8)) next.set(id, v.name);
      }
      if (next.size > 0) this.names = next;
      console.log(`ValidatorNames: loaded ${next.size} names`);
    } catch (err: any) {
      console.error('ValidatorNames: refresh failed:', err?.message ?? err);
    }
  }
}
