import type { BlockFields, AggregationInterval, AggregatedBlockFields } from '../shared/types.js';

// Trade summary passed alongside each block for leaderboard accumulation
export interface TradeSummary {
  program: string;   // full program address
  tokenA: string;    // full mint address
  volume: number;    // USD volume
}

interface IntervalConfig {
  interval: AggregationInterval;
  durationMs: number;
  maxBuckets: number;  // 1 hour of history
}

const INTERVALS: IntervalConfig[] = [
  { interval: '1s',  durationMs: 1_000,   maxBuckets: 3_600 },
  { interval: '5s',  durationMs: 5_000,   maxBuckets: 720 },
  { interval: '60s', durationMs: 60_000,  maxBuckets: 60 },
  { interval: '5m',  durationMs: 300_000, maxBuckets: 12 },
];

// Fields summed across blocks in a bucket
const SUM_FIELDS = [
  'txns', 'votes', 'completed', 'reverted',
  'cu', 'completedCu', 'revertedCu',
  'allFees', 'baseFees', 'priorityFees', 'rewards',
  'jitoTxns', 'jitoTotal', 'jitoCu',
  'priorityTxns', 'dualTipTxns',
  'swapTxns', 'swapCount', 'swapVolumeUsd',
  'transferTxns', 'transferCount', 'transferVolumeUsd',
  'totalInstructions', 'totalInnerInstructions',
] as const;

// Fields averaged, weighted by block txn count
const WEIGHTED_AVG_FIELDS = [
  'avgCu', 'medianCu', 'avgFee', 'medianFee',
  'jitoAvgTip', 'jitoMedianTip',
  'priorityAvg', 'priorityMedian',
  'avgCpiDepth', 'feesPerVolumeBps',
] as const;

// Fields where we take the max across blocks
const MAX_FIELDS = [
  'priorityMax',
  'uniqueTraders', 'uniquePools', 'uniqueTokens',
  'uniqueAccounts', 'uniqueWritable', 'uniquePrograms', 'uniqueSigners',
] as const;

// Fields where we take the min across blocks
const MIN_FIELDS = [
  'priorityMin',
] as const;

interface BucketAccumulator {
  startTime: number;          // wall-clock ms when bucket started
  blockCount: number;
  totalTxns: number;          // running sum of txns (weight for averages)

  sums: Record<string, number>;
  weightedSums: Record<string, number>;  // value * block.txns per field
  maxes: Record<string, number>;
  mins: Record<string, number>;

  latestBlock: BlockFields | null;

  // Leaderboard accumulators
  programVolumes: Map<string, { volume: number; trades: number }>;
  tokenVolumes: Map<string, { volume: number; trades: number }>;
}

interface IntervalTrack {
  config: IntervalConfig;
  current: BucketAccumulator | null;
  history: (AggregatedBlockFields | null)[];  // ring buffer
  writeIndex: number;
  count: number;                               // valid entries (up to maxBuckets)
  timer: ReturnType<typeof setTimeout> | null;
}

type EmitCallback = (interval: AggregationInterval, data: AggregatedBlockFields) => void;

export class TimeAggregator {
  private tracks = new Map<AggregationInterval, IntervalTrack>();
  private emitCb: EmitCallback | null = null;

  constructor() {
    for (const config of INTERVALS) {
      this.tracks.set(config.interval, {
        config,
        current: null,
        history: new Array(config.maxBuckets).fill(null),
        writeIndex: 0,
        count: 0,
        timer: null,
      });
    }
  }

  onBucketComplete(cb: EmitCallback): void {
    this.emitCb = cb;
  }

  /** Feed a block + its trade summaries into all interval buckets */
  ingestBlock(block: BlockFields, trades: TradeSummary[]): void {
    for (const track of this.tracks.values()) {
      if (!track.current) {
        track.current = this.createBucket();
      }
      this.accumulate(track.current, block, trades);
    }
  }

  /** Get the current partial bucket for REST (or null if no data yet) */
  getLatestSnapshot(interval: AggregationInterval): AggregatedBlockFields | null {
    const track = this.tracks.get(interval);
    if (!track?.current || track.current.blockCount === 0) return null;
    return this.finalize(track.current, track.config, true);
  }

