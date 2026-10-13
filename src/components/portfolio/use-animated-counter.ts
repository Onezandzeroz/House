"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useAnimatedCounter — tween a number from its previous value to the new
 * target value over `durationMs` using `requestAnimationFrame` with an
 * easeOutCubic easing. The hook is used by the pie chart centre label
 * (NAV) and the KPI strip's hero numerals so values "count up / down"
 * smoothly when the underlying data changes (e.g. after add/remove
 * position, or the optional `simulateLive` NAV tick).
 *
 * Behaviour:
 *   - On mount, the hook starts at 0 and tweens to the initial target.
 *   - On target change, the hook tweens from the currently-displayed
 *     value to the new target.
 *   - The tween is cancelled (rAF cancelled) on unmount + on every new
 *     target change so a stale rAF never clobbers a fresher tween.
 *   - The returned value is rounded to `decimals` (default 2) so the
 *     caller can format the string itself.
 *
 * Anti-jank notes:
 *   - `easeOutCubic` is the right curve for numbers — fast out of the
 *     gate (the eye is drawn to motion), slow at the end (the value
 *     "settles" instead of overshooting).
 *   - The duration is short (800ms default) so the tween finishes before
 *     the user could perceive a lag with their data source.
 *   - We use `requestAnimationFrame` (not setInterval) so the tween
 *     syncs to the display refresh rate (60–120 Hz) and pauses when the
 *     tab is hidden. setInterval would keep firing in the background and
 *     the user would see a "jump" when they returned to the tab.
 *
 * @param target        The number to tween toward.
 * @param durationMs    Tween duration in ms (default 800).
 * @param decimals      Decimal places to round the displayed value
 *                      (default 2 — matches NAV / dry powder formatting).
 * @returns             The current displayed value (number, pre-rounded
 *                      to `decimals`).
 */
export function useAnimatedCounter(
  target: number,
  durationMs = 800,
  decimals = 2,
): number {
  const [display, setDisplay] = useState(0);
  // The source-of-truth "from" value for the current tween — kept in a
  // ref so the next tween can chain off the currently-displayed value
  // without re-rendering the parent.
  const fromRef = useRef(0);
  // The start timestamp of the current tween (performance.now()).
  const startRef = useRef<number | null>(null);
  // The rAF handle so we can cancel on unmount + new tween.
  const rafRef = useRef<number | null>(null);
  // Mirror of `display` so the rAF closure can read the current value
  // without re-subscribing on every frame (which would restart the
  // tween). Updated in a layout-effect after each render.
  const displayRef = useRef(0);
  // We keep the latest `display` in a ref synchronously so the effect
  // can read it when the next target arrives. This avoids depending on
  // `display` in the effect's deps array (which would restart the tween
  // on every rAF frame, freezing the value).
  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    // Cancel any in-flight tween — we start a fresh one below.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    // The tween starts from the currently-displayed value (NOT from
    // `fromRef.current` — `fromRef` is the tween's start point, but a
    // fresh target should continue from where we are now, not jump back
    // to the previous tween's start).
    fromRef.current = displayRef.current;
    startRef.current = null;

    const from = fromRef.current;
    const delta = target - from;
    // No-op case: target equals current display — don't kick off a rAF
    // (avoids unnecessary frames + avoids a synchronous setState in
    // the effect body, which would trigger cascading renders).
    if (delta === 0) return;

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic: 1 - (1 - t)^3 — fast start, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + delta * eased;
      // Round to `decimals` so the displayed number doesn't show
      // floating-point noise (e.g. 264500.00000000003).
      const factor = Math.pow(10, decimals);
      const rounded = Math.round(next * factor) / factor;
      setDisplay(rounded);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Snap to the exact target on completion — guards against
        // accumulated rounding error leaving the display off by a tick.
        setDisplay(target);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, durationMs, decimals]);

  return display;
}
