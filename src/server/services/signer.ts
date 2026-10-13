import type { Intent } from "../domain/intent";
import type { PolicyDecision } from "../domain/policy";
import type { AsyncResult, ServiceInfo } from "./types";

/**
 * Signer (plan §3, §6, §10).
 *
 * ISOLATED. Lives in a separate service account in production. The AI
 * service has no IAM path to this. The only caller is the executor
 * (Rules mode) or the user-approval flow (Confirm mode).
 *
 * Keys and session grants live in a signer service the AI cannot call.
 * Exchange trade keys are stored in KMS; wallet session keys or a user
 * wallet via WalletConnect. The app database holds a reference id, never
 * the secret (plan §10).
 *
 * `signIntent` accepts ONLY an intent that has a `PolicyDecision` with
 * verdict `allow` (or `resize` resized to). If the verdict is `reject`,
 * this method throws. The signer is the only component that may turn an
 * accepted intent into a signature.
 *
 * Anomaly halt (plan §10): if `signIntent` fails (signer error, network
 * error, oracle mismatch), the executor records a `signer-error` row in
 * the decision log and stops the book.
 */
export interface Signer {
  /**
   * Sign an intent that has passed the policy gate.
   *
   * @throws if `decision.verdict` is `"reject"` — the signer is not a
   *   path around the policy engine.
   * @throws if the signer is unavailable (anomaly halt).
   *
   * Returns a `signatureId` that the executor writes into the decision
   * log entry. The id is opaque to the app; it is the signer's handle
   * for the signature in its own audit trail.
   */
  signIntent(
    intent: Intent,
    decision: PolicyDecision,
  ): AsyncResult<{ signatureId: string }>;

  /**
   * Revoke all session keys for a book. Used by the kill switch (plan
   * §3, §10). Trade permission on exchange keys is also disabled. Does
   * NOT delete history — the append-only decision log is intact.
   *
   * Idempotent: calling twice is safe and returns successfully the
   * second time.
   */
  revokeSessionKeys(bookId: string): AsyncResult<void>;

  /**
   * Health probe — used by the executor before requesting a signature.
   * If the signer is `down` or `degraded`, the executor refuses to
   * start a batch and records the state.
   */
  health(): AsyncResult<ServiceInfo>;
}

/**
 * KMS-backed signer stub. Real implementation lands in Phase 3
 * (Confirm mode, user-wallet signing via WalletConnect) and Phase 4
 * (Rules mode, KMS session keys). Until then every method throws
 * not-implemented so callers fail loudly.
 *
 * The real signer lives in a separate service account; this stub is
 * in-process so the BFF can wire the interface during development. The
 * real deployment replaces this class with an RPC client.
 */
export class KmsSigner implements Signer {
  async signIntent(
    _intent: Intent,
    _decision: PolicyDecision,
  ): AsyncResult<{ signatureId: string }> {
    throw new Error(
      "not-implemented: KmsSigner.signIntent (Phase 3 Confirm / Phase 4 Rules)",
    );
  }

  async revokeSessionKeys(_bookId: string): AsyncResult<void> {
    throw new Error(
      "not-implemented: KmsSigner.revokeSessionKeys (Phase 4 Rules — kill switch drill)",
    );
  }

  async health(): AsyncResult<ServiceInfo> {
    throw new Error(
      "not-implemented: KmsSigner.health (Phase 4 Rules)",
    );
  }
}
