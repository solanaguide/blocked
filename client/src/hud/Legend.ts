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

export class Legend {
  private container: HTMLDivElement;
  private visible: boolean = false;

  constructor() {
    // Create legend container
    this.container = document.createElement('div');
    this.container.id = 'visualization-legend';
    this.container.className = 'legend-container';
    this.container.innerHTML = `
      <div class="legend-header">
        <span class="legend-title">LEGEND</span>
        <span class="legend-hint">[L] to toggle</span>
      </div>
      <div class="legend-content"></div>
    `;

    // Add styles
    this.addStyles();

    // Add to document
    document.body.appendChild(this.container);

    // Start hidden
    this.hide();
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
        z-index: 1000;
        max-width: 280px;
        backdrop-filter: blur(10px);
        transition: opacity 0.2s ease, transform 0.2s ease;
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

      .legend-title {
        color: #8b5cf6;
        font-weight: bold;
        letter-spacing: 1px;
      }

      .legend-hint {
        color: #666;
        font-size: 9px;
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
  }

  /**
   * Hide the legend
   */
  hide(): void {
    this.visible = false;
    this.container.classList.add('hidden');
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
   * Clean up
   */
  dispose(): void {
    this.container.remove();
    const styles = document.getElementById('legend-styles');
    if (styles) styles.remove();
  }
}
