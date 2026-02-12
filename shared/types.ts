// Shared types between server and client

export interface TradeMessage {
  s: number;           // slot
  t: number;           // timestamp (ms)
  sig: string;         // transaction signature
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
  parentSlot: number;
  blockhash: string;
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
  m: string;    // shortened mint (e.g. "SOL", "EPjFWdd5")
  s?: string;   // $SYMBOL (if resolved)
  l?: string;   // logo URL
}

export interface CompactTrade {
  ta: number;   // index into tokenDex
  tb: number;   // index into tokenDex
  p: number;    // index into programDex
  vu: number;   // volume USD
  sig: number;  // index into sigDex
  dt: number;   // timestamp delta (ms offset from blockTime)
}

export interface WireBlockMessage extends BlockFields {
  tokenDex: WireTokenEntry[];
  programDex: string[];
  sigDex: string[];
  trades: CompactTrade[];
}

// --- Client-side (expanded) format ---

/**
 * Rich block data - what client code consumes after decompression
 */
export interface BlockMessage extends BlockFields {
  trades?: TradeMessage[];
  tokenNames?: Record<string, string>;
  tokenImages?: Record<string, string>;
}

export type WSMessage = BatchMessage | StatsMessage | BlockCompleteMessage | BlockMessage;
