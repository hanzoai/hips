---
hip: 0139
title: Capability
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Active
created: 2026-08-20
requires: HIP-0106, HIP-0119, HIP-0127, HIP-0128, HIP-0135
---

# HIP-0139: Capability

## Abstract

A capability is one thing the cloud does, and it has one name. That name is the
Go package, the plugin binary, the address prefix, the tag in the served
document, the class in every generated client, the tool an agent is shown, the
command group in the CLI, the page on the documentation site, and the HIP that
specifies it. Nine projections, one object; a reader who knows the name in any
one of them knows it in all nine.

This HIP defines the object, the grammar of its name, the addresses it may
answer at, and the gates — in `hanzoai/cloud`, `hanzoai/openapi` and this
repository — that refuse a projection disagreeing with the others. Everything
every other capability HIP takes for granted is stated here once.

## Motivation

The cloud measured on 2026-08-20 (`python3` over `hanzoai/cloud` `openapi.yaml`,
grouping operations by tag and by the `x-app` that serves them): 2,473
operations, 123 apps, 183 tags. The tag was the first path segment and the app
was the binary, and the two were called orthogonal on purpose — "a tag is a path
prefix, an app is a mount, and they are only sometimes one word" (`openapi/weave.go`).

Only sometimes is the defect. Twenty-seven apps answer at more than one top-level
address: `visor` at `/v1/machines`, `/v1/gpus`, `/v1/clusters`, `/v1/fleet`,
`/v1/k8s` and `/v1/compute`; `platform` at eight. Fifteen addresses are answered
by more than one app: `/v1/billing` is forty-two operations of `commerce` and
nine of `billing`; `/v1/s3`, `/v1/search` and `/v1/vector` are each split three
ways. The taxonomy a reader is shown (`capabilities.yaml`) had to carry 191
names to group 183 tags, thirteen of which — `wecom-bot`, `install-patch`,
`dev-bridge`, `query_multiple` — are routes one embedded router happens to
register at the root, not things anyone would call a product.

The cost lands on every projection at once. A generated client offers
`MachinesApi` and `GpusApi` for one subsystem and `BillingApi` for two. An agent
is shown a tool named for a path and a second tool named for the same path's
neighbour. A specification wave that wrote fifty HIPs against the 191 names
wrote ten of them for addresses that are a single route of some other app.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The object and its projections

A capability is a Go package under `apps/` in `hanzoai/cloud` that returns a
`*zip.App` (HIP-0106 §2). Its name is the package's directory name. The
following MUST all equal that name:

| projection | where |
|---|---|
| the plugin binary | `plugin/<name>`, in bijection with the app (HIP-0106 §9) |
| the address prefix | `/v1/<name>` — every route the app serves, §3 |
| the tag | `tags: [<name>]` on every operation the app serves, §4 |
| the client class | `<Name>Api` in every language `hanzoai/openapi` generates |
| the tool | the subsystem tool `POST /v1/mcp` lists, its operations in the `op` enum |
| the command group | `hanzo <name> …` |
| the page | `docs.hanzo.ai/<name>` |
| the specification | the one HIP whose front matter reads `capability: <name>` |

A projection is never written by hand. Each is a function of the served
document or of the app's own registry, and a hand-written copy of any of them is
the defect HIP-0106 §4.2 names.

### §2 The name

1. One word, lowercase ASCII, the noun people say for the thing. `books`, not
   `accounting-ledger`; `tel`, not `telephony-gateway`.
2. Plural when `/v1/<name>` is a collection and `/v1/<name>/{id}` is one of
   them (`agents`, `keys`, `wallets`). Singular when it is a faculty
   (`ai`, `search`, `billing`).
3. No compound words. A hyphen or an underscore in a name is a refusal at
   the gate.
4. No two capabilities whose names differ only in number. `bot` and `bots`
   are one capability; which word it keeps is decided by rule 2.
5. An abbreviation is a word only when it is the word people say: `ai`,
   `iam`, `kms`, `dns`, `crm`, `seo`, `mq`, `o11y`, `rpc`, `s3`, `kv`, `sql`,
   `sbom`, `lsp`, `x402`. A new one MUST be argued for in the capability's HIP.

