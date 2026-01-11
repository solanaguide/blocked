import * as d3 from 'd3';
import { programColors, tokenColors, hashColor, colorToHex } from '../utils/colors';
import type { BlockMessage } from '../../../shared/types';

export class HUD {
  private volumeHistory: { time: number; volume: number }[] = [];
  private spsHistory: { time: number; sps: number }[] = [];
  private maxHistoryLength = 60; // 60 seconds

  private blockVolumeHistory: { slot: number; volume: number }[] = [];
  private blockSwapsHistory: { slot: number; swaps: number }[] = [];
  private chartMode: 'persecond' | 'perblock' = 'persecond';

  // Rich block data for stacked charts (Volume & Revenue)
  private blockDataHistory: {
    slot: number;
    swapVolume: number;
    transferVolume: number;
    baseFees: number;
    priorityFees: number;
    jitoTips: number;
    votes: number;
    completed: number;
    reverted: number;
  }[] = [];
  private maxBlockDataHistory = 60; // Last 60 blocks

  private programStats: Map<string, number> = new Map();
  private tokenStats: Map<string, number> = new Map();

  constructor() {
    this.setupCharts();
  }

  private setupCharts() {
    // Volume chart
    const volumeChart = d3.select('#volume-chart');
    const spsChart = d3.select('#sps-chart');

    // Initial empty state
    this.updateVolumeChart();
    this.updateSPSChart();
  }

  updateBlockProgress(progress: number) {
    const fill = document.getElementById('progress-fill');
    if (fill) {
      fill.style.width = `${progress * 100}%`;
    }
  }

  updateCurrentSlot(slot: number) {
    const elem = document.getElementById('current-slot');
    if (elem) elem.textContent = slot.toString();

    const blockSlot = document.getElementById('block-slot');
    if (blockSlot) blockSlot.textContent = slot.toString();
  }

  updateBlockStats(slot: number, trades: number, volume: number) {
    const slotElem = document.getElementById('block-slot');
    if (slotElem) slotElem.textContent = slot.toString();

    const tradesElem = document.getElementById('block-trades');
    if (tradesElem) tradesElem.textContent = trades.toString();

    const volumeElem = document.getElementById('block-volume');
    if (volumeElem) volumeElem.textContent = `$${this.formatNumber(volume)}`;

    const avgElem = document.getElementById('block-avg');
    if (avgElem) {
      const avg = trades > 0 ? volume / trades : 0;
      avgElem.textContent = `$${this.formatNumber(avg)}`;
    }
  }

  addChartDataPoint(swaps: number, volume: number) {
    // Add per-second data point to history
    const now = Date.now();
    this.volumeHistory.push({ time: now, volume });
    this.spsHistory.push({ time: now, sps: swaps });

    // Trim history to 60 seconds
    const cutoff = now - 60000;
    this.volumeHistory = this.volumeHistory.filter(d => d.time > cutoff);
    this.spsHistory = this.spsHistory.filter(d => d.time > cutoff);

    // Update charts
    this.updateVolumeChart();
    this.updateSPSChart();
  }

  updateSPS(sps: number) {
    const elem = document.getElementById('sps');
    if (elem) elem.textContent = sps.toFixed(1);
  }

  updateMode(mode: string) {
    const elem = document.getElementById('mode');
    if (elem) elem.textContent = mode.toUpperCase();
  }

