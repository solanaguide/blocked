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
    trades: number;
    volume: number;
    tokens: Set<string>;
    programs: Record<string, number>;
    topTrade?: TradeMessage;
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

export type WSMessage = BatchMessage | StatsMessage | BlockCompleteMessage;
