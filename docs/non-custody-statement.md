# House — Non-custody statement

This is the Phase 0 deliverable named in the construction plan:
"Ship a written non-custody statement: the app does not hold seeds, cannot
withdraw to an address outside the user's allowlist, and trade keys are
scoped."

It is a statement, not a pitch. Short sentences only.

## 1. What House is

House is a bankroll operating system for one owner. It answers four
questions every day: what is held, what it is worth, whether the mix
still matches the chosen strategy, and what action is allowed next.

House is not a service for the public in v1. The owner is the user. The
product is the bankroll. See the [mandate reference](./mandate.md) for
the objective and risk budget that govern the book.

## 2. What House never holds

House never holds:

- Seed phrases. Not at rest, not in transit, not in memory.
- Withdrawal-enabled keys. Trade keys are scoped to trade-no-withdraw
  at minimum; withdrawal is not in the scope the app can grant.
- Custody of user funds. Funds stay on exchanges and in self-custody
  wallets the user already controls.

Trade keys are scoped. They are never stored in the app database in
clear text. The database stores only a reference id pointing at a KMS
entry. The KMS, not the app, is the secret store.

## 3. What House cannot do

The following actions are owner actions. They are not available to the
app, to the policy engine, or to the AI proposer. They remain owner
actions per §9 of the construction plan ("What 'be the house' is
allowed to do"):

- Withdraw to an address outside the user's allowlist.
- Add a venue.
- Raise leverage.
- Whitelist a new asset.
- Change the ethics list.
- Send funds to a new address.

A withdrawal allowlist, where a venue forces the scope, contains only
addresses the user already controls.

## 4. Trade key scope ladder

Keys are scoped by mode. Wider scope requires a fresh confirmation and
a tighter permission grant. The grant ladder (quoted from §2 of the
construction plan):

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

In short:

- Observe — read-only.
- Confirm, Rules — trade-no-withdraw.
- House — session key, scoped by the same caps as Rules.

## 5. Kill switch

The kill switch revokes session keys and disables trade permission on
exchange keys **without deleting history**. This is quoted from §3 of
the construction plan.

Concretely:

- Session keys are revoked at the signer.
- Trade permission on exchange keys is disabled.
- Read-only observation continues. The book keeps marking.
- The decision log is append-only. Nothing is erased. The kill event
  is itself a logged entry.

The owner holds the kill switch. The decision log remains exportable
for the beneficiary after a kill. See [architecture](./architecture.md)
for the data model.

## 6. AI boundary

The AI is a proposer. The policy engine is the only component allowed
to emit an executable intent. The AI has no network path to the
signer. Model output is never executed as text.

Concretely:

- The AI reads book, mandate, and market features.
- The AI returns intents in the fixed [intent schema](./intent-schema.md)
  and a short rationale.
- The policy engine accepts, resizes, or rejects each intent.
- Only the policy engine's accepted intent reaches the signer.
- The signer is in a separate service account. The AI service has no
  IAM path to it.
- Model output is never executed as text. Only the intent schema is
  executable.

If the AI is down, the account falls back to Rules or Confirm, never
to an open order book.

## 7. Jurisdiction note

Confirm and Rules can be built as a user-operated tool. House mode, if
it allocates for other people, is portfolio management. Get counsel
before offering House mode to anyone but the owner.

Per §8 Phase 0 of the construction plan:

> 1. Confirm mode and Rules mode can be built as a user-operated tool.
> 2. House mode, if it allocates for other people, is portfolio
>    management. In the EU that is a MiCA crypto-asset service. In the
>    US, discretionary advice on assets that are securities pulls in the
>    Advisers Act. Get counsel before offering House mode to anyone but
>    the owner.

v1 is owner-operated. This is also listed in §12 (Risks to design
around) as the guard against regulatory scope creep: "The moment the
product allocates for other people, or markets itself as management,
the tool becomes a service. Keep v1 owner-operated."

## Related

- [Mandate reference](./mandate.md)
- [Intent schema reference](./intent-schema.md)
- [Architecture map](./architecture.md)
- [Build phases](./build-phases.md)
- [Glossary](./glossary.md)
