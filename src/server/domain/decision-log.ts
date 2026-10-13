import type { PolicyContext, PolicyDecision } from "./policy";

/**
 * Decision log kinds (plan §3, §7). Every accepted OR rejected intent is
 * written here so the beneficiary can export and replay.
 *
 *   policy-reject   — the policy engine returned verdict "reject".
 *   policy-accept   — the policy engine returned verdict "allow" or
 *                     "resize"; the (resized) intent moves forward.
 *   user-approve    — at Confirm mode, the user approved the batch.
 *   user-reject     — at Confirm mode, the user rejected the batch.
 *   signer-error    — the signer returned an error or was unavailable.
 *                      Triggers the anomaly halt (plan §10).
 *   filled          — the executor reconciled a fill back into lots.
 *   expired         — the intent's `expiresAt` passed before signing.
 *   kill-switched   — the kill switch fired after the intent was
 *                     created but before it was filled. Terminal.
 */
export const DecisionLogKind = {
  PolicyReject: "policy-reject",
  PolicyAccept: "policy-accept",
  UserApprove: "user-approve",
  UserReject: "user-reject",
  SignerError: "signer-error",
  Filled: "filled",
  Expired: "expired",
  KillSwitched: "kill-switched",
} as const;
export type DecisionLogKind =
  (typeof DecisionLogKind)[keyof typeof DecisionLogKind];

/**
 * Fill data — written when the executor reconciles a fill back into lots
 * (plan §7, Phase 3 Confirm). The lot ledger must match the venue; this
 * row is the auditable record of the actual execution.
 */
export interface Fill {
  price: string;
  fee: string;
  slippageBps: number;
  quantity: string;
  venue: string;
  filledAt: Date;
}

/**
 * DecisionLogEntry — mirrors the `DecisionLogEntry` Prisma model.
 *
 * `context` is the typed PolicyContext snapshot at decision time. When
 * persisted, the BFF JSON-marshals it into the DB's TEXT column; on
 * read, the BFF JSON-parses it back. The DB never stores it as a real
 * JSON column (SQLite + Prisma round-trip safety).
 *
 * `signatureId` is the optional signature id returned by the signer
 * (set on `policy-accept`, `user-approve`, `filled`). `fill` is the
 * optional fill data (set on `filled`).
 *
 * Append-only. Every accepted OR rejected intent is written here so
 * the beneficiary can export and replay. A row is never updated; a
 * later event adds a new row.
 */
export interface DecisionLogEntry {
  id: string;
  bookId: string;
  intentId: string;
  kind: DecisionLogKind;
  context: PolicyContext;
  signatureId: string | null;
  fill: Fill | null;
  createdAt: Date;
}
