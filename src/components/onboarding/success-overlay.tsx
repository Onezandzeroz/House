"use client";

import * as React from "react";
import { motion } from "framer-motion";

import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * SuccessOverlay — the full-screen golden-checkmark success animation
 * shown after POST /api/trust returns 201 (Task 47-49).
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │                                          │
 *   │            ╭─────────────╮               │
 *   │            │   ✓ (gold)  │  ← SVG check  │
 *   │            ╰─────────────╯      path draw│
 *   │                                          │
 *   │            "Success"                     │  ← serif gold 3xl
 *   │     "Welcome to Smith Family Reserve"    │  ← serif muted medium
 *   │                                          │
 *   │      [Observe] [AI: Advisor]             │  ← starting posture
 *   │                                          │
 *   └──────────────────────────────────────────┘
 *
 * Animation timeline (all framer-motion, no CSS keyframes needed):
 *   1. Overlay fade-in (200ms) — backdrop fades from 0 → 1.
 *   2. Circle draw — `motion.path` `pathLength` 0 → 1 over 800ms with
 *      spring easing.
 *   3. Check path draw — `motion.path` `pathLength` 0 → 1 over 400ms,
 *      starts after the circle completes (~600ms delay).
 *   4. Outer ring scale-in from 0.8 → 1.0 with spring (0.4 stiffness).
 *   5. "Success" text fade-in + slide-up after checkmark (400ms delay,
 *      500ms duration).
 *   6. "Welcome to {trustName}" undertitle fade-in after "Success"
 *      (200ms delay after Success, 500ms duration).
 *   7. Posture badges fade-in (200ms delay after Welcome).
 *   8. Auto-dismiss after 3 seconds — overlay fades out (300ms).
 *   9. `onComplete` callback fires after the fade-out completes so the
 *      parent can refresh the trust state and the dashboard mounts.
 *
 * Visual language:
 *   - Backdrop: bg-black/80 backdrop-blur-md — dark, semi-transparent.
 *   - The check is gold (#C9A227) with a soft radial gold glow behind it
 *     (radial-gradient(circle at 50% 50%, rgba(201,162,39,0.18), transparent 70%).
 *   - Drop-shadow on the SVG: drop-shadow(0 0 12px rgba(201,162,39,0.6)).
 *   - "Success" is in Cormorant serif 3xl-4xl with the gold-gradient
 *     text fill (.house-text-gradient-gold).
 *   - "Welcome to {trustName}" is in serif medium muted.
 *   - The badges mirror the live dashboard's mode + AI-role chips so the
 *     trustee sees the starting posture (Observe + Advisor) immediately.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" + aria-labelledby="success-title".
 *   - The SVG is aria-hidden (decorative) — the "Success" text is the
 *     semantic announcement.
 *   - The auto-dismiss has a 3-second delay; the parent may also
 *     short-circuit it by calling onComplete early.
 *
 * Implementation notes:
 *   - framer-motion `motion.path` with `pathLength` is the canonical way
 *     to animate SVG stroke draw (see framer-motion docs). The `pathRef`
 *     pattern is used so motion knows the path element; passing the SVG
 *     via JSX triggers the animation on mount.
 *   - The overlay is rendered in a portal-like fixed container at z-50
 *     so it covers the whole viewport. The parent (multi-page-wizard)
 *     mounts it conditionally when `submitState === "success"`.
 *   - The 3-second auto-dismiss is implemented with `setTimeout`. The
 *     callback is guarded by a `mountedRef` so it doesn't fire after
 *     unmount.
 */
export interface SuccessOverlayProps {
  /** The trust name (rendered in the "Welcome to {trustName}" undertitle). */
  trustName: string;
  /**
   * Called after the auto-dismiss timeout completes (~3 seconds after
   * mount + 300ms fade-out). The parent uses this to refresh trust
   * state and land on the Portfolio page.
   */
  onComplete: () => void;
}

/**
 * Render the success overlay. Mount this only when the POST returns
 * 201; unmount happens automatically via the parent after onComplete
 * fires.
 */
export function SuccessOverlay({
  trustName,
  onComplete,
}: SuccessOverlayProps) {
  const mountedRef = React.useRef(true);

  // ---- Auto-dismiss after 3 seconds + 300ms fade-out. ---------------
  React.useEffect(() => {
    mountedRef.current = true;
    const t = setTimeout(() => {
      if (mountedRef.current) {
        onComplete();
      }
    }, 3000);
    return () => {
      mountedRef.current = false;
      clearTimeout(t);
    };
  }, [onComplete]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="success-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
    >
      <div className="flex flex-col items-center justify-center gap-6 px-6 py-12 text-center">
        {/* Check container — outer ring + SVG check + radial glow. */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 14,
            delay: 0.1,
          }}
          className="relative flex size-32 items-center justify-center"
        >
          {/* Soft radial gold glow behind the check. */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(201,162,39,0.18), transparent 70%)",
            }}
          />

          {/* Outer gold ring (static). */}
          <div
            aria-hidden
            className="absolute inset-2 rounded-full border border-primary/40 bg-primary/[0.04]"
          />

          {/* Animated SVG check — circle path then check path. */}
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            className="relative size-20"
            fill="none"
            stroke="#C9A227"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: "drop-shadow(0 0 12px rgba(201,162,39,0.6))",
            }}
          >
            {/* Circle path — drawn over 800ms with spring. */}
            <motion.path
              d="M 50 8 A 42 42 0 1 1 49.99 8"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 0.8,
                ease: [0.22, 1, 0.36, 1], // ease-out-quart-ish
              }}
            />
            {/* Check path — drawn over 400ms after the circle completes. */}
            <motion.path
              d="M 32 52 L 45 65 L 70 38"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{
                duration: 0.4,
                ease: "easeOut",
                delay: 0.6, // starts after circle is mostly drawn
              }}
            />
          </svg>
        </motion.div>

        {/* "Success" — serif gold, fade-in + slide-up after checkmark. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 1.0, ease: "easeOut" }}
          className="flex flex-col items-center gap-2"
        >
          <h2
            id="success-title"
            className="font-serif text-4xl font-bold tracking-tight house-text-gradient-gold sm:text-5xl"
          >
            Success
          </h2>
          <p className="font-serif text-lg font-medium text-muted-foreground sm:text-xl">
            Welcome to {trustName}
          </p>
        </motion.div>

        {/* Posture badges — fade-in after Welcome. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 1.4 }}
          className="flex flex-wrap items-center justify-center gap-2"
        >
          <Badge
            variant="outline"
            className="bg-allow/15 text-allow-foreground border-allow/40"
          >
            <ShieldCheck className="size-3" aria-hidden />
            Mode: Observe
          </Badge>
          <Badge
            variant="outline"
            className="bg-primary/15 text-primary border-primary/40"
          >
            AI role: Advisor
          </Badge>
        </motion.div>

        {/* Auto-dismiss hint — small muted text under the badges. */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 1.6 }}
          className="text-[11px] text-muted-foreground"
        >
          Opening your portfolio…
        </motion.p>
      </div>
    </motion.div>
  );
}