  /** Get completed bucket history, newest first */
  getHistory(interval: AggregationInterval, limit?: number): AggregatedBlockFields[] {
    const track = this.tracks.get(interval);
    if (!track || track.count === 0) return [];

    const result: AggregatedBlockFields[] = [];
    const max = limit ? Math.min(limit, track.count) : track.count;

    // Read backwards from most recently written
    let idx = (track.writeIndex - 1 + track.config.maxBuckets) % track.config.maxBuckets;
    for (let i = 0; i < max; i++) {
      const bucket = track.history[idx];
      if (bucket) result.push(bucket);
      idx = (idx - 1 + track.config.maxBuckets) % track.config.maxBuckets;
    }

    return result;
  }

  /** Start wall-clock-aligned interval timers */
  start(): void {
    for (const track of this.tracks.values()) {
      this.scheduleNextTick(track);
    }
    console.log('TimeAggregator started — intervals: 1s, 5s, 60s, 5m');
  }

  /** Stop all timers */
  stop(): void {
    for (const track of this.tracks.values()) {
      if (track.timer) {
        clearTimeout(track.timer);
        track.timer = null;
      }
    }
  }

  private scheduleNextTick(track: IntervalTrack): void {
    const now = Date.now();
    const dur = track.config.durationMs;
    const nextBoundary = Math.ceil(now / dur) * dur;
    const delay = nextBoundary - now;

    track.timer = setTimeout(() => {
      this.tick(track);
      // Continue with setInterval, but re-align every 100 ticks to prevent drift
      let tickCount = 0;
      const intervalId = setInterval(() => {
        this.tick(track);
        tickCount++;
        if (tickCount >= 100) {
          clearInterval(intervalId);
          this.scheduleNextTick(track);
        }
      }, dur);

      // Store interval for cleanup (overwrite timer ref)
      track.timer = intervalId as unknown as ReturnType<typeof setTimeout>;
    }, delay);
  }

  private tick(track: IntervalTrack): void {
    const bucket = track.current;
    if (bucket && bucket.blockCount > 0) {
      const snapshot = this.finalize(bucket, track.config, false);

      // Write to ring buffer
      track.history[track.writeIndex] = snapshot;
      track.writeIndex = (track.writeIndex + 1) % track.config.maxBuckets;
      if (track.count < track.config.maxBuckets) track.count++;

      // Emit to subscribers
      this.emitCb?.(track.config.interval, snapshot);
    }

    // Reset bucket for next period
    track.current = this.createBucket();
  }

  private createBucket(): BucketAccumulator {
    const sums: Record<string, number> = {};
    const weightedSums: Record<string, number> = {};
    const maxes: Record<string, number> = {};
    const mins: Record<string, number> = {};

    for (const f of SUM_FIELDS) sums[f] = 0;
    for (const f of WEIGHTED_AVG_FIELDS) weightedSums[f] = 0;
    for (const f of MAX_FIELDS) maxes[f] = -Infinity;
    for (const f of MIN_FIELDS) mins[f] = Infinity;

    return {
      startTime: Date.now(),
      blockCount: 0,
      totalTxns: 0,
      sums,
      weightedSums,
      maxes,
      mins,
      latestBlock: null,
      programVolumes: new Map(),
      tokenVolumes: new Map(),
    };
  }

  private accumulate(bucket: BucketAccumulator, block: BlockFields, trades: TradeSummary[]): void {
    bucket.blockCount++;
    bucket.latestBlock = block;

    const weight = block.txns || 1; // avoid division by zero
    bucket.totalTxns += weight;

    // Sum fields
    for (const f of SUM_FIELDS) {
      bucket.sums[f] += (block as any)[f] ?? 0;
    }

    // Weighted average fields
    for (const f of WEIGHTED_AVG_FIELDS) {
      bucket.weightedSums[f] += ((block as any)[f] ?? 0) * weight;
    }

    // Max fields
    for (const f of MAX_FIELDS) {
      const val = (block as any)[f] ?? 0;
      if (val > bucket.maxes[f]) bucket.maxes[f] = val;
    }

    // Min fields
    for (const f of MIN_FIELDS) {
      const val = (block as any)[f] ?? 0;
      if (val < bucket.mins[f]) bucket.mins[f] = val;
    }

    // Accumulate trade leaderboards
    for (const trade of trades) {
      const vol = trade.volume || 0; // guard NaN/undefined

      // Program
      const prog = bucket.programVolumes.get(trade.program);
      if (prog) {
        prog.volume += vol;
        prog.trades++;
      } else {
        bucket.programVolumes.set(trade.program, { volume: vol, trades: 1 });
      }

      // Token (count token A — the primary side)
      const tok = bucket.tokenVolumes.get(trade.tokenA);
      if (tok) {
        tok.volume += vol;
        tok.trades++;
      } else {
        bucket.tokenVolumes.set(trade.tokenA, { volume: vol, trades: 1 });
      }
    }
  }

