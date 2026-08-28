import { useCallback, useRef, useState, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Pull down from the top of a page to reload it.
 *
 * In standalone (installed) mode there is no browser chrome, so there is no
 * reload button and no address bar to pull on — iOS's own pull-to-refresh
 * doesn't exist there either. Without this, a user whose data has gone
 * stale has no way to ask for fresh data short of force-quitting the app.
 *
 * Extracted from the Contacts page so every screen behaves identically
 * rather than each growing its own slightly different copy.
 */

/** How far you must pull before letting go actually refreshes. */
const TRIGGER_DISTANCE = 60;
/** Cap on how far the indicator travels, so a long drag doesn't push the
 * page absurdly far down. */
const MAX_PULL = 80;
/** Finger travel is halved on the way to the indicator, so the pull feels
 * weighted rather than stuck to the fingertip. */
const PULL_RESISTANCE = 0.5;
/** A refresh that resolves instantly reads as "nothing happened" — the
 * spinner appears and vanishes in the same frame. Holding it briefly makes
 * the refresh legible as an event. */
const MIN_SPIN_MS = 600;

interface PullToRefreshProps {
  /** Reloads this screen's data. Whatever it awaits is what the spinner waits on. */
  onRefresh: () => void | Promise<unknown>;
  children: ReactNode;
  /** Suppresses the gesture — e.g. while a dialog is open, where a
   * downward drag is scrolling the dialog, not the page behind it. */
  disabled?: boolean;
}

export function usePullToRefresh({ onRefresh, disabled = false }: Omit<PullToRefreshProps, 'children'>) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullOffset, setPullOffset] = useState(0);

  const touchStartY = useRef(0);
  const pullDistance = useRef(0);
  const isPulling = useRef(false);
  // Guards against a second refresh being kicked off while one is running —
  // `refreshing` is state, so it isn't updated yet within the same gesture.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    const started = Date.now();
    try {
      await onRefresh();
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < MIN_SPIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS - elapsed));
      }
      setRefreshing(false);
      inFlight.current = false;
    }
  }, [onRefresh]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Only start a pull when the page is already scrolled to the very top,
    // otherwise a downward swipe mid-list would refresh instead of scroll.
    //
    // This reads window.scrollY deliberately: these pages scroll the
    // document, not an inner element. The original Contacts version checked
    // a ref'd <div> that was never itself scrollable, so its scrollTop was
    // permanently 0 and this guard never actually rejected anything.
    if (disabled || window.scrollY > 0) {
      isPulling.current = false;
      return;
    }
    touchStartY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, [disabled]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      pullDistance.current = Math.min(delta * PULL_RESISTANCE, MAX_PULL);
      setPullOffset(pullDistance.current);
    } else {
      // Pulled back up past the start point — treat the gesture as
      // abandoned so it can't be re-armed halfway through a scroll.
      pullDistance.current = 0;
      setPullOffset(0);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (isPulling.current && pullDistance.current >= TRIGGER_DISTANCE) {
      void refresh();
    }
    isPulling.current = false;
    pullDistance.current = 0;
    setPullOffset(0);
  }, [refresh]);

  return {
    refreshing,
    pullOffset,
    refresh,
    /** Spread onto the page's outermost element. */
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}

/** The spinner strip that grows as you pull. Render at the very top of the
 * page, above the header. */
export function PullIndicator({ pullOffset, refreshing }: { pullOffset: number; refreshing: boolean }) {
  if (pullOffset <= 0 && !refreshing) return null;

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-smooth"
      style={{ height: refreshing ? 48 : pullOffset }}
    >
      <RefreshCw
        className={cn(
          'h-5 w-5 text-muted-foreground transition-transform',
          (refreshing || pullOffset >= TRIGGER_DISTANCE) && 'animate-spin text-primary'
        )}
        style={{ transform: refreshing ? undefined : `rotate(${pullOffset * 3}deg)` }}
      />
    </div>
  );
}
