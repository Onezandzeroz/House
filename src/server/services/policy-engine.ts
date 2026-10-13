import type { Intent } from "../domain/intent";
import type {
  PolicyCheckName,
  PolicyCheckResult,
  PolicyContext,
  PolicyDecision,
  PolicyVerdict,
} from "../domain/policy";

/**
 * Policy engine (plan §3, §6, §10). The GATE.
 *
 * Pure function from book state plus mandate to allow / resize / reject.
 * The signer is the only component that may turn an accepted intent
 * into a signature. This engine never calls the signer.
 *
 * The engine is the contract the later AI service satisfies (plan §3):
 * "Build this gate in phase 2, before any live order. The later AI
 * service then has a socket to plug into, instead of a redesign."
 *
 * Check order (canonical, see `createPolicyEngine`):
 *
 *   1. kill-switch     — if active, immediately reject with kill-switched.
 *   2. universe        — asset must be in mandate.universe.
 *   3. ethics          — hard excludes; AI may NOT override.
 *   4. leverage        — total exposure after the intent <= leverageCap.
 *   5. concentration   — single-asset weight + venue concentration caps.
 *   6. drawdown        — if drawdown > cap, only transfer-to-stables allowed.
 *   7. daily-turnover   — running turnover + this notional <= daily cap.
 *   8. venue-health     — venue must be healthy.
 *
 * Behaviour:
 *
 *   - kill-switch active -> reject and STOP.
 *   - any check returns reject -> verdict is reject, engine STOPS.
 *   - any check returns resize -> engine composes the resized intent
 *     (id stays the same; notional and optionally maxSlippageBps are
 *     replaced) and continues. The final verdict is resize unless a
 *     later check rejects.
 *   - all checks allow -> verdict is allow.
 *
 * Every decision — including rejections — is written to the append-only
 * decision log by the CALLER (the executor), not here. This engine has
 * no DB handle and no side effects.
 */
export interface PolicyEngine {
  evaluate(intent: Intent, ctx: PolicyContext): PolicyDecision;
}

// ---------------------------------------------------------------------------
// Helpers for building check results.
// ---------------------------------------------------------------------------

function allow(name: PolicyCheckName, reason: string): PolicyCheckResult {
  return { name, verdict: "allow", reason };
}

function reject(name: PolicyCheckName, reason: string): PolicyCheckResult {
  return { name, verdict: "reject", reason };
}

function resize(
  name: PolicyCheckName,
  reason: string,
  resizeTo: { notional: string; maxSlippageBps?: number },
): PolicyCheckResult {
  return { name, verdict: "resize", reason, resizeTo };
}

// ---------------------------------------------------------------------------
// Individual checks — pure functions, stubbed arithmetic with TODOs.
// Real math lands in Phase 2 (paper book).
// ---------------------------------------------------------------------------

/**
 * Kill switch (plan §3, §10). If active, immediately reject with
 * kill-switched. The decision is still written to the log so the
 * beneficiary sees the halt; the kill switch does not delete history.
 */
function checkKillSwitch(
  _intent: Intent,
  ctx: PolicyContext,
): PolicyCheckResult {
  if (ctx.killSwitchActive) {
    return reject(
      "kill-switch",
      "Kill switch is active; session keys have been revoked.",
    );
  }
  return allow("kill-switch", "Kill switch is not active.");
}

/**
 * Universe (plan §3, §12). The intent's assetId must be in the mandate
 * universe. The universe is a list, not a prompt. The AI may not invent
 * assets — a model that can browse and pick any token will eventually
 * pick one the user cannot exit.
 */
function checkUniverse(
  intent: Intent,
  ctx: PolicyContext,
): PolicyCheckResult {
  if (!ctx.mandate.universe.includes(intent.assetId)) {
    return reject(
      "universe",
      `Asset ${intent.assetId} is not in the mandate universe.`,
    );
  }
  return allow("universe", `Asset ${intent.assetId} is in the universe.`);
}

/**
 * Ethics (plan §3, §4). Hard excludes only — sanctioned addresses,
 * known mixers, unverified contracts, user-blocked assets. The AI may
 * NOT override a hard exclude. Soft preferences are not enforced here;
 * they affect ranking inside the AI service, not the gate.
 */