  private finalize(
    bucket: BucketAccumulator,
    config: IntervalConfig,
    isPartial: boolean,
  ): AggregatedBlockFields {
    const latest = bucket.latestBlock!;
    const totalTxns = bucket.totalTxns || 1; // avoid division by zero

    // Compute weighted averages
    const weightedAvgs: Record<string, number> = {};
    for (const f of WEIGHTED_AVG_FIELDS) {
      weightedAvgs[f] = bucket.weightedSums[f] / totalTxns;
    }

    // Clamp max/min for empty buckets
    const maxes: Record<string, number> = {};
    for (const f of MAX_FIELDS) {
      maxes[f] = bucket.maxes[f] === -Infinity ? 0 : bucket.maxes[f];
    }
    const mins: Record<string, number> = {};
    for (const f of MIN_FIELDS) {
      mins[f] = bucket.mins[f] === Infinity ? 0 : bucket.mins[f];
    }

    // Build top 10 leaderboards sorted by volume
    const topPrograms = Array.from(bucket.programVolumes.entries())
      .map(([id, d]) => ({ id, volume: d.volume, trades: d.trades }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);

    const topTokens = Array.from(bucket.tokenVolumes.entries())
      .map(([id, d]) => ({ id, volume: d.volume, trades: d.trades }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);

    // Bucket time boundaries (seconds)
    const bucketStartSec = Math.floor(bucket.startTime / 1000);
    const bucketEndSec = isPartial
      ? Math.floor(Date.now() / 1000)
      : bucketStartSec + Math.floor(config.durationMs / 1000);

    return {
      type: 'aggregated',
      interval: config.interval,
      bucketStart: bucketStartSec,
      bucketEnd: bucketEndSec,
      blockCount: bucket.blockCount,
      isPartial,

      // Latest
      slot: latest.slot,
      blockTime: latest.blockTime,
      epoch: latest.epoch,
      leader: latest.leader,

      // Sums
      txns: bucket.sums['txns'],
      votes: bucket.sums['votes'],
      completed: bucket.sums['completed'],
      reverted: bucket.sums['reverted'],
      cu: bucket.sums['cu'],
      completedCu: bucket.sums['completedCu'],
      revertedCu: bucket.sums['revertedCu'],
      allFees: bucket.sums['allFees'],
      baseFees: bucket.sums['baseFees'],
      priorityFees: bucket.sums['priorityFees'],
      rewards: bucket.sums['rewards'],
      jitoTxns: bucket.sums['jitoTxns'],
      jitoTotal: bucket.sums['jitoTotal'],
      jitoCu: bucket.sums['jitoCu'],
      priorityTxns: bucket.sums['priorityTxns'],
      dualTipTxns: bucket.sums['dualTipTxns'],
      swapTxns: bucket.sums['swapTxns'],
      swapCount: bucket.sums['swapCount'],
      swapVolumeUsd: bucket.sums['swapVolumeUsd'],
      transferTxns: bucket.sums['transferTxns'],
      transferCount: bucket.sums['transferCount'],
      transferVolumeUsd: bucket.sums['transferVolumeUsd'],
      totalInstructions: bucket.sums['totalInstructions'],
      totalInnerInstructions: bucket.sums['totalInnerInstructions'],

      // Weighted averages
      avgCu: weightedAvgs['avgCu'],
      medianCu: weightedAvgs['medianCu'],
      avgFee: weightedAvgs['avgFee'],
      medianFee: weightedAvgs['medianFee'],
      jitoAvgTip: weightedAvgs['jitoAvgTip'],
      jitoMedianTip: weightedAvgs['jitoMedianTip'],
      priorityAvg: weightedAvgs['priorityAvg'],
      priorityMedian: weightedAvgs['priorityMedian'],
      avgCpiDepth: weightedAvgs['avgCpiDepth'],
      feesPerVolumeBps: weightedAvgs['feesPerVolumeBps'],

      // Max
      priorityMax: maxes['priorityMax'],
      uniqueTraders: maxes['uniqueTraders'],
      uniquePools: maxes['uniquePools'],
      uniqueTokens: maxes['uniqueTokens'],
      uniqueAccounts: maxes['uniqueAccounts'],
      uniqueWritable: maxes['uniqueWritable'],
      uniquePrograms: maxes['uniquePrograms'],
      uniqueSigners: maxes['uniqueSigners'],

      // Min
      priorityMin: mins['priorityMin'],

      // Leaderboards
      topPrograms,
      topTokens,
    };
  }
}
