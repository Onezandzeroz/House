import type { PolicyDecision } from "./policy";

/**
 * House domain error hierarchy.
 *
 * Machine code in `code`, English prose in `message`. Thrown by the
 * policy engine (when an invariant is breached synchronously) and by
 * the executor (when a service returns a Result with error).
 *
 * Note: a policy *rejection* is NOT always an error — `PolicyRejectionError`
 * is for cases where a caller attempted to bypass the gate (e.g. tried
 * to sign a rejected intent). The policy engine itself returns a
 * `PolicyDecision` with verdict "reject" rather than throwing.
 */
export class HouseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HouseError";
    this.code = code;
    // Restore the prototype chain across ES5 transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Convenience: thrown by every service stub in v1. The stub is shaped
 * correctly for compile-time, but the runtime is not implemented. Used
 * by `BookServiceImpl`, `MarketServiceImpl`, `AlchemyChainReader`,
 * `HeliusChainReader`, `CcxtVenueAdapter`, `KmsSigner`,
 * `ToolCalledAIHouse`.
 *
 * Throwing rather than returning a Result-with-error means callers fail
 * loudly — silent stubs would be worse than no stub.
 */
export class NotImplementedError extends HouseError {
  constructor(name: string) {
    super("not-implemented", `${name} is not implemented in this phase.`);
    this.name = "NotImplementedError";
  }
}

/**
 * The kill switch is active (plan §3, §10). Session keys have been
 * revoked and trade permission on exchange keys is disabled WITHOUT
 * deleting history. The executor refuses to sign anything until the
 * owner clears the switch.
 */
export class KillSwitchActiveError extends HouseError {
  constructor(message = "Kill switch is active; session keys revoked.") {
    super("kill-switch-active", message);
    this.name = "KillSwitchActiveError";
  }
}

/**
 * The policy engine rejected the intent. Carries the full `PolicyDecision`
 * so the caller can write it to the decision log even when the executor
 * refuses to proceed.
 *
 * Thrown when a caller attempts to sign a `reject`-verdict decision
 * (the Signer interface also throws on this).
 */
export class PolicyRejectionError extends HouseError {
  readonly decision: PolicyDecision;

  constructor(decision: PolicyDecision) {
    super(
      "policy-rejected",
      decision.reason || "Policy engine rejected the intent.",
    );
    this.name = "PolicyRejectionError";
    this.decision = decision;
  }
}

/** The intent has expired before signing. The executor refuses to sign. */
export class IntentExpiredError extends HouseError {
  constructor(message = "Intent has expired before signing.") {
    super("intent-expired", message);
    this.name = "IntentExpiredError";
  }
}

/**
 * The intent references an asset not in the mandate universe. Thrown by
 * the executor if it ever sees an intent whose assetId is not in
 * `mandate.universe` (the policy engine would have rejected it first).
 */
export class UniverseViolationError extends HouseError {
  readonly assetId: string;

  constructor(assetId: string) {
    super(
      "universe-violation",
      `Asset ${assetId} is not in the mandate universe.`,
    );
    this.name = "UniverseViolationError";
    this.assetId = assetId;
  }
}

/**
 * The intent touches a sanctioned address, a known mixer, or an
 * unverified contract. The AI may not override a hard exclude.
 *
 * Thrown by the executor if it ever sees an intent the ethics check
 * would have rejected (the policy engine rejects first).
 */
export class EthicsHardExcludeError extends HouseError {
  readonly reason: string;

  constructor(reason: string) {
    super(
      "ethics-hard-exclude",
      `Intent blocked by ethics hard exclude: ${reason}`,
    );
    this.name = "EthicsHardExcludeError";
    this.reason = reason;
  }
}

/**
 * The signer is unavailable. Triggers the anomaly halt (plan §10):
 * price dislocation, failed oracle, or signer error stops the book
 * and pages the owner.
 */
export class SignerUnavailableError extends HouseError {
  constructor(message = "Signer is unavailable.") {
    super("signer-unavailable", message);
    this.name = "SignerUnavailableError";
  }
}
