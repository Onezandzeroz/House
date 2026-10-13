# House — Intent schema reference

This document encodes the intent schema from §3 of the construction
plan. The intent is the only executable shape in the system. See also
the [non-custody statement](./non-custody-statement.md), the
[mandate reference](./mandate.md), and the [architecture map](./architecture.md).

## The rule

Quoted from §3 of the construction plan:

> Intent shape is fixed: asset, side, venue, notional, max slippage,
> expiry, reason code.

And:

> Model output is never executed as text. Only the intent schema is
> executable.

The schema below is the contract.

## 1. The contract

The intent is the only shape:

- the AI may emit,
- the policy engine accepts,
- the signer may sign.

Everything else — natural language, model reasoning, free-form JSON —
is non-executable text. It goes into the decision log as rationale. It
never reaches the signer.

## 2. Fields

| Field            | Type     | Meaning                                                 | Example                  |
|------------------|----------|---------------------------------------------------------|--------------------------|
| `assetId`        | string   | Must be in the mandate universe. Lists, not prompts.    | `"eth"`                  |
| `side`           | enum     | buy \| sell \| stake \| unstake \| transfer-to-stables  | `"sell"`                 |
| `venue`          | string   | CEX id or DEX router name. Must be an allowed venue.    | `"binance"`              |
| `notional`       | string   | In the book currency (e.g. USDC). String for precision. | `"5000"`                 |
| `maxSlippageBps` | int      | Cap on realized slippage. Breach rejects the fill.      | `50`                     |
| `expiresAt`      | datetime | Stale intents are rejected.                             | `2026-10-09T12:05:00Z`   |
| `reasonCode`     | enum     | drift-rebalance \| drawdown-de-risk \| scheduled-rebalance \| ai-proposal \| user-approve | `"drift-rebalance"` |
| `clientId`       | string   | Idempotency id; retries cannot double-fill.            | `"intent-2026-10-09-001"` |

Two more fields the system tracks but the proposer does not choose:

| Field    | Type   | Meaning                                                          |
|----------|--------|------------------------------------------------------------------|
| `origin` | enum   | rules \| ai \| user. Set by the proposer path, not by the intent. |
| `status` | enum   | pending \| policy-rejected \| user-rejected \| kill-switched \| signed \| filled \| expired. Set by the policy engine and signer. |

## 3. Status flow

```
                          pending
                             |
            +----------------+----------------+-----------------+
            |                |                |                 |
     policy-rejected    user-rejected    kill-switched       signed
                                                         |
                                                         |
                                                       filled
                                                         |
                                                       expired
                                                         (stale)
```

States in detail:

- `pending` — created, not yet evaluated.
- `policy-rejected` — the policy engine rejected. The intent is logged
  and never reaches the signer.
- `user-rejected` — at Confirm mode, the user rejected the batch.
- `kill-switched` — the kill switch fired while the intent was
  pending. No fill. The event is logged.
- `signed` — the signer accepted and signed. Awaiting fill.
- `filled` — the venue returned a fill. Fill data is reconciled back
  into lots.
- `expired` — the `expiresAt` passed before a fill. Stale intents are
  rejected by the policy engine on sight.

## 4. Policy gate order

The policy engine runs these checks in order. On the first `reject`,
the engine stops. The intent is logged as `policy-rejected` with the
reason captured in the decision log context.

```
1. kill-switch         If the book is killed, every pending intent is
                       kill-switched. No further checks run.

2. universe            assetId must be in the mandate universe list.
                       Reject if absent. (Lists, not prompts.)

3. ethics              assetId, venue, and execution path must pass
                       the hard excludes for the live EthicsListVersion.
                       The AI may explain a preference. It may not
                       override a hard exclude.

4. leverage            Gross notional after the intent must stay
                       within leverageCap. Default 1.0. OFF above 1.0
                       in v1.

5. concentration       Resulting single-asset weight must stay under
                       maxSingleAssetWeightBps. Resulting venue weight
                       must stay under maxVenueConcentrationBps.

6. drawdown            If the book is at or past
                       maxPortfolioDrawdownBps from peak, only
                       de-risk to stables is allowed. Any other side
                       is rejected.

7. daily-turnover      Notional plus the day's prior fills must stay
                       under dailyTurnoverCapBps. A breach rejects
                       rather than queues.

8. venue-health        The venue must be healthy (no price
                       dislocation, no failed oracle, no signer
                       error). An anomaly halts the book and pages
                       the owner.

9. allow-or-resize-or-reject   The verdict. The engine may:
                       - allow  — the intent reaches the signer.
                       - resize — the notional is reduced to fit
                                  inside caps, then allowed.
                       - reject — logged as policy-rejected.
```