### §3 The address

1. Every route a capability serves MUST be under `/v1/<name>`. A second
   top-level address is a second capability or a misfiled route; it is never
   an alias.
2. Three address families are fixed by a protocol the cloud implements, not
   by this HIP, and are exempt from rule 1 exactly as far as the protocol
   reaches:
   - `/.well-known/*` — RFC 8615 fixes the root. `iam` serves OIDC discovery
     and JWKS there; `skills` serves agent-skill discovery there.
   - the OpenAI- and Anthropic-compatible wire — `/v1/chat/completions`,
     `/v1/completions`, `/v1/embeddings`, `/v1/messages`, `/v1/models`,
     `/v1/images/*`, `/v1/audio/*`, `/v1/videos/*`, `/v1/responses`,
     `/v1/rerank`. Every vendor SDK hard-codes these paths. They belong to
     `ai` and to no other capability.
   - `/v1/admin/<name>/*` — the operator's view of `<name>`, served by
     `<name>`. Its audience is the operator (HIP-0135), and the public
     projection drops it by address; the capability it belongs to is the
     second segment.
3. Nothing is served outside `/v1` except the families in rule 2 (HIP-0119 §2).
4. A path segment names a thing and the method says the verb (HIP-0128 §1).

### §4 The document

1. The tag on an operation is the capability that serves it — the value the
   weave stamps as `x-app` — and nothing else. The first path segment is the
   address axis and is read by the public rule (`openapi/public.go`) and by
   the gate in §5; it is not the tag.
2. An operation is public by the rule HIP-0135 and `openapi/public.go` state:
   under `/v1`, not the operator's, not a relay door, not a legacy spelling,
   and `ga` (§8).
3. Every operation a capability serves MUST be typed (HIP-0106 §4) or, where
   the response cannot be a value, declared with prose beside the route. An
   operation that is neither publishes an address nobody can explain, and the
   ratchet in §5.4 counts it.

### §5 The gates

Each gate is a ratchet: a committed file of what does not yet conform, which
may only shrink, checked by a test that fails on a line that should be gone
and on a defect that is not listed. A gate that has only ever passed has not
been shown to work (HIP-0106 §9).

1. **`hanzoai/cloud` `openapi/misfiled.txt`** — every (address, app) pair in
   the woven document where the first segment is not the serving app, after
   §3.2. One line per pair. `TestNoOperationIsMisfiled` refuses a pair the
   file does not carry and a line the document no longer has.
2. **`hanzoai/cloud` `plugin/gen-app-cmds`** — every app has a plugin and
   every plugin an app (HIP-0106 §9).
3. **`hanzoai/openapi` `capabilities.yaml`** — every tag the served document
   carries is grouped under one of nine domains, and no grouped name is
   unserved. `publish.py` refuses in both directions.
4. **`hanzoai/cloud` `openapi/floor.json`** — a capability's operation count
   may not fall without the commit that lowers it saying so.
5. **`hanzoai/hips` `capability-coverage.txt`** — every capability has
   exactly one HIP declaring it (`scripts/coverage.py`).

### §6 The HIP a capability carries

A capability HIP is Standards Track. Its front matter carries
`capability: <name>` and `requires: HIP-0139`. It states, each in its own
section where the template has one:

- what the capability is and the one store it owns, or that it owns none;
- every address it answers, with the operations typed and the ones declared
  and why each declared one cannot be a value;
- how a request becomes a tenant — which claim, what is refused (HIP-0026);
- what it meters, the unit and the price, and through which plane the debit
  lands — or that it is free, said in those words;
- the events it publishes on the bus and so delivers to a customer's
  webhooks (`/v1/webhooks`), each named `<name>.<noun>.<verb>`, or that it
  publishes none;
- what it emits to observability — the spans, the metrics and the log lines
  a customer can read back under `/v1/o11y` — beyond the request span every
  route already gets;
- its stage (§8);
- the upstream it derives from — every OSS project the capability forks,
  embeds or mirrors, each with its license and what of it survives in HEAD —
  or that it derives from none;
