/**
 * PanelManager - Manages collapsible panel states and bottom sheet
 *
 * Handles:
 * - Panel collapse/expand with persistence
 * - Mobile bottom sheet with snap points
 * - Responsive behavior based on viewport
 */

export type PanelId = 'left' | 'right' | 'bottom';
export type PanelState = 'expanded' | 'collapsed';
export type SheetPosition = 'hidden' | 'peek' | 'half' | 'full';

interface PanelStates {
  left: PanelState;
  right: PanelState;
  bottom: PanelState;
}

const STORAGE_KEY = 'hud-panel-states';
const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

export type CameraOffsetCallback = (offsetY: number) => void;

export class PanelManager {
  private states: PanelStates;
  private sheetPosition: SheetPosition = 'hidden';
  private isMobile: boolean = false;
  private isTablet: boolean = false;
  private onCameraOffset: CameraOffsetCallback | null = null;
  private sheetUpdateInterval: number | null = null;

  // DOM elements
  private leftPanel: HTMLElement | null = null;
  private rightPanel: HTMLElement | null = null;
  private bottomPanel: HTMLElement | null = null;
  private leftTab: HTMLElement | null = null;
  private rightTab: HTMLElement | null = null;
  private bottomTab: HTMLElement | null = null;
  private bottomSheet: HTMLElement | null = null;
  private sheetTabs: NodeListOf<HTMLElement> | null = null;
  private sheetPanels: NodeListOf<HTMLElement> | null = null;

  constructor() {
    this.states = this.loadStates();
    this.checkViewport();
    this.initElements();
    this.attachEventListeners();
    this.applyStates();

    // Listen for resize
    window.addEventListener('resize', () => this.handleResize());
  }

  private loadStates(): PanelStates {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load panel states:', e);
    }

