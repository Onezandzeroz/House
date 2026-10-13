# House — Build phases

This document encodes the construction phases from §8 of the plan, the
"done when" criteria from §11, and the immediate next step from §13.
See also the [non-custody statement](./non-custody-statement.md), the
[mandate reference](./mandate.md), the [intent schema](./intent-schema.md),
and the [architecture map](./architecture.md).

## Phase 0 — Mandate and legal posture

**Duration**: 2 weeks.

**Goal**: Write the mandate schema and the product boundary before
any integration.

**Deliverables** (verbatim from §8 Phase 0):

- Confirm mode and Rules mode can be built as a user-operated tool.
- House mode, if it allocates for other people, is portfolio
  management. In the EU that is a MiCA crypto-asset service. In the
  US, discretionary advice on assets that are securities pulls in the
  Advisers Act. Get counsel before offering House mode to anyone but
  the owner.
- Ship a written non-custody statement: the app does not hold seeds,
  cannot withdraw to an address outside the user's allowlist, and
  trade keys are scoped.

The non-custody statement is the Phase 0 deliverable of record. It is
in [docs/non-custody-statement.md](./non-custody-statement.md). The
mandate reference is in [docs/mandate.md](./mandate.md). The intent
schema is in [docs/intent-schema.md](./intent-schema.md).

**Done when**: A paper intent can be accepted or rejected and
replayed. (From §11 "Mandate schema + decision log" slice. The full
slice maps to Phases 0+2 together; Phase 0 alone owns the schema and
the boundary that makes the replay meaningful.)

## Phase 1 — Observe

**Duration**: 4 to 6 weeks.

**Goal**: The product is useful before it can trade. Aggregate a book
the user already has.

**Deliverables** (verbatim from §8 Phase 1):

- Email login, one book, manual wallet addresses, read-only exchange
  keys.
- Balances across two venues and two chains. Suggested first set: one
  major CEX, Ethereum, and one L2.
- Mark to the book currency, simple cost basis, daily snapshot.
- Drift view against a hand-entered target. No orders.

**Done when**: Two venues and two chains agree with a manual check
within a stated tolerance. (From §11 "Read-only book" slice.)

## Phase 2 — Policy and paper book

**Duration**: 4 weeks.

**Goal**: Implement the policy engine and run it against the live
book without sending orders. This is the contract the AI will later
satisfy.

**Deliverables** (verbatim from §8 Phase 2):

- Target weights, drift bands, turnover cap, ethics exclude list.
- Paper intents with expected cost. Show the user what would have
  happened.
- Decision log and mandate versioning. Export to CSV.

**Done when**: A paper intent can be accepted or rejected and
replayed. (From §11 "Mandate schema + decision log" slice.) This is
also the gate §13 names: do not connect a trade key until the paper
decision log has been reviewed for a week.

## Phase 3 — Confirm mode

**Duration**: 4 to 6 weeks.

**Goal**: First live execution. Small size, allowlisted venues, user
signs every batch.

**Deliverables** (verbatim from §8 Phase 3):

- CEX orders through CCXT with trade permission and withdrawal
  disabled.
- On-chain swaps through a known router, user signs in their wallet.
  No session keys yet.
- Slippage cap, min notional, and a daily notional ceiling.
- Fill reconciliation back into lots.

**Done when**: A capped rebalance fills and the lot ledger matches
the venue. (From §11 "Confirm batch" slice.)

## Phase 4 — Rules mode

**Duration**: 4 weeks.

**Goal**: Automation without an LLM. If this is not reliable, House
mode is not ready.

**Deliverables** (verbatim from §8 Phase 4):

- Session keys or CEX trade keys with a notional and asset allowlist.
- Scheduled and drift-triggered rebalance. Staking only on a named
  protocol.
- Kill switch tested, including a forced fail of the signer.

**Done when**: A drift event trades, and the switch stops the next
one. (From §11 "Rules + kill switch" slice.)

## Phase 5 — AI house service

**Duration**: not fixed in the plan; staffed only after Phase 4 is in
production (see §11 build order for a small team).

**Goal**: Build only after Rules mode has a clean decision log. The
service reads book, mandate, and market features. It returns intents
and a short rationale. Policy accepts or resizes. The signer is
unchanged.

**Deliverables** (verbatim from §8 Phase 5):

- Start with a constrained planner: rank the allowed universe, propose
  weights, do not invent assets.
- Eval set: replay historical books and reject any intent the policy
  would have rejected. Track regret versus the rules baseline.
- House switch is per book, time-boxed, and reversible. Default expiry
  7 days until the user extends it.
- Model output is never executed as text. Only the intent schema is
  executable.

**Done when**: The model can only emit the intent schema, and policy
rejection rate is measured. (From §11 "AI adapter" slice.)

## Phase 6 — Beneficiaries and reporting

**Duration**: not fixed in the plan.

**Goal**: Named viewers, scheduled statements, and a shareable
decision log. Still one owner of the kill switch. Multi-sig ownership
of the mandate can wait.

**Deliverables** (verbatim from §8 Phase 6):

- Named viewers.
- Scheduled statements.
- Shareable decision log.
- Multi-sig ownership of the mandate can wait.

**Done when**: a beneficiary receives scheduled statements and a
read-only view of the decision log, while the owner remains the sole
holder of the kill switch. (Paraphrased from §8 Phase 6; §11 has no
slice for this phase.)

## Build order for a small team

From §11 verbatim:

> Two engineers can ship Observe and the paper policy. A third is
> useful once live orders exist. Do not hire for the AI seat until
> phase 4 is in production.

## Immediate next step

Quoted verbatim from §13:

> Write the mandate object and the intent schema, and stand up Observe
> against one exchange and one wallet. Do not connect a trade key
> until the paper decision log has been reviewed for a week. The AI
> brief can be written in parallel as an interface document. It should
> not be staffed until Rules mode has survived a kill-switch drill.

The mandate object is specified in [mandate.md](./mandate.md). The
intent schema is specified in [intent-schema.md](./intent-schema.md).
The Observe target is one exchange and one wallet — a strict subset
of the Phase 1 deliverable. No trade key is connected until the paper
decision log from Phase 2 has been reviewed for a week.

## Related

- [Non-custody statement](./non-custody-statement.md)
- [Mandate reference](./mandate.md)
- [Intent schema reference](./intent-schema.md)
- [Architecture map](./architecture.md)
- [Glossary](./glossary.md)
