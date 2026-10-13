/**
 * Operating modes (plan §2).
 *
 * Every account has exactly one mode. Moving up a mode requires a fresh
 * confirmation and a tighter permission grant. Moving down is always
 * immediate. House mode is not a second product — it is Rules mode with
 * the proposal source swapped from a ruleset to the AI service. If the AI
 * is down, the account falls back to Rules or Confirm, never to an open
 * order book.
 *
 * Ladder (lowest to highest):
 *
 *   Observe  — balances, prices, PnL, drift vs target. Nobody signs.
 *   Advise   — policy engine writes a proposed book + reason. User
 *              executes outside the app, or ignores it.
 *   Confirm  — same proposals, packaged as a batch. User approves each
 *              batch in the app. DEFAULT PRODUCT.
 *   Rules    — deterministic rebalance when drift or a schedule fires.
 *              Pre-authorised session key or trade-only API key, inside
 *              caps.
 *   House    — AI proposes; policy still gates; execution uses the same
 *              grants as Rules. AI cannot widen the grant.
 */

export const OperatingMode = {
  Observe: "observe",
  Advise: "advise",
  Confirm: "confirm",
  Rules: "rules",
  House: "house",
} as const;

/** Operating mode union: observe | advise | confirm | rules | house. */
export type OperatingMode =
  (typeof OperatingMode)[keyof typeof OperatingMode];

/**
 * Mode ladder, lowest to highest. Used by `canTransition` to decide
 * direction. Index 0 is the most restricted (read-only), index 4 is the
 * most permissive (AI-proposed, policy-gated, session-key execution).
 */
export const MODE_LADDER: OperatingMode[] = [
  OperatingMode.Observe,
  OperatingMode.Advise,
  OperatingMode.Confirm,
  OperatingMode.Rules,
  OperatingMode.House,
];

/**
 * Whether a transition between modes is allowed by the ladder itself.
 *
 * Policy meaning (plan §2):
 * - Moving DOWN the ladder is always immediate — fewer permissions, less
 *   risk. The user can drop from House to Observe at any time, including
 *   via the kill switch.
 * - Moving UP the ladder requires a fresh confirmation and a tighter
 *   permission grant. The confirmation flow is enforced by the BFF /
 *   UI layer (a separate API path that records the user's grant). This
 *   pure function returns `false` for an up-move so that any caller
 *   that does not go through the confirmation path is rejected.
 * - Same-mode is a no-op and always allowed.
 *
 * Note: this function does not consume a confirmation token. Callers
 * that have already recorded a confirmation (via the BFF) call a
 * different path; they do not need this function to permit the up-move.
 */
export function canTransition(from: OperatingMode, to: OperatingMode): boolean {
  if (from === to) return true;
  const fromIdx = MODE_LADDER.indexOf(from);
  const toIdx = MODE_LADDER.indexOf(to);
  // Moving down is always immediate.
  if (toIdx < fromIdx) return true;
  // Moving up requires a fresh confirmation. The confirmation gate is
  // enforced elsewhere (BFF + DB); this pure function only certifies the
  // ladder order. An up-move without confirmation is rejected.
  return false;
}

/**
 * Whether the mode allows any signature path. Only Confirm / Rules /
 * House allow the signer to be called. Observe is read-only; Advise
 * writes proposals but the user executes outside the app.
 *
 * Policy meaning: the executor (Rules) and the user-approval flow
 * (Confirm) are the only callers of the Signer. This function is the
 * hard guard in front of `Signer.signIntent`.
 */
export function modeAllowsExecution(mode: OperatingMode): boolean {
  return (
    mode === OperatingMode.Confirm ||
    mode === OperatingMode.Rules ||
    mode === OperatingMode.House
  );
}

/**
 * Whether the mode allows the AI house service to propose intents.
 * Only House mode. In Rules mode the proposal source is a deterministic
 * ruleset; the AI is not consulted.
 *
 * Policy meaning (plan §2, §5): House mode is per-book, time-boxed, and
 * reversible. Default expiry 7 days until the user extends it. The AI
 * may not widen the grant — it uses the same grants as Rules.
 */
export function modeAllowsAIProposals(mode: OperatingMode): boolean {
  return mode === OperatingMode.House;
}

/**
 * Who signs in each mode, per the plan §2 table.
 *
 *   observe  -> "none"        — read-only keys and public addresses.
 *   advise   -> "user"        — user executes outside the app.
 *   confirm  -> "user"        — user approves each batch in the app.
 *   rules    -> "session-key" — pre-authorised session key or trade-only
 *                                API key, inside caps.
 *   house    -> "session-key" — same as Rules; AI cannot widen the grant.
 *
 * Policy meaning: the signer routing layer uses this to decide whether
 * to dispatch to a user-wallet flow (WalletConnect) or to a session-key
 * flow (KMS-backed). Observe has no signer dispatch at all.
 */
export function modeSigner(
  mode: OperatingMode,
): "none" | "user" | "session-key" {
  switch (mode) {
    case OperatingMode.Observe:
      return "none";
    case OperatingMode.Advise:
      return "user";
    case OperatingMode.Confirm:
      return "user";
    case OperatingMode.Rules:
      return "session-key";
    case OperatingMode.House:
      return "session-key";
  }
}