The check order matters. Kill switch first, universe before ethics,
drawdown before turnover. Reordering them changes what a replay
returns.

## 5. Worked examples

### Example A — an intent that passes

A small drift rebalance to stables.

```json
{
  "clientId": "intent-2026-10-09-001",
  "assetId": "eth",
  "side": "transfer-to-stables",
  "venue": "binance",
  "notional": "5000",
  "maxSlippageBps": 50,
  "expiresAt": "2026-10-09T12:05:00Z",
  "reasonCode": "drift-rebalance"
}
```

Policy run:

1. kill-switch — book not killed. Pass.
2. universe — `eth` is in the universe. Pass.
3. ethics — no hard exclude on `eth` or `binance`. Pass.
4. leverage — notional $5k against a $100k book is 5%; gross stays under 1.0. Pass.
5. concentration — single-asset weight stays under 4000 bps. Venue weight stays under 5000 bps. Pass.
6. drawdown — book is 800 bps from peak, under the 2500 cap. Pass.
7. daily-turnover — $5k plus the day's prior fills is under 2000 bps cap. Pass.
8. venue-health — venue healthy. Pass.
9. allow-or-resize-or-reject — allow.

Verdict: `signed` then `filled`. Fill reconciled into a lot.

### Example B — an intent that is resized

A drift rebalance that is too large for the single-asset cap.

```json
{
  "clientId": "intent-2026-10-09-002",
  "assetId": "wbtc",
  "side": "buy",
  "venue": "kraken",
  "notional": "30000",
  "maxSlippageBps": 80,
  "expiresAt": "2026-10-09T13:05:00Z",
  "reasonCode": "drift-rebalance"
}
```

Policy run:

1. kill-switch — not killed. Pass.
2. universe — `wbtc` is in the universe. Pass.
3. ethics — no hard exclude. Pass.
4. leverage — gross notional within 1.0. Pass.
5. concentration — buying $30k of wbtc on a $100k book would push wbtc
   weight from 1500 bps to 4500 bps, over the 4000 cap. Engine may
   resize: max buy = $25k to stay under the cap.
6. drawdown — within budget. Pass.
7. daily-turnover — within cap. Pass.
8. venue-health — venue healthy. Pass.
9. allow-or-resize-or-reject — **resize** to $25k, then allow.

Verdict: `signed` with notional `$25000`, then `filled`. The decision
log records the original notional, the resize, the reason, and the
fill.

### Example C — an intent that is rejected

An asset that is not in the universe.

```json
{
  "clientId": "intent-2026-10-09-003",
  "assetId": "memecoin-x",
  "side": "buy",
  "venue": "binance",
  "notional": "1000",
  "maxSlippageBps": 100,
  "expiresAt": "2026-10-09T14:05:00Z",
  "reasonCode": "ai-proposal"
}
```

Policy run:

1. kill-switch — not killed. Pass.
2. universe — `memecoin-x` is not in the universe. **Reject.** Engine stops.

Verdict: `policy-rejected` with reason `universe-violation`. The intent
is logged. The signer is never called. The AI receives no path to
retry outside the schema.

The asset cannot be added by the AI either. Whitelisting a new asset
is an owner action (see [non-custody statement §3](./non-custody-statement.md#3-what-house-cannot-do)).

## Related

- [Non-custody statement](./non-custody-statement.md)
- [Mandate reference](./mandate.md)
- [Architecture map](./architecture.md)
- [Build phases](./build-phases.md)
- [Glossary](./glossary.md)
