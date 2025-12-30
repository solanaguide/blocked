import * as d3 from 'd3';

export class HUD {
  private volumeHistory: { time: number; volume: number }[] = [];
  private tpsHistory: { time: number; tps: number }[] = [];
  private maxHistoryLength = 60; // 60 seconds

  private programStats: Map<string, number> = new Map();
  private tokenStats: Map<string, number> = new Map();

  constructor() {
    this.setupCharts();
  }

  private setupCharts() {
    // Volume chart
    const volumeChart = d3.select('#volume-chart');
    const tpsChart = d3.select('#tps-chart');

    // Initial empty state
    this.updateVolumeChart();
    this.updateTPSChart();
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

  updateBlockStats(trades: number, volume: number) {
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

  updateWindowStats(trades: number, volume: number) {
    // Add to history for charts (rolling 60s window)
    const now = Date.now();
    this.volumeHistory.push({ time: now, volume });
    this.tpsHistory.push({ time: now, tps: trades });

    // Trim history to 60 seconds
    const cutoff = now - 60000;
    this.volumeHistory = this.volumeHistory.filter(d => d.time > cutoff);
    this.tpsHistory = this.tpsHistory.filter(d => d.time > cutoff);

    // Update charts
    this.updateVolumeChart();
    this.updateTPSChart();
  }

  updateTPS(tps: number) {
    const elem = document.getElementById('tps');
    if (elem) elem.textContent = tps.toFixed(1);
  }

  updateMode(mode: string) {
    const elem = document.getElementById('mode');
    if (elem) elem.textContent = mode.toUpperCase();
  }

  updateProgramStats(programs: Record<string, number>) {
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

    // Render leaderboard
    const container = document.getElementById('programs-leaderboard');
    if (!container) return;

    container.innerHTML = '';

    for (const [program, count] of sorted) {
      const percent = total > 0 ? (count / total) * 100 : 0;

      const item = document.createElement('div');
      item.className = 'leaderboard-item';

      item.innerHTML = `
        <div class="leaderboard-name">${this.formatProgramName(program)}</div>
        <div class="leaderboard-value">${percent.toFixed(1)}%</div>
        <div class="leaderboard-bar">
          <div class="leaderboard-bar-fill" style="width: ${percent}%"></div>
        </div>
      `;

      container.appendChild(item);
    }
  }

  updateTokenStats(tokens: Record<string, number>) {
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

    // Render leaderboard
    const container = document.getElementById('tokens-leaderboard');
    if (!container) return;

    container.innerHTML = '';

    for (const [token, volume] of sorted) {
      const percent = total > 0 ? (volume / total) * 100 : 0;

      const item = document.createElement('div');
      item.className = 'leaderboard-item';

      item.innerHTML = `
        <div class="leaderboard-name">${token}</div>
        <div class="leaderboard-value">$${this.formatNumber(volume)}</div>
        <div class="leaderboard-bar">
          <div class="leaderboard-bar-fill" style="width: ${percent}%"></div>
        </div>
      `;

      container.appendChild(item);
    }
  }

  private updateVolumeChart() {
    const svg = d3.select('#volume-chart');
    svg.selectAll('*').remove();

    if (this.volumeHistory.length === 0) return;

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

  private updateTPSChart() {
    const svg = d3.select('#tps-chart');
    svg.selectAll('*').remove();

    if (this.tpsHistory.length === 0) return;

    const width = 420;
    const height = 110;
    const margin = { top: 5, right: 40, bottom: 15, left: 5 };

    const maxTPS = d3.max(this.tpsHistory, d => d.tps) || 1;

    const x = d3.scaleTime()
      .domain(d3.extent(this.tpsHistory, d => d.time) as [number, number])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, maxTPS])
      .range([height - margin.bottom, margin.top]);

    const line = d3.line<{ time: number; tps: number }>()
      .x(d => x(d.time))
      .y(d => y(d.tps))
      .curve(d3.curveMonotoneX);

    const area = d3.area<{ time: number; tps: number }>()
      .x(d => x(d.time))
      .y0(height - margin.bottom)
      .y1(d => y(d.tps))
      .curve(d3.curveMonotoneX);

    // Draw area
    svg.append('path')
      .datum(this.tpsHistory)
      .attr('fill', 'rgba(6, 255, 165, 0.3)')
      .attr('d', area);

    // Draw line
    svg.append('path')
      .datum(this.tpsHistory)
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
      .text(maxTPS.toFixed(0));
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
}