- what an attacker gets from the wrong implementation.

It does not restate §1–§5, and it names no count a gate already measures.
One capability, one HIP: a HIP that declares two names is two specifications
in one file and fails `coverage.py` CV005.

The HIP is also where a change to the capability is proposed. The order is
spec first: amend the HIP, land the code that implements it, and every
projection — the document, the clients, the tools, the commands, the pages —
regenerates from the code. A change that reaches the router without its HIP
is caught where drift always is: the projections move and the spec did not.

### §7 Resolving a misfiled pair

A line in `misfiled.txt` is closed one of three ways, and the store decides
which:

1. **Fold.** The address moves under the app: `/v1/machines` becomes
   `/v1/visor/machines`. This is the default. An app with one store is one
   capability however many nouns it answers for.
2. **Split.** The app becomes two, each with its own store and its own
   address. Permitted only along a store boundary — two apps sharing one
   store is the defect HIP-0106 names, and a split that creates it is refused.
3. **Rename.** The app takes the address's name when the address is the word
   people say and the package name is not (`link` → `links`, `plan` →
   `plans`). A rename is one commit: the directory, the plugin, the manifest
   row, the Makefile's `APPS`, and the frozen order test.

An address served by two apps is closed by fold into the one that owns the
root — or, where neither does, by the capability HIP deciding which one the
address belongs to. There is no fourth way and no alias.

### §8 Stage

A capability is `ga`, `beta` or `alpha`, declared once, in its manifest row
(`manifest.App.Stage`; absent means `ga`). The stage is a fact about the
product, not about the specification — a HIP's `status:` says whether the
text is settled, the stage says whether a customer is shown the thing.

1. Only `ga` operations are public. The weave stamps `x-stage` on every
   operation and the public rule (§4.2) drops anything that is not `ga`, so
   a `beta` capability is in no generated client, no tool list, no command
   group and no public page. It is still in the internal document.
2. The host answers **404** for a `beta` or `alpha` prefix unless the caller's
   org holds the flag named for the capability (`flags`, key `<name>`). Not
   403: a capability a customer has not been let into does not exist for
   them, and an existence oracle is what 403 would be.
3. A customer who holds the flag sees the capability in the console and may
   call it; the document they are served is the internal one filtered to
   what they hold.
4. Promotion to `ga` is one edit to the manifest row. The ratchets in §5
   apply at every stage; the stage decides who is shown the capability, never
   whether it has to conform.

The self-service cloud that launches is the `ga` set. What is not finished is
not hidden by being undocumented; it is declared `beta` and reached by flag.

## Rationale

The alternative is the one the cloud had: two axes, product and app, with the
document tagging by product and prose that explains the cases where they differ.
It is cheaper on the day a route lands and more expensive every day after,
because each projection has to carry the explanation again — in a class name, a
tool description, a sidebar, a HIP — and they do not carry it the same way.

Tagging by the owner rather than by the path was chosen because the owner is
the value every projection already reads (`x-app` is on every operation) and
the path is the value the gate then drives into agreement with it. The other
order — tag by path, ratchet the owner — would have the generated clients and
the HIP corpus follow a name that is about to change, twice.

## Security Considerations

A capability is also a tenancy boundary: the store it owns is opened by org
(HIP-0118), and the public rule decides by address which operations a customer
key may reach. A route misfiled under another capability's address inherits
that capability's audience; `/v1/admin/<name>` served at the wrong depth is the
concrete case — a pricing catalog the operator edits, offered as a customer
method because the address said `pricing` before it said `admin`. Rule §3.2
fixes the depth, and the gate in §5.1 is what keeps it fixed.

## References

- HIP-0106 — The Hanzo Plugin Contract
- HIP-0119 — Hanzo Service Conventions
- HIP-0127 — V8 · Open Edition — Architecture, Distribution & the Language Seam
- HIP-0128 — Resource Surface Standard
- HIP-0135 — What Is Public
- RFC 8615 — Well-Known Uniform Resource Identifiers

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
