# House — Mandate reference

This document encodes the strategy mandate from §4 of the construction
plan. The mandate is the contract the policy engine evaluates against
every intent. See also the [non-custody statement](./non-custody-statement.md)
and the [intent schema](./intent-schema.md).

## 1. Why a mandate

Quoted from §4 of the construction plan:

> "Most profitable" is not a usable objective by itself. Raw return
> maximisation drifts into leverage, illiquid tokens, and wash venues.
> The mandate stores a precise objective and the constraints the user
> actually chose.

The mandate exists because optimisation without a written constraint
drifts. The mandate is the constraint set, written down.

## 2. Objective

Default objective: `max-return-after-costs-vol-dd` — maximise expected
return after costs, subject to a volatility and drawdown budget.

The user can switch the score to `absolute-return`, but the risk caps
in §3 still bind. Switching the objective does not relax the budget.

Backtests must deduct fees, slippage, and funding. A return that
ignores costs is not a usable number.

## 3. Risk budget

The risk budget is set by the user. Every field has a default and a
unit. The unit is basis points unless noted.

| Field                          | Default | Unit    | Meaning                                                        |
|--------------------------------|---------|---------|----------------------------------------------------------------|
| `maxSingleAssetWeightBps`      | 4000    | bps     | Max weight any single asset may hold. 4000 = 40%.              |
| `maxStablecoinFloorBps`        | 1000    | bps     | Min weight that must remain in stablecoins. 1000 = 10%.        |
| `maxVenueConcentrationBps`    | 5000    | bps     | Max share of NAV that may sit at one venue. 5000 = 50%.        |
| `maxPortfolioDrawdownBps`      | 2500    | bps     | Max drawdown from peak; breach forces a de-risk to stables. 2500 = 25%. |
| `leverageCap`                  | 1.0     | ratio   | Max gross/notional leverage. >1.0 is explicit opt-in. OFF in v1. |

A drawdown breach forces de-risk to stables. It does not silently
relax; it triggers an action.

Leverage above 1.0 is an explicit opt-in. It stays OFF in v1.

## 4. Allowed actions

Default allowed actions:

- hold
- rebalance-spot
- stake
- unstake

Lending and LP are opt-in sleeves. They are OFF by default. Turning
one on is a recorded mandate change (see [versioning](#6-versioning)).

A sleeve is a sub-allocation. The stake sleeve and the LP sleeve are
examples. See [glossary](./glossary.md).

## 5. Moderate ethics screen

Moderate means a short hard ban plus soft preferences, not a values
essay. The screen is data, not a model judgement.

### Hard exclude

Lists, not prompts. Hard excludes do not veto a single intent — they
constrain the universe before any intent is constructed.

- Sanctioned addresses and assets.
- Known mixers on the execution path.
- Tokens with no contract verification on the chosen chain.
- Assets the user personally blocks.

> The AI may explain a preference. It may not override a hard exclude.

### Soft prefer

Changes ranking, does not veto.

- Higher liquidity.
- Published supply.
- Venues with withdrawal history.

### User toggles

Default OFF. Turning one on is a recorded mandate change.

- Privacy coins.
- Gambling tokens.
- Meme sleeves.

### Versioning of ethics lists

> Ethics lists are versioned so a later decision can be replayed
> against the list that was live that day.

See [EthicsListVersion in the data model](./architecture.md#4-data-model).
Hard excludes are lists with versions — a vague prompt to "be ethical"
will not survive an audit (§12, risks to design around).

## 6. Versioning

Mandates are immutable rows. A change never overwrites history. Every
version is replayable. This is from §7 of the construction plan.

The database row for a mandate is `MandateVersion`:

- `version` — monotonically increasing per book.
- `payload` — the JSON blob of the mandate (see §7).
- `summary` — short human-readable summary for the audit list.
- `createdBy` — the user who created this version.
- `createdAt` — when it was created.

Editing the mandate inserts a new row. The old row stays. Any past
decision can be replayed against the mandate version that was live at
decision time.

## 7. Worked example

A sample mandate JSON object, using the types in
`src/server/domain/mandate.ts`. The shape is what matters; field names
are stable so the policy engine and the AI house can both read it.

```json
{
  "version": 3,
  "objective": "max-return-after-costs-vol-dd",
  "bookCurrency": "USDC",
  "universe": ["eth", "wbtc", "usdc", "usdt", "arb", "lido-staked-eth"],
  "riskBudget": {
    "maxSingleAssetWeightBps": 4000,
    "maxStablecoinFloorBps": 1000,
    "maxVenueConcentrationBps": 5000,
    "maxPortfolioDrawdownBps": 2500,
    "leverageCap": 1.0
  },
  "allowedActions": ["hold", "rebalance-spot", "stake", "unstake"],
  "optInSleeves": {
    "lending": false,
    "lp": false
  },
  "targetWeightsBps": {
    "eth": 3000,
    "wbtc": 1500,
    "lido-staked-eth": 2000,
    "arb": 500,
    "usdc": 2000,
    "usdt": 1000
  },
  "driftBandsBps": {
    "rebalanceTrigger": 500,
    "hardRebalanceTrigger": 1000
  },
  "dailyTurnoverCapBps": 2000,
  "ethicsListRef": {
    "version": 2
  },
  "houseMode": {
    "enabled": false,
    "defaultExpiryDays": 7
  }
}
```

Notes on the example:

- `universe` is a list, not a prompt. The AI cannot add to it. Adding
  an asset is an owner action (see [non-custody statement §3](./non-custody-statement.md#3-what-house-cannot-do)).
- `targetWeightsBps` is the strategy. Drift bands trigger rebalance
  intents (see [intent schema](./intent-schema.md)).
- `ethicsListRef.version` points at the immutable
  `EthicsListVersion` row that was live when this mandate version was
  created. Replaying any intent against this mandate uses the same
  ethics list.
- `houseMode.enabled = false` is the default. House mode is per book,
  time-boxed, and reversible.

## Related

- [Non-custody statement](./non-custody-statement.md)
- [Intent schema reference](./intent-schema.md)
- [Architecture map](./architecture.md)
- [Build phases](./build-phases.md)
- [Glossary](./glossary.md)
