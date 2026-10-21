import type { Block } from './feed';
import fallback from './tokenized-assets.json';

/**
 * Tokenized real-world assets (stocks + RWAs) as categorised on
 * solanacompass.com. A bundled snapshot is used immediately; a fresh list is
 * fetched at runtime when an endpoint is available.
 */
type Kind = 'stocks' | 'etfs' | 'commodities' | 'rwas';
export interface Asset { mint: string; symbol: string; name?: string; kind: Kind }

const assets = new Map<string, Asset>();

function ingest(d: Partial<Record<Kind, Omit<Asset, 'kind'>[]>>) {
  for (const kind of ['stocks', 'etfs', 'commodities', 'rwas'] as const) {
    for (const a of d[kind] ?? []) if (a?.mint) assets.set(a.mint, { ...a, kind });
  }
}
ingest(fallback as any);

// solanacompass.com's raw `rwa` category currently mixes in DePIN and other
// crypto tokens, so the bundled list carries a curated RWA subset. Flip this
// once the category clean-up is deployed to take RWAs live as well.
const LIVE_RWA = false;
const API = 'https://solanacompass.com/api/tokens/list';

/** Refresh from the live category lists (CORS-open, paged 100 per page) */
export async function loadTokenizedAssets() {
  const cats: [string, Kind][] = [['stocks', 'stocks'], ['etfs', 'etfs'], ['commodities', 'commodities']];
  if (LIVE_RWA) cats.push(['rwa', 'rwas']);
  for (const [slug, kind] of cats) {
    try {
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(`${API}?category=${slug}&page=${page}`).then((x) => x.json());
        const rows: any[] = r.tokens ?? [];
        const found: Omit<Asset, 'kind'>[] = [];
        // Stock-like rows group variants (xStocks, Ondo, …) under one asset
        for (const row of rows) for (const t of [row, ...(row.variants ?? [])]) if (t?.mint) found.push({ mint: t.mint, symbol: t.symbol, name: t.name });
        ingest({ [kind]: found });
        if (!rows.length || page * (r.per_page ?? 100) >= (r.total ?? 0)) break;
      }
    } catch { /* keep the bundled snapshot */ }
  }
}

export function tokenizedAsset(mint: string) {
  return assets.get(mint);
}

export function tokenizedCount() {
  return assets.size;
}

/** A view of the block with only tokenized-asset trades; network-level fields stay as-is */
export function filterTokenized(b: Block): Block {
  const kept = b.trades.filter((t) => assets.has(t.tokenMint));
  const n = kept.length;
  const trades = kept.map((t, i) => ({ ...t, order: n > 1 ? i / (n - 1) : 0.5 }));
  return { ...b, trades, swapUsd: trades.reduce((s, t) => s + t.usd, 0) };
}

/** Drop trades the indexer flags as wash or bot-like */
export function filterOrganic(b: Block): Block {
  const kept = b.trades.filter((t) => t.quality === 0);
  const n = kept.length;
  const trades = kept.map((t, i) => ({ ...t, order: n > 1 ? i / (n - 1) : 0.5 }));
  return { ...b, trades, swapUsd: trades.reduce((s, t) => s + t.usd, 0) };
}
