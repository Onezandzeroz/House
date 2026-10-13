# House — Glossary

Plain definitions for the terms used across the House documentation.
Short sentences only. See also the [non-custody statement](./non-custody-statement.md),
the [mandate reference](./mandate.md), the [intent schema](./intent-schema.md),
the [architecture map](./architecture.md), and the [build phases](./build-phases.md).

## House

Working name. House is the bankroll operating system for one owner.
The future AI is "the house" only when the mandate is on. When the
mandate is off, the system is just a bankroll tool.

## Bankroll

The product. A bankroll is the pool of capital the system manages
inside the user's risk budget. The bankroll is not a fund; it is the
owner's own money under a written mandate.

## Book

The unit of strategy, permission, and reporting. One login can hold
several books. A book has one mandate, one mode, one kill switch, one
decision log. The book currency is a stablecoin the user picks, default
USDC.

## Sleeve

A sub-allocation inside a book. The stake sleeve holds staked assets.
The LP sleeve holds LP positions. The lending sleeve holds lent
assets. Sleeves are opt-in. Default off. Turning one on is a recorded
mandate change.

## Intent

The only executable shape in the system. Asset, side, venue, notional,
max slippage, expiry, reason code. The AI may emit only this. The
signer may sign only this. See [intent schema](./intent-schema.md).

## Mandate

The objective plus the constraints the user chose. Objective, risk
budget, allowed actions, ethics list, target weights, drift bands.
Immutable, versioned rows. See [mandate reference](./mandate.md).

## Universe

The list of allowed assets. A list, not a prompt. The AI cannot add
to it. Adding an asset is an owner action. The universe is part of
the mandate.

## Policy engine

The gate. A pure function from book state plus mandate to `allow`,
`resize`, or `reject`. Runs the 9 policy gates in order. The only
component allowed to emit an executable intent. See
[intent schema §4](./intent-schema.md#4-policy-gate-order).

## Signer

Isolated. Holds exchange trade keys in KMS and wallet session keys.
Signs accepted intents only. Holds no network path the AI can call.
Runs in a separate service account. The AI service has no IAM path
to it.

## Kill switch

Revokes session keys and disables trade permission on exchange keys
without deleting history. Read-only observation continues. The
decision log is append-only. The kill event is itself logged. The
owner holds the kill switch.

## House mode

Rules mode with the proposal source swapped to the AI service. Same
grants, same caps, same kill switch. Per book, time-boxed (default
expiry 7 days), and reversible. If the AI is down, the account falls
back to Rules or Confirm, never to an open order book.

## Mark

A price. Two kinds are stored separately and never collapsed:
reference price (CoinGecko or equivalent) and executable price (venue
mid). Both are stored per asset per book. Forcing them into one number
is a documented risk.

## Lot

A unit of cost basis. Quantity, cost in the book currency, venue,
timestamp. Lots decrease on sell or transfer-out. The lot ledger is
the PnL the user can trust.

## Drift

Actual weights vs target weights. Drift is shown against a
hand-entered target in Phase 1, against the mandate's target weights
from Phase 2. Drift bands trigger rebalance intents.

## Beneficiary

A named party who receives reports. Can be the owner. May be granted
a view of the decision log. Does not get keys unless the owner
assigns a signer role. A phase-5+ concern. The owner of the kill
switch remains the owner.

## Operator

A later role. A human or the AI service with propose rights only. An
operator proposes intents; the policy engine still gates them; the
signer still signs them. An operator never holds the kill switch.

## Related

- [Non-custody statement](./non-custody-statement.md)
- [Mandate reference](./mandate.md)
- [Intent schema reference](./intent-schema.md)
- [Architecture map](./architecture.md)
- [Build phases](./build-phases.md)