    // Default states based on viewport
    return {
      left: 'expanded',
      right: 'expanded',
      bottom: 'expanded'
    };
  }

  private saveStates(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.states));
    } catch (e) {
      console.warn('Failed to save panel states:', e);
    }
  }

  private checkViewport(): void {
    const width = window.innerWidth;
    this.isMobile = width < MOBILE_BREAKPOINT;
    this.isTablet = width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT;
  }

  private initElements(): void {
    this.leftPanel = document.querySelector('.left-panel');
    this.rightPanel = document.querySelector('.right-panel');
    this.bottomPanel = document.querySelector('.bottom-panel');
    this.leftTab = document.getElementById('left-panel-tab');
    this.rightTab = document.getElementById('right-panel-tab');
    this.bottomTab = document.getElementById('bottom-panel-tab');
    this.bottomSheet = document.getElementById('bottom-sheet');
    this.sheetTabs = document.querySelectorAll('.bottom-sheet-tab');
    this.sheetPanels = document.querySelectorAll('.bottom-sheet-panel');
  }

  private attachEventListeners(): void {
    // Panel tab clicks
    this.leftTab?.addEventListener('click', () => this.toggle('left'));
    this.rightTab?.addEventListener('click', () => this.toggle('right'));
    this.bottomTab?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showSheet('half');
    });

    // Bottom sheet tab clicks - prevent any bubbling
    this.sheetTabs?.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const tabId = tab.getAttribute('data-tab');
        if (tabId) this.switchSheetTab(tabId);
      });
    });

    // Prevent clicks inside sheet from closing it
    this.bottomSheet?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Click outside sheet to close - only on canvas/visualization area
    const canvasContainer = document.getElementById('canvas-container');
    canvasContainer?.addEventListener('click', () => {
      if (this.sheetPosition !== 'hidden') {
        this.hideSheet();
      }
    });

    // Handle sheet drag
    this.setupSheetDrag();
  }

  private setupSheetDrag(): void {
    if (!this.bottomSheet) return;

    const handle = this.bottomSheet.querySelector('.bottom-sheet-handle');
    if (!handle) return;

    let startY = 0;
    let startTranslate = 0;
    let isDragging = false;

    const getTranslateY = (): number => {
      const transform = this.bottomSheet!.style.transform;
      const match = transform.match(/translateY\(([^)]+)\)/);
      if (match) {
        if (match[1].includes('%')) {
          return parseFloat(match[1]);
        }
      }
      return 100;
    };

    const onTouchStart = (e: TouchEvent) => {
      isDragging = true;
      startY = e.touches[0].clientY;
      startTranslate = getTranslateY();
      this.bottomSheet!.style.transition = 'none';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging) return;

      const deltaY = e.touches[0].clientY - startY;
      const deltaPercent = (deltaY / window.innerHeight) * 100;
      const newTranslate = Math.max(0, Math.min(100, startTranslate + deltaPercent));

      this.bottomSheet!.style.transform = `translateY(${newTranslate}%)`;
    };

    const onTouchEnd = () => {
      if (!isDragging) return;
      isDragging = false;

      this.bottomSheet!.style.transition = '';

      const currentTranslate = getTranslateY();

      // Snap to closest position
      if (currentTranslate < 15) {
        this.showSheet('full');
      } else if (currentTranslate < 40) {
        this.showSheet('half');
      } else if (currentTranslate < 65) {
        this.showSheet('peek');
      } else {
        this.hideSheet();
      }
    };

    handle.addEventListener('touchstart', onTouchStart as EventListener);
    document.addEventListener('touchmove', onTouchMove as EventListener);
    document.addEventListener('touchend', onTouchEnd);
  }

  private applyStates(): void {
    // On mobile, panels are hidden by CSS
    if (this.isMobile) return;

    // On tablet, default to collapsed
    if (this.isTablet) {
      this.applyPanelState('left', this.states.left);
      this.applyPanelState('right', this.states.right);
    } else {
      // Desktop - apply saved states
      this.applyPanelState('left', this.states.left);
      this.applyPanelState('right', this.states.right);
      this.applyPanelState('bottom', this.states.bottom);
    }
  }

  private applyPanelState(panel: PanelId, state: PanelState): void {
    const panelElement = this.getPanelElement(panel);
    const tabElement = this.getTabElement(panel);

    if (!panelElement) return;

    if (state === 'collapsed') {
      panelElement.classList.add('collapsed');
      panelElement.classList.remove('expanded');
      if (tabElement) tabElement.style.display = 'flex';
    } else {
      panelElement.classList.remove('collapsed');
      panelElement.classList.add('expanded');
      // On desktop, hide tabs when panel is expanded
      if (!this.isTablet && !this.isMobile && tabElement) {
        tabElement.style.display = 'none';
      }
    }
  }

  private getPanelElement(panel: PanelId): HTMLElement | null {
    switch (panel) {
      case 'left': return this.leftPanel;
      case 'right': return this.rightPanel;
      case 'bottom': return this.bottomPanel;
    }
  }

  private getTabElement(panel: PanelId): HTMLElement | null {
    switch (panel) {
      case 'left': return this.leftTab;
      case 'right': return this.rightTab;
      case 'bottom': return this.bottomTab;
    }
  }

  private handleResize(): void {
    const wasMobile = this.isMobile;
    const wasTablet = this.isTablet;

    this.checkViewport();

    // Viewport changed significantly
    if (wasMobile !== this.isMobile || wasTablet !== this.isTablet) {
      this.applyStates();

      // Hide bottom sheet on desktop
      if (!this.isMobile) {
        this.hideSheet();
      }
    }
  }

  // Public API

  toggle(panel: PanelId): void {
    const current = this.states[panel];
    const newState: PanelState = current === 'expanded' ? 'collapsed' : 'expanded';
    this.states[panel] = newState;
    this.applyPanelState(panel, newState);
    this.saveStates();
  }

  expand(panel: PanelId): void {
    this.states[panel] = 'expanded';
    this.applyPanelState(panel, 'expanded');
    this.saveStates();
  }

  collapse(panel: PanelId): void {
    this.states[panel] = 'collapsed';
    this.applyPanelState(panel, 'collapsed');
    this.saveStates();
  }

  collapseAll(): void {
    this.collapse('left');
    this.collapse('right');
    this.collapse('bottom');
  }

  getState(panel: PanelId): PanelState {
    return this.states[panel];
  }

  // Bottom Sheet methods

  showSheet(position: SheetPosition = 'half'): void {
    if (!this.bottomSheet) return;

    // Populate content on first open
    this.populateSheetContent();

    // Start periodic updates to keep sheet content in sync
    this.startSheetUpdates();

    this.sheetPosition = position;
    this.bottomSheet.classList.remove('visible', 'peek', 'half');

    // Hide bottom tab when sheet is open
    if (this.bottomTab) {
      this.bottomTab.style.display = 'none';
    }

    // Calculate camera offset based on sheet position
    // Sheet covers portion of screen, so we shift camera to keep viz visible
    let cameraOffset = 0;
    switch (position) {
      case 'peek':
        this.bottomSheet.classList.add('peek');
        cameraOffset = 5; // Small offset for peek (25% coverage)
        break;
      case 'half':
        this.bottomSheet.classList.add('half');
        cameraOffset = 15; // Medium offset for half (50% coverage)
        break;
      case 'full':
        this.bottomSheet.classList.add('visible');
        cameraOffset = 25; // Large offset for full (90% coverage)
        break;
    }

    // Notify camera offset change
    this.onCameraOffset?.(cameraOffset);
  }

  hideSheet(): void {
    if (!this.bottomSheet) return;

    // Stop periodic updates
    this.stopSheetUpdates();

    this.sheetPosition = 'hidden';
    this.bottomSheet.classList.remove('visible', 'peek', 'half');

    // Show bottom tab again when sheet is hidden (on mobile)
    if (this.bottomTab && this.isMobile) {
      this.bottomTab.style.display = 'flex';
    }

    // Reset camera offset
    this.onCameraOffset?.(0);
  }

  private startSheetUpdates(): void {
    // Update sheet content every 500ms while open
    if (this.sheetUpdateInterval) return;
    this.sheetUpdateInterval = window.setInterval(() => {
      this.populateSheetContent();
    }, 500);
  }

  private stopSheetUpdates(): void {
    if (this.sheetUpdateInterval) {
      clearInterval(this.sheetUpdateInterval);
      this.sheetUpdateInterval = null;
    }
  }

  toggleSheet(): void {
    if (this.sheetPosition === 'hidden') {
      this.showSheet('half');
    } else {
      this.hideSheet();
    }
  }

  getSheetPosition(): SheetPosition {
    return this.sheetPosition;
  }

  switchSheetTab(tabId: string): void {
    // Update tab active state
    this.sheetTabs?.forEach(tab => {
      if (tab.getAttribute('data-tab') === tabId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Show corresponding panel
    this.sheetPanels?.forEach(panel => {
      if (panel.id === `sheet-${tabId}`) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });
  }

  // Populate bottom sheet content from main panels
  // This creates a live snapshot of current data
  populateSheetContent(): void {
    // Re-query elements to ensure we have the latest references
    const leftPanel = document.querySelector('.left-panel');
    const rightPanel = document.querySelector('.right-panel');
    const bottomPanel = document.querySelector('.bottom-panel');

    // Clone stats content (left panel sections)
    const statsPanel = document.getElementById('sheet-stats');
    if (statsPanel && leftPanel) {
      // Get current HTML content which includes live data
      const sections = leftPanel.querySelectorAll('.panel-section, .block-log-container');
      statsPanel.innerHTML = '';
      sections.forEach(section => {
        const clone = section.cloneNode(true) as HTMLElement;
        // Remove IDs from clones to avoid duplicates
        clone.querySelectorAll('[id]').forEach(el => {
          el.removeAttribute('id');
        });
        statsPanel.appendChild(clone);
      });
    }

    // Clone trading content (right panel sections)
    const tradingPanel = document.getElementById('sheet-trading');
    if (tradingPanel && rightPanel) {
      tradingPanel.innerHTML = '';
      const sections = rightPanel.querySelectorAll('.panel-section, .leaderboard');
      sections.forEach(section => {
        const clone = section.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[id]').forEach(el => {
          el.removeAttribute('id');
        });
        tradingPanel.appendChild(clone);
      });
    }

    // Clone charts - these are SVGs so we need innerHTML
    const chartsPanel = document.getElementById('sheet-charts');
    if (chartsPanel && bottomPanel) {
      chartsPanel.innerHTML = bottomPanel.innerHTML;
      // Remove IDs from chart clones
      chartsPanel.querySelectorAll('[id]').forEach(el => {
        el.removeAttribute('id');
      });
    }

    // Clone legend content
    const legendPanel = document.getElementById('sheet-legend');
    const legendContainer = document.querySelector('.legend-container .legend-content');
    if (legendPanel && legendContainer) {
      legendPanel.innerHTML = `
        <div class="panel-title" style="margin-bottom: 15px;">Visualization Legend</div>
        ${legendContainer.innerHTML}
      `;
    }
  }

  // Check if we're in mobile mode
  isMobileView(): boolean {
    return this.isMobile;
  }

  isTabletView(): boolean {
    return this.isTablet;
  }

  /**
   * Set callback for camera offset changes (called when sheet opens/closes)
   */
  setOnCameraOffset(callback: CameraOffsetCallback): void {
    this.onCameraOffset = callback;
  }
}
