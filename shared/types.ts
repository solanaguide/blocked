// Shared types between server and client

export interface TradeMessage {
  s: number;           // slot
  t: number;           // timestamp (ms)
  sig: string;         // signature (first 8 chars)
  ta: string;          // token_a mint
  tb: string;          // token_b mint
  aa: string;          // token_a amount
  ab: string;          // token_b amount
  vu: number;          // volume USD
  p: string;           // program_id
  pp?: string;         // parent_program_id
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
 * Rich block data from block:update Redis channel
 * Provides comprehensive metrics for Volume (economic activity) and Revenue (network PMF)
 */
export interface BlockMessage {
  type: 'block';

  // Core block info
  slot: number;
  parentSlot: number;
  blockhash: string;
  blockTime: number;
  epoch: number;
  leader: string;

  // Transaction counts
  txns: number;              // total transactions
  votes: number;             // validator vote transactions
  completed: number;         // completed non-vote (from 'success')
  reverted: number;          // reverted non-vote (from 'failed')

  // Compute Units
  cu: number;                // total CU used
  completedCu: number;       // CU by completed txns
  revertedCu: number;        // CU by reverted txns
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
  swapVolumeUsd: number;     // Already divided by 1e12 for USD
  uniqueTraders: number;
  uniquePools: number;
  uniqueTokens: number;

  // Transfers (VOLUME - economic activity)
  transferTxns: number;
  transferCount: number;
  transferVolumeUsd: number; // Already divided by 1e12 for USD

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

export type WSMessage = BatchMessage | StatsMessage | BlockCompleteMessage | BlockMessage;
