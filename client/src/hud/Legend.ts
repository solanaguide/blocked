/**
 * Legend - Toggleable overlay showing what visual properties mean
 *
 * Displays a small box in the corner explaining:
 * - Color meanings (with swatches)
 * - Size = Volume scale
 * - Position meanings
 */

export interface LegendItem {
  label: string;
  color: number;
  description: string;
}

export type LegendMode = 'full' | 'compact';

const STORAGE_KEY = 'legend-visible';
const MOBILE_BREAKPOINT = 768;
const AUTO_HIDE_DELAY = 5000;

export class Legend {
  private container: HTMLDivElement;
  private visible: boolean = false;
  private mode: LegendMode = 'full';
  private autoHideTimer: number | null = null;
  private isMobile: boolean = false;

  constructor() {
    this.checkViewport();

    // Create legend container
    this.container = document.createElement('div');
    this.container.id = 'visualization-legend';
    this.container.className = 'legend-container';
    this.container.innerHTML = `
      <div class="legend-header">
        <span class="legend-title">LEGEND</span>
        <div class="legend-header-right">
          <span class="legend-hint">[L] to toggle</span>
          <button class="legend-close" aria-label="Close legend">&times;</button>
        </div>
      </div>
      <div class="legend-content"></div>
    `;

    // Add styles
    this.addStyles();

    // Add to document
    document.body.appendChild(this.container);

    // Attach close button listener
    const closeBtn = this.container.querySelector('.legend-close');
    closeBtn?.addEventListener('click', () => this.hide());

    // Listen for resize
    window.addEventListener('resize', () => this.handleResize());

    // Load saved preference and show by default
    this.loadPreference();
  }

  private checkViewport(): void {
    this.isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  }

  private loadPreference(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // Default to visible if no preference saved
      if (saved === null || saved === 'true') {
        this.show();
      }
    } catch (e) {
      // Default to showing
      this.show();
    }
  }

  private savePreference(): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(this.visible));
    } catch (e) {
      console.warn('Failed to save legend preference:', e);
    }
  }

  private handleResize(): void {
    const wasMobile = this.isMobile;
    this.checkViewport();

    if (wasMobile !== this.isMobile) {
      this.updatePosition();
      this.updateMode();
    }
  }

  private updatePosition(): void {
    if (this.isMobile) {
      // Bottom center on mobile
      this.container.classList.add('legend-mobile');
    } else {
      // Bottom left on desktop
      this.container.classList.remove('legend-mobile');
    }
  }

  private updateMode(): void {
    if (this.isMobile) {
      this.setMode('compact');
      this.startAutoHide();
    } else {
      this.setMode('full');
      this.stopAutoHide();
    }
  }

  private addStyles(): void {
    // Check if styles already exist
    if (document.getElementById('legend-styles')) return;

    const style = document.createElement('style');
    style.id = 'legend-styles';
    style.textContent = `
      .legend-container {
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(139, 92, 246, 0.5);
        border-radius: 8px;
        padding: 12px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        color: #fff;
        z-index: 50;
        max-width: 280px;
        backdrop-filter: blur(10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: auto;
      }

      .legend-container.hidden {
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
      }

      .legend-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(139, 92, 246, 0.3);
      }

      .legend-header-right {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .legend-title {
        color: #8b5cf6;
        font-weight: bold;
        letter-spacing: 1px;
      }

      .legend-hint {
        color: #666;
        font-size: 9px;
      }

      .legend-close {
        background: none;
        border: none;
        color: #666;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        transition: color 0.2s;
      }

      .legend-close:hover {
        color: #fff;
      }

      .legend-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .legend-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .legend-swatch {
        width: 12px;
        height: 12px;
        border-radius: 3px;
        flex-shrink: 0;
        margin-top: 2px;
        box-shadow: 0 0 6px currentColor;
      }

      .legend-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .legend-label {
        color: #ddd;
        font-weight: 500;
      }

      .legend-desc {
        color: #888;
        font-size: 10px;
        line-height: 1.3;
      }

      .legend-divider {
        height: 1px;
        background: rgba(139, 92, 246, 0.2);
        margin: 4px 0;
      }

      /* Mobile positioning - bottom center */
      .legend-container.legend-mobile {
        left: 50%;
        transform: translateX(-50%);
        bottom: 60px;
        max-width: 90%;
      }

      .legend-container.legend-mobile.hidden {
        transform: translateX(-50%) translateY(10px);
      }

      /* Compact mode for mobile */
      .legend-container.legend-compact .legend-header {
        display: none;
      }

      .legend-container.legend-compact .legend-content {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 12px;
      }

      .legend-container.legend-compact .legend-item {
        align-items: center;
      }

      .legend-container.legend-compact .legend-text {
        flex-direction: row;
        gap: 4px;
      }

      .legend-container.legend-compact .legend-desc {
        display: none;
      }

      .legend-container.legend-compact .legend-swatch {
        width: 10px;
        height: 10px;
        margin-top: 0;
      }

      .legend-container.legend-compact .legend-label {
        font-size: 10px;
      }

      /* Hide legend popup on mobile - use drawer tab instead */
      @media (max-width: 768px) {
        .legend-container {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Update the legend with new items
   */
  update(items: LegendItem[]): void {
    const content = this.container.querySelector('.legend-content');
    if (!content) return;

    content.innerHTML = items.map(item => {
      const hexColor = '#' + item.color.toString(16).padStart(6, '0');
      return `
        <div class="legend-item">
          <div class="legend-swatch" style="background-color: ${hexColor}; color: ${hexColor};"></div>
          <div class="legend-text">
            <span class="legend-label">${item.label}</span>
            <span class="legend-desc">${item.description}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Show the legend
   */
  show(): void {
    this.visible = true;
    this.container.classList.remove('hidden');
    this.savePreference();
    this.updatePosition();

    // Start auto-hide on mobile
    if (this.isMobile) {
      this.startAutoHide();
    }
  }

  /**
   * Hide the legend
   */
  hide(): void {
    this.visible = false;
    this.container.classList.add('hidden');
    this.savePreference();
    this.stopAutoHide();
  }

  /**
   * Toggle visibility
   */
  toggle(): boolean {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
    return this.visible;
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Set display mode (full or compact)
   */
  setMode(mode: LegendMode): void {
    this.mode = mode;
    if (mode === 'compact') {
      this.container.classList.add('legend-compact');
    } else {
      this.container.classList.remove('legend-compact');
    }
  }

  /**
   * Get current mode
   */
  getMode(): LegendMode {
    return this.mode;
  }

  /**
   * Start auto-hide timer (for mobile)
   */
  startAutoHide(delay: number = AUTO_HIDE_DELAY): void {
    this.stopAutoHide();
    this.autoHideTimer = window.setTimeout(() => {
      this.hide();
    }, delay);
  }

  /**
   * Stop auto-hide timer
   */
  stopAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  /**
   * Check if in mobile mode
   */
  isMobileMode(): boolean {
    return this.isMobile;
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.stopAutoHide();
    this.container.remove();
    const styles = document.getElementById('legend-styles');
    if (styles) styles.remove();
  }
}
