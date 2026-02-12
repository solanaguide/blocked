/**
 * Token name resolution via Jupiter API
 * Resolves Solana token mint addresses to human-readable $SYMBOL names
 */

export interface TokenInfo {
  symbol: string;
  name: string;
  image?: string;
}

export class TokenResolver {
  private cache: Map<string, TokenInfo> = new Map();
  private lastQueryTime = 0;
  private minQueryInterval = 5000; // 5 seconds between API calls

  constructor() {
    // Pre-seed with well-known tokens
    this.cache.set('So11111111111111111111111111111111111111112', { symbol: 'SOL', name: 'Solana' });
    this.cache.set('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: 'USDC', name: 'USD Coin' });
    this.cache.set('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { symbol: 'USDT', name: 'Tether USD' });
  }

  /**
   * Batch-resolve token mints via Jupiter API
   */
  async resolve(mints: string[]): Promise<void> {
    if (mints.length === 0) return;

    const now = Date.now();
    if (now - this.lastQueryTime < this.minQueryInterval) return;
    this.lastQueryTime = now;

    try {
      // Jupiter token search API - comma-separated mints, up to 100
      const mintList = mints.slice(0, 100).join(',');
      const url = `https://lite-api.jup.ag/tokens/v2/search?query=${mintList}`;
      console.log(`TokenResolver: querying ${mints.length} mints...`);
      const res = await fetch(url);

      if (!res.ok) {
        console.error(`Jupiter API error: ${res.status} ${res.statusText}`);
        return;
      }

      const tokens = await res.json();

      if (Array.isArray(tokens)) {
        for (const token of tokens) {
          if (token.id && token.symbol) {
            this.cache.set(token.id, {
              symbol: token.symbol,
              name: token.name || token.symbol,
              image: token.icon || undefined,
            });
          }
        }
        console.log(`TokenResolver: resolved ${tokens.length} tokens (cache size: ${this.cache.size})`);
      }
    } catch (err) {
      console.error('TokenResolver fetch error:', (err as Error).message);
    }
  }

  /**
   * Get the $SYMBOL for a full mint address, or null if not cached
   */
  getSymbol(mint: string): string | null {
    const info = this.cache.get(mint);
    return info ? `$${info.symbol}` : null;
  }

  /**
   * Return mints that are not yet in the cache
   */
  getMissing(mints: string[]): string[] {
    return mints.filter(m => !this.cache.has(m));
  }

  /**
   * Get cached TokenInfo by full mint address, or null if not cached
   */
  getTokenInfo(mint: string): TokenInfo | null {
    return this.cache.get(mint) ?? null;
  }
}