  updateProgramStats(programs: Record<string, number>, title?: string) {
    this.programStats.clear();
    let total = 0;

    for (const [program, count] of Object.entries(programs)) {
      this.programStats.set(program, count);
      total += count;
    }

    // Sort by count
    const sorted = Array.from(this.programStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Update title if provided
    if (title) {
      const titleElem = document.getElementById('programs-title');
      if (titleElem) titleElem.textContent = title;
    }

    // Render leaderboard
    const container = document.getElementById('programs-leaderboard');
    if (!container) return;

    container.innerHTML = '';

    for (const [program, count] of sorted) {
      const percent = total > 0 ? (count / total) * 100 : 0;
      const color = programColors.get(program) || 0xffffff;
      const hexColor = colorToHex(color);

      const item = document.createElement('div');
      item.className = 'leaderboard-item';

      item.innerHTML = `
        <div class="leaderboard-name">
          <span class="color-dot" style="background-color: ${hexColor};"></span>
          ${this.formatProgramName(program)}
        </div>
        <div class="leaderboard-value">${percent.toFixed(1)}%</div>
        <div class="leaderboard-bar">
          <div class="leaderboard-bar-fill" style="width: ${percent}%; background-color: ${hexColor};"></div>
        </div>
      `;

      container.appendChild(item);
    }
  }

  updateTokenStats(tokens: Record<string, number>, title?: string) {
    this.tokenStats.clear();
    let total = 0;

    for (const [token, volume] of Object.entries(tokens)) {
      this.tokenStats.set(token, volume);
      total += volume;
    }

    // Sort by volume
    const sorted = Array.from(this.tokenStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Update title if provided
    if (title) {
      const titleElem = document.getElementById('tokens-title');
      if (titleElem) titleElem.textContent = title;
    }

    // Render leaderboard
    const container = document.getElementById('tokens-leaderboard');
    if (!container) return;

    container.innerHTML = '';

    for (const [token, volume] of sorted) {
      const percent = total > 0 ? (volume / total) * 100 : 0;
      const color = tokenColors.get(token) || hashColor(token);
      const hexColor = colorToHex(color);

      const item = document.createElement('div');
      item.className = 'leaderboard-item';

      item.innerHTML = `
        <div class="leaderboard-name">
          <span class="color-dot" style="background-color: ${hexColor};"></span>
          ${token}
        </div>
        <div class="leaderboard-value">$${this.formatNumber(volume)}</div>
        <div class="leaderboard-bar">
          <div class="leaderboard-bar-fill" style="width: ${percent}%; background-color: ${hexColor};"></div>
        </div>
      `;

      container.appendChild(item);
    }
  }

  private updateVolumeChart() {
    const svg = d3.select('#volume-chart');
    svg.selectAll('*').remove();

    if (this.chartMode === 'perblock') {
      if (this.blockVolumeHistory.length === 0) return;
      this.renderBlockVolumeChart(svg);
    } else {
      if (this.volumeHistory.length === 0) return;
      this.renderPerSecondVolumeChart(svg);
    }
  }

  private renderPerSecondVolumeChart(svg: d3.Selection<d3.BaseType, unknown, HTMLElement, any>) {
    const width = 420;
    const height = 110;
    const margin = { top: 5, right: 40, bottom: 15, left: 5 };

    const maxVolume = d3.max(this.volumeHistory, d => d.volume) || 1;

    const x = d3.scaleTime()
      .domain(d3.extent(this.volumeHistory, d => d.time) as [number, number])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, maxVolume])
      .range([height - margin.bottom, margin.top]);

    const line = d3.line<{ time: number; volume: number }>()
      .x(d => x(d.time))
      .y(d => y(d.volume))
      .curve(d3.curveMonotoneX);

    const area = d3.area<{ time: number; volume: number }>()
      .x(d => x(d.time))
      .y0(height - margin.bottom)
      .y1(d => y(d.volume))
      .curve(d3.curveMonotoneX);

    // Draw area
    svg.append('path')
      .datum(this.volumeHistory)
      .attr('fill', 'rgba(139, 92, 246, 0.3)')
      .attr('d', area);

    // Draw line
    svg.append('path')
      .datum(this.volumeHistory)
      .attr('fill', 'none')
      .attr('stroke', '#8b5cf6')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Add max value label
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 10)
      .attr('fill', '#8b5cf6')
      .attr('font-size', '10px')
      .text(`$${this.formatNumber(maxVolume)}`);
  }

  private renderBlockVolumeChart(svg: d3.Selection<d3.BaseType, unknown, HTMLElement, any>) {
    const width = 420;
    const height = 110;
    const margin = { top: 5, right: 50, bottom: 15, left: 5 };

    // Use rich block data if available, fall back to simple history
    if (this.blockDataHistory.length > 0) {
      this.renderStackedVolumeChart(svg, width, height, margin);
      return;
    }

    // Fallback to simple volume chart
    const maxVolume = d3.max(this.blockVolumeHistory, d => d.volume) || 1;

    const x = d3.scaleLinear()
      .domain([0, this.blockVolumeHistory.length])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, maxVolume])
      .range([height - margin.bottom, margin.top]);

    // Draw bars (flame chart style)
    const barWidth = (width - margin.left - margin.right) / Math.max(this.blockVolumeHistory.length, 1);

    this.blockVolumeHistory.forEach((d, i) => {
      svg.append('rect')
        .attr('x', x(i))
        .attr('y', y(d.volume))
        .attr('width', Math.max(barWidth - 1, 1))
        .attr('height', height - margin.bottom - y(d.volume))
        .attr('fill', '#8b5cf6')
        .attr('opacity', 0.7);
    });

    // Add max value label
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 10)
      .attr('fill', '#8b5cf6')
      .attr('font-size', '10px')
      .text(`$${this.formatNumber(maxVolume)}`);
  }

  /**
   * Render stacked area chart for Volume (Swap + Transfer)
   */
  private renderStackedVolumeChart(
    svg: d3.Selection<d3.BaseType, unknown, HTMLElement, any>,
    width: number,
    height: number,
    margin: { top: number; right: number; bottom: number; left: number }
  ) {
    const data = this.blockDataHistory;

    // Calculate max stacked value
    const maxVolume = d3.max(data, d => d.swapVolume + d.transferVolume) || 1;

    const x = d3.scaleLinear()
      .domain([0, data.length])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, maxVolume])
      .range([height - margin.bottom, margin.top]);

    // Create stack generator
    const stack = d3.stack<typeof data[0]>()
      .keys(['swapVolume', 'transferVolume']);

    const stackedData = stack(data);

    // Colors: Cyan for swap, Teal for transfer
    const colors = ['#00CED1', '#20B2AA'];

    // Draw stacked areas
    const area = d3.area<d3.SeriesPoint<typeof data[0]>>()
      .x((d, i) => x(i))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    stackedData.forEach((layer, i) => {
      svg.append('path')
        .datum(layer)
        .attr('fill', colors[i])
        .attr('opacity', 0.7)
        .attr('d', area);
    });

    // Add legend
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 10)
      .attr('fill', '#00CED1')
      .attr('font-size', '9px')
      .text('Swap');

    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 22)
      .attr('fill', '#20B2AA')
      .attr('font-size', '9px')
      .text('Transfer');

    // Add max value label
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 40)
      .attr('fill', '#fff')
      .attr('font-size', '10px')
      .text(`$${this.formatNumber(maxVolume)}`);
  }

  private updateSPSChart() {
    const svg = d3.select('#sps-chart');
    svg.selectAll('*').remove();

    if (this.chartMode === 'perblock') {
      if (this.blockSwapsHistory.length === 0) return;
      this.renderBlockSPSChart(svg);
    } else {
      if (this.spsHistory.length === 0) return;
      this.renderPerSecondSPSChart(svg);
    }
  }

  private renderPerSecondSPSChart(svg: d3.Selection<d3.BaseType, unknown, HTMLElement, any>) {
    const width = 420;
    const height = 110;
    const margin = { top: 5, right: 40, bottom: 15, left: 5 };

    const maxSPS = d3.max(this.spsHistory, d => d.sps) || 1;

    const x = d3.scaleTime()
      .domain(d3.extent(this.spsHistory, d => d.time) as [number, number])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, maxSPS])
      .range([height - margin.bottom, margin.top]);

    const line = d3.line<{ time: number; sps: number }>()
      .x(d => x(d.time))
      .y(d => y(d.sps))
      .curve(d3.curveMonotoneX);

    const area = d3.area<{ time: number; sps: number }>()
      .x(d => x(d.time))
      .y0(height - margin.bottom)
      .y1(d => y(d.sps))
      .curve(d3.curveMonotoneX);

    // Draw area
    svg.append('path')
      .datum(this.spsHistory)
      .attr('fill', 'rgba(6, 255, 165, 0.3)')
      .attr('d', area);

    // Draw line
    svg.append('path')
      .datum(this.spsHistory)
      .attr('fill', 'none')
      .attr('stroke', '#06ffa5')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Add max value label
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 10)
      .attr('fill', '#06ffa5')
      .attr('font-size', '10px')
      .text(maxSPS.toFixed(0));
  }

  private renderBlockSPSChart(svg: d3.Selection<d3.BaseType, unknown, HTMLElement, any>) {
    const width = 420;
    const height = 110;
    const margin = { top: 5, right: 50, bottom: 15, left: 5 };

    // Use rich block data for Revenue chart if available
    if (this.blockDataHistory.length > 0) {
      this.renderStackedRevenueChart(svg, width, height, margin);
      return;
    }

    // Fallback to simple swaps chart
    const maxSwaps = d3.max(this.blockSwapsHistory, d => d.swaps) || 1;

    const x = d3.scaleLinear()
      .domain([0, this.blockSwapsHistory.length])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, maxSwaps])
      .range([height - margin.bottom, margin.top]);

    // Draw bars (flame chart style)
    const barWidth = (width - margin.left - margin.right) / Math.max(this.blockSwapsHistory.length, 1);

    this.blockSwapsHistory.forEach((d, i) => {
      svg.append('rect')
        .attr('x', x(i))
        .attr('y', y(d.swaps))
        .attr('width', Math.max(barWidth - 1, 1))
        .attr('height', height - margin.bottom - y(d.swaps))
        .attr('fill', '#06ffa5')
        .attr('opacity', 0.7);
    });

    // Add max value label
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 10)
      .attr('fill', '#06ffa5')
      .attr('font-size', '10px')
      .text(maxSwaps.toFixed(0));
  }

  /**
   * Render stacked area chart for Revenue (Base Fees + Priority Fees + Jito Tips)
   */
  private renderStackedRevenueChart(
    svg: d3.Selection<d3.BaseType, unknown, HTMLElement, any>,
    width: number,
    height: number,
    margin: { top: number; right: number; bottom: number; left: number }
  ) {
    const data = this.blockDataHistory;

    // Calculate max stacked value (total revenue in SOL)
    const maxRevenue = d3.max(data, d => d.baseFees + d.priorityFees + d.jitoTips) || 0.001;

    const x = d3.scaleLinear()
      .domain([0, data.length])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, maxRevenue])
      .range([height - margin.bottom, margin.top]);

    // Create stack generator
    const stack = d3.stack<typeof data[0]>()
      .keys(['baseFees', 'priorityFees', 'jitoTips']);

    const stackedData = stack(data);

    // Colors: Grey for base, Blue/Cyan for priority, Orange for Jito
    const colors = ['#666666', '#00CED1', '#FF8C00'];

    // Draw stacked areas
    const area = d3.area<d3.SeriesPoint<typeof data[0]>>()
      .x((d, i) => x(i))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    stackedData.forEach((layer, i) => {
      svg.append('path')
        .datum(layer)
        .attr('fill', colors[i])
        .attr('opacity', 0.8)
        .attr('d', area);
    });

    // Add legend
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 10)
      .attr('fill', '#666666')
      .attr('font-size', '9px')
      .text('Base');

    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 22)
      .attr('fill', '#00CED1')
      .attr('font-size', '9px')
      .text('Priority');

    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 34)
      .attr('fill', '#FF8C00')
      .attr('font-size', '9px')
      .text('Jito');

    // Add max value label
    svg.append('text')
      .attr('x', width - margin.right + 5)
      .attr('y', margin.top + 52)
      .attr('fill', '#FFD700')
      .attr('font-size', '10px')
      .text(`${maxRevenue.toFixed(4)} SOL`);
  }

  showNotification(message: string, duration = 3000) {
    const container = document.getElementById('notifications');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;

    container.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, duration);
  }

  addBlockLogEntry(slot: number, trades: number, volume: number) {
    const container = document.getElementById('block-log');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = 'block-log-entry';

    const slotStr = slot.toString().padEnd(9);
    const tradesStr = trades.toString().padStart(4);
    const volumeStr = `$${this.formatNumber(volume)}`.padStart(10);

    entry.textContent = `${slotStr} ${tradesStr} ${volumeStr}`;

    // Add at the top
    container.insertBefore(entry, container.firstChild);

    // Keep only last 50 entries
    while (container.children.length > 50) {
      container.removeChild(container.lastChild!);
    }

    // Add to per-block chart history
    this.blockVolumeHistory.push({ slot, volume });
    this.blockSwapsHistory.push({ slot, swaps: trades });

    // Keep last 60 blocks
    if (this.blockVolumeHistory.length > 60) {
      this.blockVolumeHistory.shift();
    }
    if (this.blockSwapsHistory.length > 60) {
      this.blockSwapsHistory.shift();
    }

    // Update charts if in per-block mode
    if (this.chartMode === 'perblock') {
      this.updateVolumeChart();
      this.updateSPSChart();
    }
  }

  setChartMode(mode: 'persecond' | 'perblock') {
    this.chartMode = mode;

    // Update chart titles
    const volumeTitle = document.getElementById('volume-chart-title');
    const revenueTitle = document.getElementById('revenue-chart-title');

    if (mode === 'perblock') {
      if (volumeTitle) volumeTitle.textContent = 'Volume (60 blocks)';
      if (revenueTitle) revenueTitle.textContent = 'Revenue (60 blocks)';
    } else {
      if (volumeTitle) volumeTitle.textContent = 'Volume (60s)';
      if (revenueTitle) revenueTitle.textContent = 'Swaps Per Second';
    }

    this.updateVolumeChart();
    this.updateSPSChart();
  }

  private formatNumber(num: number): string {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  }

  private formatProgramName(program: string): string {
    const names: Record<string, string> = {
      'JUP': 'Jupiter',
      'RAYDIUM_CLMM': 'Raydium CLMM',
      'RAYDIUM_CP': 'Raydium CP',
      'RAYDIUM_CPMM': 'Raydium CPMM',
      'ORCA': 'Orca',
      'PHOENIX': 'Phoenix',
      'LIFINITY': 'Lifinity',
      'FLASH': 'Flash',
    };
    return names[program] || program;
  }

  /**
   * Update HUD with rich block data from block:update stream
   */
  updateBlockData(block: BlockMessage) {
    // Calculate key metrics
    const volumeUsd = block.swapVolumeUsd + block.transferVolumeUsd;
    const revenueSol = (block.allFees + block.jitoTotal) / 1e9;
    const completionRate = block.completed / (block.completed + block.reverted || 1);
    const votePercent = block.votes / block.txns * 100;
    const nonVoteTotal = block.completed + block.reverted;
    const revertPercent = nonVoteTotal > 0 ? (block.reverted / nonVoteTotal * 100) : 0;

    // === TOP KPI BAR ===
    this.setElementText('kpi-volume', `$${this.formatNumber(volumeUsd)}`);
    this.setElementText('kpi-revenue', `${revenueSol.toFixed(4)} SOL`);
    this.setElementText('kpi-tps', Math.round(block.txns / 0.4).toString()); // ~400ms per block
    this.setElementText('kpi-complete', `${(completionRate * 100).toFixed(0)}%`);

    // === BLOCK INFO ===
    this.setElementText('block-slot', block.slot.toString());
    const leaderElem = document.getElementById('block-leader');
    if (leaderElem) {
      leaderElem.textContent = block.leader.substring(0, 8) + '...';
      leaderElem.title = block.leader;
    }
    this.setElementText('block-epoch', block.epoch.toString());

    // === TRANSACTIONS ===
    this.setElementText('block-txns', block.txns.toLocaleString());
    this.setElementText('block-votes', `${block.votes.toLocaleString()} (${votePercent.toFixed(0)}%)`);
    this.setElementText('block-completed', block.completed.toLocaleString());
    this.setElementText('block-reverted', `${block.reverted.toLocaleString()} (${revertPercent.toFixed(0)}%)`);

    // === COMPUTE UNITS ===
    this.setElementText('block-cu', this.formatNumber(block.cu));
    const completedCuPercent = block.cu > 0 ? (block.completedCu / block.cu * 100) : 0;
    const revertedCuPercent = block.cu > 0 ? (block.revertedCu / block.cu * 100) : 0;
    this.setElementText('block-completed-cu', `${this.formatNumber(block.completedCu)} (${completedCuPercent.toFixed(0)}%)`);
    this.setElementText('block-reverted-cu', `${this.formatNumber(block.revertedCu)} (${revertedCuPercent.toFixed(0)}%)`);
    this.setElementText('block-avg-cu', this.formatNumber(block.avgCu));

    // === FEES ===
    this.setElementText('block-fees', `${(block.allFees / 1e9).toFixed(4)} SOL`);
    this.setElementText('block-priority-fees', `${(block.priorityFees / 1e9).toFixed(4)} SOL`);
    this.setElementText('block-rewards', `${(block.rewards / 1e9).toFixed(4)} SOL`);
    this.setElementText('block-avg-fee', `${this.formatNumber(block.avgFee)} lam`);

    // === MEV / JITO ===
    const jitoPercent = nonVoteTotal > 0 ? (block.jitoTxns / nonVoteTotal * 100) : 0;
    this.setElementText('block-jito-txns', `${block.jitoTxns} (${jitoPercent.toFixed(0)}%)`);
    this.setElementText('block-jito-total', `${(block.jitoTotal / 1e9).toFixed(4)} SOL`);
    this.setElementText('block-jito-avg', `${this.formatNumber(block.jitoAvgTip)} lam`);

    // Highlight extreme priority fees
    const maxPrioritySol = block.priorityMax / 1e9;
    const maxPriorityText = maxPrioritySol >= 1
      ? `${maxPrioritySol.toFixed(2)} SOL 🔥`
      : `${this.formatNumber(block.priorityMax)} lam`;
    this.setElementText('block-priority-max', maxPriorityText);

    // === TRADING ACTIVITY ===
    this.setElementText('block-swap-txns', block.swapTxns.toString());
    const swapsPerTx = block.swapTxns > 0 ? (block.swapCount / block.swapTxns).toFixed(1) : '0';
    this.setElementText('block-swap-count', `${block.swapCount} (${swapsPerTx}/tx)`);
    this.setElementText('block-volume', `$${this.formatNumber(block.swapVolumeUsd)}`);
    this.setElementText('block-traders', block.uniqueTraders.toString());
    this.setElementText('block-pools', block.uniquePools.toString());
    this.setElementText('block-tokens', block.uniqueTokens.toString());

    // === TRANSFERS ===
    this.setElementText('block-transfer-txns', block.transferTxns.toString());
    this.setElementText('block-transfer-count', block.transferCount.toString());
    this.setElementText('block-transfer-volume', `$${this.formatNumber(block.transferVolumeUsd)}`);

    // === NETWORK ACTIVITY ===
    this.setElementText('block-accounts', block.uniqueAccounts.toLocaleString());
    this.setElementText('block-programs', block.uniquePrograms.toString());
    this.setElementText('block-signers', block.uniqueSigners.toString());
    this.setElementText('block-instructions', `${block.totalInstructions} (+${block.totalInnerInstructions} inner)`);
    this.setElementText('block-cpi-depth', block.avgCpiDepth.toFixed(2));

    // Add to block log with new format
    this.addBlockLogEntryRich(block.slot, block.txns, block.reverted, volumeUsd, revertPercent);

    // Store block data for stacked charts
    this.blockDataHistory.push({
      slot: block.slot,
      swapVolume: block.swapVolumeUsd,
      transferVolume: block.transferVolumeUsd,
      baseFees: block.baseFees / 1e9, // Convert to SOL
      priorityFees: block.priorityFees / 1e9,
      jitoTips: block.jitoTotal / 1e9,
      votes: block.votes,
      completed: block.completed,
      reverted: block.reverted,
    });

    // Trim to max history
    if (this.blockDataHistory.length > this.maxBlockDataHistory) {
      this.blockDataHistory.shift();
    }

    // Update charts with rich data
    this.updateVolumeChart();
    this.updateSPSChart();
  }

  /**
   * Helper to set element text content
   */
  private setElementText(id: string, text: string) {
    const elem = document.getElementById(id);
    if (elem) elem.textContent = text;
  }

  /**
   * Add rich block log entry with tx counts and revert rate
   */
  private addBlockLogEntryRich(slot: number, txns: number, reverted: number, volume: number, revertPercent: number) {
    const container = document.getElementById('block-log');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = 'block-log-entry';

    // Highlight high revert rate blocks
    if (revertPercent > 30) {
      entry.style.color = '#FFA500'; // Amber for high revert
    }

    const slotStr = slot.toString().slice(-6).padEnd(9);
    const txnsStr = txns.toString().padStart(5);
    const revertStr = reverted.toString().padStart(4);
    const volumeStr = `$${this.formatNumber(volume)}`.padStart(8);

    entry.textContent = `${slotStr}${txnsStr}${revertStr}${volumeStr}`;

    // Add at the top
    container.insertBefore(entry, container.firstChild);

    // Keep only last 50 entries
    while (container.children.length > 50) {
      container.removeChild(container.lastChild!);
    }

    // Add to per-block chart history
    this.blockVolumeHistory.push({ slot, volume });
    this.blockSwapsHistory.push({ slot, swaps: txns });

    // Keep last 60 blocks
    if (this.blockVolumeHistory.length > 60) {
      this.blockVolumeHistory.shift();
    }
    if (this.blockSwapsHistory.length > 60) {
      this.blockSwapsHistory.shift();
    }

    // Update charts if in per-block mode
    if (this.chartMode === 'perblock') {
      this.updateVolumeChart();
      this.updateSPSChart();
    }
  }
}