function checkEthics(
  intent: Intent,
  ctx: PolicyContext,
): PolicyCheckResult {
  const hard = ctx.ethics.hardExclude;

  if (hard.userBlockedAssets.includes(intent.assetId)) {
    return reject(
      "ethics",
      `Asset ${intent.assetId} is on the user-blocked list.`,
    );
  }

  // TODO (Phase 2 paper book): when intent.side is "transfer-to-stables"
  //   or "sell", inspect the venue's withdrawal path against
  //   hard.sanctionedAddresses and hard.knownMixers. The venue adapter
  //   must supply the recent-inflow graph or this check stays advisory.
  //
  // TODO (Phase 2 paper book): when intent.side is "stake" / "unstake"
  //   or the intent touches an LP, verify the target contract address
  //   is NOT in hard.unverifiedContracts and IS verified on its chain.
  //   The contract address comes from the venue / target field on the
  //   intent (likely a sidecar — the intent schema does not carry a
  //   contract address today; that may need extending per protocol).

  return allow("ethics", "No hard exclude matched.");
}

/**
 * Leverage (plan §4). Total exposure after the intent must not exceed
 * `riskBudget.leverageCap`. Default cap is 1.0; >1.0 is explicit
 * opt-in (recorded as a mandate change) and stays off in v1.
 *
 * If the resulting leverage would exceed the cap, the check rejects —
 * we do not resize a leverage breach down to fit, because the
 * leverage ratio depends on the entire book, not just this notional.
 */
function checkLeverage(
  _intent: Intent,
  ctx: PolicyContext,
): PolicyCheckResult {
  // TODO (Phase 2 paper book): compute total exposure = sum of
  //   |position value| across all positions (free + staked + lending +
  //   lp + locked) in book currency using ctx.marks. Add intent.notional
  //   if side is buy / stake. Divide by book NAV. Compare to cap.
  //
  // For the stub, accept. Real check will reject if the ratio > cap.
  const cap = ctx.mandate.riskBudget.leverageCap;
  return allow(
    "leverage",
    `Leverage cap ${cap} not exceeded (arithmetic stubbed).`,
  );
}

/**
 * Concentration (plan §4). Single-asset weight <=
 * `maxSingleAssetWeightBps`; venue concentration <=
 * `maxVenueConcentrationBps`.
 *
 * A single-asset breach RESIZES (the engine can shrink the notional
 * to fit under the cap). A venue concentration breach REJECTS — the
 * venue choice is part of the intent's identity, not something the
 * engine can shrink away.
 */
function checkConcentration(
  _intent: Intent,
  ctx: PolicyContext,
): PolicyCheckResult {
  // TODO (Phase 2 paper book): compute post-intent weight of
  //   intent.assetId in book currency. If weight > maxSingleAssetWeightBps,
  //   return resize with notional = (cap * NAV - current_value) at the
  //   executable mark. Clamp to >= 0.
  //
  // TODO (Phase 2 paper book): compute post-intent venue share
  //   (sum of position value at intent.venue / NAV). If > cap, reject.
  //
  // For the stub, accept.
  return allow(
    "concentration",
    `Single-asset cap ${ctx.mandate.riskBudget.maxSingleAssetWeightBps} bps; venue cap ${ctx.mandate.riskBudget.maxVenueConcentrationBps} bps (arithmetic stubbed).`,
  );
}

/**
 * Drawdown (plan §4). If portfolio drawdown from peak >
 * `maxPortfolioDrawdownBps`, ONLY `transfer-to-stables` intents are
 * allowed — forces a de-risk. Any other side is rejected.
 *
 * This is the only check that depends on intent.side for its verdict:
 * the same drawdown state rejects a `buy` but allows a
 * `transfer-to-stables`. The intent.reasonCode "drawdown-de-risk" is
 * the canonical tag for the allowed side.
 */
function checkDrawdown(
  intent: Intent,
  _ctx: PolicyContext,
): PolicyCheckResult {
  // TODO (Phase 2 paper book): compute drawdownBps from peak using
  //   bookState.lots + marks + the most recent BookSnapshot.drawdownBps.
  //   If drawdownBps > cap and intent.side !== "transfer-to-stables",
  //   reject.
  //
  // For the stub, accept.
  return allow(
    "drawdown",
    `Drawdown within budget (arithmetic stubbed); side ${intent.side} allowed.`,
  );
}

/**
 * Daily turnover (plan §3, §4). Running turnover + this notional <= the
 * daily cap. The daily cap is derived from the mandate (e.g. a fraction
 * of NAV; the fraction itself is a mandate field in a later version).
 *
 * A breach RESIZES — the engine shrinks the notional to fit under the
 * remaining daily cap. The reason code "scheduled-rebalance" is the
 * canonical tag for routine turnover.
 */
