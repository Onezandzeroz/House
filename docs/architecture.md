# House — Architecture map

This document encodes the system shape from §6 of the construction
plan, the data model from §7, and the security minimums from §10. It
maps the plan's suggested stack to this workspace's stack. See also
the [non-custody statement](./non-custody-statement.md), the
[mandate reference](./mandate.md), the [intent schema](./intent-schema.md),
and the [build phases](./build-phases.md).

## 1. Clients

The web app is first. Mobile is later, as a signer and alert surface,
not a second brain.

- The web app never holds a long-lived seed.
- Exchange secrets are entered once and stored in a vault (KMS), with
  only a reference id in the app database.
- Mobile, when it arrives, signs and alerts. It does not run a second
  policy engine. It does not run a second book.

## 2. Services

Each service below is from §6. Each is described by what it does, what
it never does, and which phase implements it.

### Book service — Phase 1

- **What it does**: positions, cost basis, lots, and target weights.
  Owns the unit of strategy, permission, and reporting.
- **What it never does**: stores seeds. Stores trade key secrets in
  clear text. Calls the signer.
- **Phase**: 1.

### Market service — Phase 1

- **What it does**: prices, liquidity, and venue status. CoinGecko or
  equivalent for reference prices; venue mids for executable prices.
- **What it never does**: collapses reference and executable into one
  number. Both are stored as separate marks (see [data model](#4-data-model)).
- **Phase**: 1.

### Chain readers — Phase 1

- **What it does**: Alchemy or QuickNode for EVM balances and logs;
  Helius if Solana is in the first chain set. Wallet portfolio
  enrichment from CoinStats, GoldRush, or DeBank where it saves
  indexer work.
- **What it never does**: holds private keys. Reads public addresses
  only.
- **Phase**: 1.

### Venue adapter — Phase 1 read-only, Phase 3 trade

- **What it does**: CCXT for CEX balances and, later, orders. One
  adapter interface so a DEX router can sit beside it.
- **What it never does**: withdraws. Withdrawal is not in any scope
  the adapter is granted.
- **Phase**: 1 (read), 3 (trade-no-withdraw).

### Policy engine — Phase 2

- **What it does**: pure function from book state plus mandate to
  `allow`, `resize`, or `reject`. Runs the 9 policy gates in order
  (see [intent schema §4](./intent-schema.md#4-policy-gate-order)).
- **What it never does**: emits intents. Calls the signer. Calls the
  AI. Holds keys.
- **Phase**: 2.

### Signer — Phase 3 (isolated)

- **What it does**: exchange trade keys in KMS; wallet session keys or
  a user wallet via WalletConnect. Signs accepted intents only.
- **What it never does**: accepts text from the AI. Accepts intents
  that bypassed the policy engine. Runs in the same process as the AI.
- **Phase**: 3. Isolated service account.

### AI house — Phase 5 (isolated from signer)

- **What it does**: reads the book and the mandate, returns intents in
  the fixed schema and a short rationale. Swap models without touching
  execution.
- **What it never does**: holds keys. Has a network path to the
  signer. Emits anything outside the intent schema. Adds assets,
  venues, or leverage.
- **Phase**: 5. Separate service, tool-called.

## 3. Mode ladder

Every account has exactly one mode. Moving up a mode requires a fresh
confirmation and a tighter permission grant. Moving down is always
immediate.

Quoted from §2 of the construction plan:

```
+-----------+-----------------+------------------------------------------+
| Mode      | What runs       | Who signs                                |
+-----------+-----------------+------------------------------------------+
| Observe   | Balances,       | Nobody. Read-only keys and public        |
|           | prices, PnL,    | addresses.                               |
|           | drift vs target |                                          |
+-----------+-----------------+------------------------------------------+
| Advise    | Policy engine   | User executes outside the app, or       |
|           | writes a        | ignores it.                              |
|           | proposed book   |                                          |
|           | and a reason    |                                          |
+-----------+-----------------+------------------------------------------+
| Confirm   | Same proposals, | User approves each batch in the app.     |
|           | packaged as a   | Default product.                         |
|           | batch           |                                          |
+-----------+-----------------+------------------------------------------+
| Rules     | Deterministic   | Pre-authorised session key or trade-only |
|           | rebalance when  | API key, inside caps.                     |
|           | drift or a      |                                          |
|           | schedule fires  |                                          |
+-----------+-----------------+------------------------------------------+
| House     | AI proposes;    | Same as Rules. AI cannot widen the       |
|           | policy still    | grant.                                   |
|           | gates;          |                                          |
|           | execution uses  |                                          |
|           | the same grants |                                          |
+-----------+-----------------+------------------------------------------+
```

House mode is not a second product. It is Rules mode with the proposal
source swapped from a ruleset to the AI service. If the AI is down, the
account falls back to Rules or Confirm, never to an open order book.

## 4. Data model

The data model lives in `prisma/schema.prisma`. The list below mirrors
it model-by-model with a one-line purpose.

| Model                | Purpose                                                                              | Immutable? |
|----------------------|--------------------------------------------------------------------------------------|------------|
| `User`               | One owner in v1. Later: beneficiary and operator roles.                              | no         |
| `Session`            | NextAuth session token.                                                               | no         |
| `Book`               | The unit of strategy, permission, and reporting. Holds the current mode and kill state. | no         |
| `MandateVersion`     | Immutable mandate snapshot. A change never overwrites history (§7).                    | **yes**    |
| `EthicsListVersion`  | Immutable ethics list snapshot. Replayed against later decisions (§4).                | **yes**    |
| `Account`            | Exchange connection metadata, wallet addresses, chain ids. Holds a KMS reference, never a secret. | no         |
| `Position`           | Free, locked, staked, claimable. Stores source and confidence — no false precision.   | no         |
| `Lot`                | Quantity, cost in book currency, venue, timestamp. The PnL ledger.                   | no         |
| `Mark`               | Reference price AND executable price, both stored. Never collapsed.                  | no         |
| `Intent`             | The only executable shape. asset, side, venue, notional, max slippage, expiry, reason. | no         |
| `DecisionLogEntry`  | Append-only. Proposal, policy result, signature id or user rejection, fill.          | **yes**    |
| `DecisionApproval`   | Owner approve/reject of an intent at Confirm mode.                                   | no         |
| `BookSnapshot`       | Daily mark-to-book-currency for the drift view.                                      | no         |

The three immutable rows — `MandateVersion`, `EthicsListVersion`,
`DecisionLogEntry` — are the audit spine. Any past decision can be
replayed against the mandate version, the ethics list version, and the
policy context snapshot that were live at decision time.

The Intent model's status flow is documented in
[intent schema §3](./intent-schema.md#3-status-flow).

## 5. Stack mapping

The plan's suggested stack vs. this workspace's stack.

| Layer        | Plan suggests          | Workspace uses                                       | Match? |
|--------------|------------------------|------------------------------------------------------|--------|
| App          | Next.js, TypeScript    | Next.js 16 + TypeScript 5                            | yes    |
| API and jobs | NestJS or FastAPI      | Next.js BFF + API routes; (later) a mini-service for jobs | partial — jobs deferred |
| Data         | Postgres, Redis        | Prisma + SQLite (portable to Postgres); in-memory cache in v1 | partial — SQLite dev, Postgres prod; Redis deferred |
| Secrets      | Cloud KMS or Vault     | KMS interface stub; the DB stores only a reference id | yes (stub) |
| CEX          | CCXT                   | CCXT                                                 | yes    |
| Chains       | Alchemy + Helius       | Alchemy + Helius                                     | yes    |
| AI later     | Separate service, tool-called | Separate service, tool-called                | yes (planned) |

Notes:

- SQLite is used for local dev. The schema is portable to Postgres.
  The DB-stores-only-a-reference rule for secrets holds in both.
- Redis is deferred. v1 uses in-memory cache. Quotes and locks that
  the plan puts in Redis go in process memory for now; they will move
  to Redis when a second process needs them.
- Jobs (scheduled rebalance, daily snapshot) will eventually need a
  mini-service. v1 runs them inside the Next.js process via a queue
  stub.

## 6. Security minimums

Quoted verbatim from §10 of the construction plan:

- Read-only keys for Observe. Trade keys without withdrawal for
  Confirm and Rules.
- Withdrawal allowlist, if a venue forces the scope, contains only
  addresses the user already controls.
- Secrets in KMS. Database stores a reference, not the secret.
- Signer in a separate service account. AI service has no IAM path to
  it.
- Idempotent order client. Every intent has an id; retries cannot
  double-fill.
- Anomaly halt: price dislocation, failed oracle, or signer error
  stops the book and pages the owner.

## Related

- [Non-custody statement](./non-custody-statement.md)
- [Mandate reference](./mandate.md)
- [Intent schema reference](./intent-schema.md)
- [Build phases](./build-phases.md)
- [Glossary](./glossary.md)
