// Shared types between server and client

export interface TradeMessage {
  s: number;           // slot
  t: number;           // timestamp (ms)
  idx: number;         // trade index within block (for /go/:slot/:idx links)
  ta: string;          // token_a mint
  tb: string;          // token_b mint
  vu: number;          // volume USD
  p: string;           // program_id
}

export interface StatsMessage {
  type: 'stats';
  slot: number;
  blockProgress: number;  // 0-1, how far through current block
  window: {
    trades: number;  // Total trades in 60s window (for charts)
    volume: number;  // Total volume in 60s window (for charts)
    tokens: Set<string>;
    programs: Record<string, number>;  // Last block only (for leaderboard)
    tokenVolumes: Record<string, number>;  // Last block only (for leaderboard)
    topTrade?: TradeMessage;
  };
  lastBlock: {
    slot: number;
    trades: number;
    volume: number;
    programs: Record<string, number>;
    tokenVolumes: Record<string, number>;
  };
}

export interface BatchMessage {
  type: 'trades';
  batch: TradeMessage[];
  currentSlot: number;
  blockProgress: number;
}

export interface BlockCompleteMessage {
  type: 'block_complete';
  slot: number;
  trades: number;
  volume: number;
  timestamp: number;
}

/**
 * Block scalar fields shared between wire and client formats
 */
export interface BlockFields {
  type: 'block';

  // Core block info
  slot: number;
  blockTime: number;
  epoch: number;
  leader: string;

  // Transaction counts
  txns: number;
  votes: number;
  completed: number;
  reverted: number;

  // Compute Units
  cu: number;
  completedCu: number;
  revertedCu: number;
  avgCu: number;
  medianCu: number;

  // Fees (lamports)
  allFees: number;
  baseFees: number;
  priorityFees: number;
  rewards: number;
  avgFee: number;
  medianFee: number;
  feesPerVolumeBps: number;

  // Jito MEV
  jitoTxns: number;
  jitoTotal: number;
  jitoAvgTip: number;
  jitoMedianTip: number;
  jitoCu: number;

  // Priority fees
  priorityTxns: number;
  priorityAvg: number;
  priorityMedian: number;
  priorityMin: number;
  priorityMax: number;
  dualTipTxns: number;

  // Swaps (VOLUME - economic activity)
  swapTxns: number;
  swapCount: number;
  swapVolumeUsd: number;
  uniqueTraders: number;
  uniquePools: number;
  uniqueTokens: number;

  // Transfers (VOLUME - economic activity)
  transferTxns: number;
  transferCount: number;
  transferVolumeUsd: number;

  // Accounts
  uniqueAccounts: number;
  uniqueWritable: number;
  uniquePrograms: number;
  uniqueSigners: number;

  // Instructions
  totalInstructions: number;
  totalInnerInstructions: number;
  avgCpiDepth: number;
}

// --- Wire (compact) format sent by server ---

export interface WireTokenEntry {
  m: string;    // full mint address (base58)
  s?: string;   // $SYMBOL (if resolved)
  l?: string;   // logo URL
}

export interface WireProgramEntry {
  id: string;   // full program address (base58)
  n: string;    // display name
}

export interface CompactTrade {
  ta: number;   // index into tokenDex
  tb: number;   // index into tokenDex
  p: number;    // index into programDex
  vu: number;   // volume USD
  dt: number;   // timestamp delta (ms offset from blockTime)
}

export interface WireBlockMessage extends BlockFields {
  tokenDex: WireTokenEntry[];
  programDex: WireProgramEntry[];
  trades: CompactTrade[];
}

// --- Client-side (expanded) format ---

/**
 * Rich block data - what client code consumes after decompression
 */
export interface BlockMessage extends BlockFields {
  trades?: TradeMessage[];
  tokenNames?: Record<string, string>;    // full mint → $SYMBOL
  tokenImages?: Record<string, string>;   // $SYMBOL → logo URL
  programNames?: Record<string, string>;  // full program address → display name
}

export type WSMessage = BatchMessage | StatsMessage | BlockCompleteMessage | BlockMessage | AggregatedBlockFields;

// --- Time-based aggregation ---

export type AggregationInterval = '1s' | '5s' | '60s' | '5m';

export const VALID_INTERVALS: AggregationInterval[] = ['1s', '5s', '60s', '5m'];

/**
 * Aggregated block data rolled up over a time window.
 * Sent via WebSocket on interval completion and available via REST API.
 *
 * Aggregation strategies:
 *  - Sum: additive totals (txns, fees, volumes, counts)
 *  - Weighted avg: weighted by per-block txn count (avgCu, avgFee, etc.)
 *  - Max: peak value across blocks (priorityMax, unique* counts)
 *  - Min: floor value across blocks (priorityMin)
 *  - Latest: most recent block's value (slot, epoch, leader)
 */
export interface AggregatedBlockFields {
  type: 'aggregated';
  interval: AggregationInterval;
  bucketStart: number;      // Unix timestamp (seconds) of bucket start
  bucketEnd: number;        // Unix timestamp (seconds) of bucket end
  blockCount: number;       // How many blocks fell into this bucket
  isPartial: boolean;       // True if bucket is still accumulating

  // --- Latest (most recent block) ---
  slot: number;
  blockTime: number;
  epoch: number;
  leader: string;

  // --- Summed ---
  txns: number;
  votes: number;
  completed: number;
  reverted: number;
  cu: number;
  completedCu: number;
  revertedCu: number;
  allFees: number;
  baseFees: number;
  priorityFees: number;
  rewards: number;
  jitoTxns: number;
  jitoTotal: number;
  jitoCu: number;
  priorityTxns: number;
  dualTipTxns: number;
  swapTxns: number;
  swapCount: number;
  swapVolumeUsd: number;
  transferTxns: number;
  transferCount: number;
  transferVolumeUsd: number;
  totalInstructions: number;
  totalInnerInstructions: number;

  // --- Weighted average (by txn count) ---
  avgCu: number;
  medianCu: number;
  avgFee: number;
  medianFee: number;
  jitoAvgTip: number;
  jitoMedianTip: number;
  priorityAvg: number;
  priorityMedian: number;
  avgCpiDepth: number;
  feesPerVolumeBps: number;

  // --- Max ---
  priorityMax: number;
  uniqueTraders: number;
  uniquePools: number;
  uniqueTokens: number;
  uniqueAccounts: number;
  uniqueWritable: number;
  uniquePrograms: number;
  uniqueSigners: number;

  // --- Min ---
  priorityMin: number;

  // --- Leaderboards (top 10 by volume within this bucket) ---
  topPrograms: Array<{ id: string; volume: number; trades: number }>;
  topTokens: Array<{ id: string; volume: number; trades: number }>;
}
