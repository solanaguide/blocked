/**
 * TouchGestureHandler - Handles touch gestures for mobile navigation
 *
 * Detects:
 * - Horizontal swipes for scene switching
 * - Vertical swipes for bottom sheet
 */

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface GestureCallbacks {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  currentX: number;
  currentY: number;
}

const SWIPE_THRESHOLD = 50; // Minimum distance in pixels
const VELOCITY_THRESHOLD = 0.3; // Minimum velocity (px/ms)
const MAX_SWIPE_TIME = 300; // Maximum time for a swipe (ms)

export class TouchGestureHandler {
  private element: HTMLElement;
  private callbacks: GestureCallbacks;
  private touchState: TouchState | null = null;
  private enabled: boolean = true;

  constructor(element: HTMLElement, callbacks: GestureCallbacks) {
    this.element = element;
    this.callbacks = callbacks;
    this.attachListeners();
  }

  private attachListeners(): void {
    this.element.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: true });
    this.element.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: true });
    this.element.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: true });
    this.element.addEventListener('touchcancel', this.onTouchCancel.bind(this), { passive: true });
  }

  private onTouchStart(e: TouchEvent): void {
    if (!this.enabled) return;

    // Only track single finger gestures
    if (e.touches.length !== 1) {
      this.touchState = null;
      return;
    }

    const touch = e.touches[0];
    this.touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      currentX: touch.clientX,
      currentY: touch.clientY
    };
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.enabled || !this.touchState) return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    this.touchState.currentX = touch.clientX;
    this.touchState.currentY = touch.clientY;
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.enabled || !this.touchState) return;

    const deltaX = this.touchState.currentX - this.touchState.startX;
    const deltaY = this.touchState.currentY - this.touchState.startY;
    const deltaTime = Date.now() - this.touchState.startTime;

    // Calculate velocities
    const velocityX = Math.abs(deltaX) / deltaTime;
    const velocityY = Math.abs(deltaY) / deltaTime;

    // Determine if this was a valid swipe
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Check if swipe meets threshold
    if (deltaTime < MAX_SWIPE_TIME) {
      // Horizontal swipe (more horizontal than vertical)
      if (absX > absY && absX > SWIPE_THRESHOLD && velocityX > VELOCITY_THRESHOLD) {
        if (deltaX < 0) {
          this.callbacks.onSwipeLeft?.();
        } else {
          this.callbacks.onSwipeRight?.();
        }
      }
      // Vertical swipe (more vertical than horizontal)
      else if (absY > absX && absY > SWIPE_THRESHOLD && velocityY > VELOCITY_THRESHOLD) {
        if (deltaY < 0) {
          this.callbacks.onSwipeUp?.();
        } else {
          this.callbacks.onSwipeDown?.();
        }
      }
    }

    this.touchState = null;
  }

  private onTouchCancel(): void {
    this.touchState = null;
  }

  // Public API

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.touchState = null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  updateCallbacks(callbacks: Partial<GestureCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  dispose(): void {
    this.element.removeEventListener('touchstart', this.onTouchStart.bind(this));
    this.element.removeEventListener('touchmove', this.onTouchMove.bind(this));
    this.element.removeEventListener('touchend', this.onTouchEnd.bind(this));
    this.element.removeEventListener('touchcancel', this.onTouchCancel.bind(this));
  }
}

/**
 * Creates a touch gesture handler on the canvas container for scene navigation
 */
export function createSceneGestureHandler(
  container: HTMLElement,
  onPreviousScene: () => void,
  onNextScene: () => void,
  onOpenSheet?: () => void
): TouchGestureHandler {
  return new TouchGestureHandler(container, {
    onSwipeLeft: onNextScene,
    onSwipeRight: onPreviousScene,
    onSwipeUp: onOpenSheet
  });
}
