"use client";

import * as React from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * ResetTrustDialog — bekreftelses-dialog for "Reset trust" (Task 18).
 *
 * Triggeres av en "Reset trust"-knapp (destruktiv variant). Beskriver tydelig
 * hva som skjer: demo-trusten og alle dens posisjoner slettes; eieren
 * re-onboarder med sine egne reelle beholdninger. Handlingen er irreversibel.
 *
 * Ved bekreftelse:
 *   1. POST-er ingenting; kaller `DELETE /api/trust` (ingen body — API-et
 *      bruker `getOrCreateDemoTrustee()` og finner trusten selv).
 *   2. Lukker dialogen.
 *   3. Kaller `onReset()`-callbacken slik at parent (HouseOverview) kan
 *      propagere state-endringen opp til page.tsx som flipper trust-state
 *      til `{ kind: "none" }` → onboarding-wizard auto-åpner.
 *
 * Feil-propagation: hvis API-et returnerer 404 "no-trust" (allerede slettet),
 * tolkes det som suksess og onReset kalles likevel. Andre feil surfaces
 * via sonner-toast; dialogen forblir åpen slik at eieren kan prøve igjen.
 *
 * shadcn `AlertDialog` (radix-ui AlertDialogPrimitive). Vi bruker en
 * controlled AlertDialog (open + onOpenChange) slik at parent kan åpne
 * dialogen fra både en "Add funds"-relatert knapp i ManagePositionsPanel
 * sin footer og en egen "Reset trust"-knapp i HouseOverview-headeren.
 */
export interface ResetTrustDialogProps {
  /** Controlled open-state. */
  open: boolean;
  /** Controlled setter. */
  onOpenChange: (open: boolean) => void;
  /**
   * Kalles etter suksessfull sletting. Parent flipper trust-state til
   * `{ kind: "none" }` slik at onboarding-wizard auto-åpner (page.tsx sin
   * useEffect lytter på trustState.kind === "none").
   */
  onReset: () => void;
}

/**
 * Render bekreftelses-dialogen. Atomic — ingen state utover en `deleting`-
 * flagg som deaktiverer knappene mens DELETE pågår.
 */
export function ResetTrustDialog({
  open,
  onOpenChange,
  onReset,
}: ResetTrustDialogProps) {
  const [deleting, setDeleting] = React.useState(false);

  const handleConfirm = React.useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/trust", { method: "DELETE" });
      if (res.status === 404) {
        // Idempotent: trusten finnes ikke lenger. Oppførsak som suksess —
        // onReset flipper state og wizard auto-åpner.
        toast.info("Trust already reset.");
      } else if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        const message =
          data && typeof data === "object" && typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status} ${res.statusText}`;
        throw new Error(message);
      } else {
        toast.success("Trust reset.", {
          description: "Re-onboard with your real holdings.",
        });
      }
      onReset();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Could not reset trust", { description: message });
    } finally {
      setDeleting(false);
    }
  }, [onOpenChange, onReset]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-foreground">
            <ShieldAlert
              className="size-4 text-reject-foreground"
              aria-hidden
            />
            Reset trust?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will delete the demo trust and all its positions. You&apos;ll
            start fresh and can onboard with your real holdings. This cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // Prevent radix from auto-closing on click — we close
            // ourselves in handleConfirm after the DELETE resolves.
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={deleting}
            className="bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40"
          >
            {deleting ? (
              <>
                <RefreshCw className="size-4 animate-spin" aria-hidden />
                Deleting...
              </>
            ) : (
              "Delete and start fresh"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