function checkDailyTurnover(
  _intent: Intent,
  _ctx: PolicyContext,
): PolicyCheckResult {
  // TODO (Phase 2 paper book): parse ctx.dailyTurnoverSoFar + intent.notional
  //   as fixed-point decimals (use a decimal lib — never JS number for
  //   money). Compare against the daily cap derived from the mandate.
  //   If breach, return resize with notional = cap - dailyTurnoverSoFar
  //   (clamped to >= 0).
  //
  // For the stub, accept.
  return allow(
    "daily-turnover",
    "Daily turnover within cap (arithmetic stubbed).",
  );
}

/**
 * Venue health (plan §3, §10). The venue must be healthy. Anomaly halt
 * (plan §10): price dislocation, failed oracle, or signer error stops
 * the book and pages the owner.
 *
 * This check needs the MarketService.venueHealth result. The caller
 * (executor) must enrich the PolicyContext with a venue health map, or
 * the engine must call the MarketService directly. For v1 the engine is
 * pure and takes the context as-is; the BFF enriches the context before
 * calling evaluate. The TODO marks the enrichment point.
 */
function checkVenueHealth(
  intent: Intent,
  _ctx: PolicyContext,
): PolicyCheckResult {
  // TODO (Phase 2 paper book): the BFF must populate ctx with a
  //   `venueHealth: Record<venueId, { healthy: boolean; notes?: string }>`
  //   field, OR the engine must hold a MarketService handle. The pure
  //   function chose the former; revisit when wiring.
  //
  // For the stub, accept.
  return allow(
    "venue-health",
    `Venue ${intent.venue} assumed healthy (lookup stubbed).`,
  );
}

/**
 * Canonical policy engine factory. Runs the 8 checks in the order
 * specified by plan §3 and §10.
 *
 * Pure function. No side effects. The signer is the only component
 * that may turn an accepted intent into a signature. This engine
 * never calls the signer.
 */
export function createPolicyEngine(): PolicyEngine {
  return {
    evaluate(intent: Intent, ctx: PolicyContext): PolicyDecision {
      const checks: PolicyCheckResult[] = [];
      const decidedAt = new Date();
      let verdict: PolicyVerdict = "allow";
      let resizedIntent: Intent | undefined;
      let reason = "All checks passed.";

      /**
       * Run a check, record its result, and decide whether to continue.
       * - reject -> stop, set verdict to reject, set reason.
       * - resize -> continue, set verdict to resize (unless already
       *   reject), compose the resized intent.
       * - allow  -> continue.
       */
      const run = (r: PolicyCheckResult): boolean => {
        checks.push(r);
        if (r.verdict === "reject") {
          verdict = "reject";
          reason = r.reason;
          return false;
        }
        if (r.verdict === "resize") {
          if (verdict !== "reject") verdict = "resize";
          if (r.resizeTo) {
            const base = resizedIntent ?? intent;
            resizedIntent = {
              ...base,
              notional: r.resizeTo.notional,
              ...(r.resizeTo.maxSlippageBps !== undefined
                ? { maxSlippageBps: r.resizeTo.maxSlippageBps }
                : {}),
            };
            reason = r.reason;
          }
        }
        return true;
      };

      // 1. kill-switch
      if (!run(checkKillSwitch(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }
      // 2. universe
      if (!run(checkUniverse(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }
      // 3. ethics
      if (!run(checkEthics(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }
      // 4. leverage
      if (!run(checkLeverage(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }
      // 5. concentration
      if (!run(checkConcentration(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }
      // 6. drawdown
      if (!run(checkDrawdown(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }
      // 7. daily-turnover
      if (!run(checkDailyTurnover(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }
      // 8. venue-health
      if (!run(checkVenueHealth(intent, ctx))) {
        return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
      }

      return finalize(intent.id, verdict, checks, resizedIntent, reason, decidedAt);
    },
  };
}

/** Internal helper — assemble the final PolicyDecision object. */
function finalize(
  intentId: string,
  verdict: PolicyVerdict,
  checks: PolicyCheckResult[],
  resizedTo: Intent | undefined,
  reason: string,
  decidedAt: Date,
): PolicyDecision {
  return {
    intentId,
    verdict,
    checks,
    resizedTo,
    reason,
    decidedAt,
  };
}
