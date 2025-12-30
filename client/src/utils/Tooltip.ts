import * as THREE from 'three';

/**
 * Global tooltip system for visualizations
 * Displays information about hovered elements
 */
export class Tooltip {
  private element: HTMLDivElement;
  private isVisible: boolean = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'visualization-tooltip';
    this.element.style.cssText = `
      position: fixed;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid #8b5cf6;
      border-radius: 4px;
      color: #ffffff;
      font-family: monospace;
      font-size: 12px;
      pointer-events: none;
      z-index: 10000;
      display: none;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
    `;
    document.body.appendChild(this.element);
  }

  /**
   * Show tooltip at mouse position with content
   */
  show(x: number, y: number, content: string | HTMLElement): void {
    if (typeof content === 'string') {
      this.element.innerHTML = content;
    } else {
      this.element.innerHTML = '';
      this.element.appendChild(content);
    }

    // Position tooltip near mouse but not directly under it
    this.element.style.left = `${x + 15}px`;
    this.element.style.top = `${y + 15}px`;
    this.element.style.display = 'block';
    this.isVisible = true;
  }

  /**
   * Hide tooltip
   */
  hide(): void {
    this.element.style.display = 'none';
    this.isVisible = false;
  }

  /**
   * Update position (for when mouse moves while hovering)
   */
  updatePosition(x: number, y: number): void {
    if (this.isVisible) {
      this.element.style.left = `${x + 15}px`;
      this.element.style.top = `${y + 15}px`;
    }
  }

  /**
   * Format tooltip content for a trade particle
   */
  static formatTradeInfo(data: {
    program?: string;
    token?: string;
    volume?: number;
    signature?: string;
    slot?: number;
  }): string {
    const parts: string[] = [];

    if (data.program) {
      parts.push(`<div style="color: #06ffa5;"><strong>Program:</strong> ${data.program}</div>`);
    }

    if (data.token) {
      parts.push(`<div style="color: #ff006e;"><strong>Token:</strong> ${data.token}</div>`);
    }

    if (data.volume !== undefined) {
      parts.push(`<div style="color: #8b5cf6;"><strong>Volume:</strong> $${Tooltip.formatNumber(data.volume)}</div>`);
    }

    if (data.slot !== undefined) {
      parts.push(`<div style="color: #888;"><strong>Slot:</strong> ${data.slot}</div>`);
    }

    if (data.signature) {
      parts.push(`<div style="color: #ffaa00; margin-top: 4px; font-size: 10px;">Click to view on Solscan</div>`);
    }

    return parts.join('');
  }

  /**
   * Format tooltip content for aggregated data (like bars)
   */
  static formatAggregateInfo(data: {
    program?: string;
    token?: string;
    volume?: number;
    trades?: number;
    programs?: number;
  }): string {
    const parts: string[] = [];

    if (data.program) {
      parts.push(`<div style="color: #06ffa5;"><strong>Program:</strong> ${data.program}</div>`);
    }

    if (data.token) {
      parts.push(`<div style="color: #ff006e;"><strong>Token:</strong> ${data.token}</div>`);
    }

    if (data.volume !== undefined) {
      parts.push(`<div style="color: #8b5cf6;"><strong>Volume:</strong> $${Tooltip.formatNumber(data.volume)}</div>`);
    }

    if (data.trades !== undefined) {
      parts.push(`<div style="color: #00ddff;"><strong>Trades:</strong> ${data.trades}</div>`);
    }

    if (data.programs !== undefined) {
      parts.push(`<div style="color: #ff00ff;"><strong>Programs:</strong> ${data.programs}</div>`);
    }

    return parts.join('');
  }

  /**
   * Format large numbers
   */
  private static formatNumber(num: number): string {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.hide();
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

/**
 * Helper interface for objects that can be hovered/clicked
 */
export interface InteractiveObject {
  mesh: THREE.Mesh | THREE.Points | THREE.Line;
  data: {
    program?: string;
    token?: string;
    volume?: number;
    signature?: string;
    slot?: number;
    trades?: number;
    programs?: number;
  };
}
