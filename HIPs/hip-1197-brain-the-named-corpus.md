---
hip: 1197
title: Brain — The Named Corpus
author: Hanzo AI
type: Standards Track
category: Core
capability: brain
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139, HIP-1211, HIP-1260
---

# HIP-1197: Brain — The Named Corpus

## Abstract

A brain is a named corpus with a fixed retrieval, scoped to one organization:
sources flow in, one embedding model indexes them, and a query answers from that
brain and from no other. An organization has several. An agent names the ones it
may read, and a run that names anything else is refused rather than widened.

`brain` is the capability `knowledge` under a name that fits its object, and it
takes the corpus surface that answers under `ai`. It serves nothing today. Nine
operations answer at `/v1/kb`, ten at `/v1/ai/stores`, five at `/v1/rag`, one at
`/v1/docs/ingest`, and `/v1/brain` has none. Everything §4 addresses is proposed.

## Motivation

One organization, one corpus is the shape that ships. The vector namespace is a
function of the organization and nothing else — `"kb_" + namespace.Sanitize(org)`
(`apps/knowledge/index.go:108`) — so a support agent, a sales agent and a legal
agent read one pile. Project and kind narrow a query inside it
(`apps/knowledge/subsystem.go:108`), and a filter is not a boundary: a query that
drops the predicate reads everything. There is nowhere to put a different
embedding model, a different chunk size, or a statement of what the corpus is
for.

The plural object exists at another address. `object.Store` in `hanzoai/ai` is
keyed `(Owner, Name)` and carries its own embedding, split, search and model
providers (`object/store.go:52`); ten public operations answer at
`/v1/ai/stores`; a chat completion selects one per request
(`ai/controllers/chat_retrieval.go:47`) and a person can be pinned to one
(`ai/controllers/zap_chat-graph-crud.go:189`).

What nobody can do is give an agent a brain. The whole agent record is name,
model, instructions, description, tools, execution mode, schedule, compute ref
and service account (`apps/agents/agents.go:515-524`). Nor can an agent find out
what exists to name: `ai` contributes one entry to the agent door's catalog, a
health read, so none of its 208 operations is reachable from a run.

Two capabilities each hold half of one object. This HIP puts the halves at one
address under one name.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 What a brain is

A brain is the pair `(org, name)` and six fields:

| field | meaning |
|---|---|
| `name` | the identifier, chosen by the caller, unique in the organization |
| `purpose` | prose saying what this brain is for |
| `model` | the embedding model, checked against the served catalogue |
| `chunk` | split size and overlap |
| `default` | exactly one brain per organization carries it |
| `state` | whether the brain answers queries |

`purpose` has one job: it is how a brain is CHOSEN. A person reads it in a list
and an agent reads it when deciding which brain to name. It MUST NOT double as
the wording of an answer — how an answer reads belongs to whatever composes the
answer, and a field with two jobs drifts into serving neither.

`model` is fixed at creation and MUST NOT change. One model indexes and queries a
brain, which is what makes the dimensions agree (`apps/knowledge/index.go:50`); a
brain holding two generations of vectors answers from whichever half happens to
match, and nothing on the wire says which. Changing the model is a new brain.

What a brain does NOT carry is a chat surface's presentation — an avatar, a
welcome, a theme, a footer. Those decide how a widget looks, not what a query
retrieves. They belong to whatever renders the widget.

A brain is a boundary, not a view. Two brains never share a vector namespace
(§6), so "read only the support corpus" is enforced by which collection is
opened, not by a predicate a query may omit.

### §2 The name

#### §2.1 New capability, or what `knowledge` becomes

It is what `knowledge` becomes. The vocabulary gains no name.

The rename is for meaning, which HIP-0139 §2.2 permits — the rule it states bars
a rename for NUMBER alone. The meaning that changes is the key. `knowledge` owns
a store keyed by the organization; `brain` owns one keyed by `(org, name)`. A
capability whose store gains a key is a different capability, and the word
`knowledge` names the content of the pile rather than the several configured
things that hold it.

The rename alone would buy the word and none of the meaning, because renaming
`kb_<org>` changes nothing about how many corpora an organization has. So the
rename is one of two moves and neither works alone. The second is a HIP-0139 §7.2
split: the corpus surface leaves `ai` along the store boundary (§3.2), which is
what supplies the plurality. The commit that lands the rename also lands the
split; a rename that shipped first would publish `/v1/brain` serving one corpus,
which is the misdescription this HIP exists to avoid.

HIP-0139 §7.3's rename moves an app to its ADDRESS's name. This one moves an app
to its OBJECT's name, and the address follows: `/v1/kb` folds to `/v1/brain`
rather than to `/v1/knowledge`, closing `openapi/misfiled.txt` line `/v1/kb
knowledge` in one move instead of two.

One capability, one HIP (HIP-0139 §6). When the rename lands, HIP-1260 carries
`status: Superseded` and `superseded-by: HIP-1197`, because a HIP declaring a
capability the vocabulary no longer carries fails `coverage.py` CV006. The same
commit adds `brain` to `hanzoai/openapi` `capabilities.yaml` under the `data`
domain and removes `knowledge`, because that gate refuses in both directions
(HIP-0139 §5.3). Until that commit, this HIP's `capability: brain` names
something nothing serves, and CV006 is the check that says so.

#### §2.2 Why `brain` and not `corpus`

`corpus` is the exact technical term and it is the wrong one twice. It understates
the object — a corpus is text, while this thing also fixes the embedding, the
split and the purpose — and nobody outside linguistics says it. HIP-0139 §2.1
asks for the noun people say, which is why the accounting capability is `books`.
People say "the brain my agent reads from".

`brain` is one lowercase word, no compound, singular, and not an abbreviation, so
§2 rules 1 through 5 are satisfied on their face.

#### §2.3 The two senses already in use

The word is load-bearing in `hanzoai/cloud` twice, and neither collides.

The first is the model that narrates: "the AI Ask brain" (`apps/books/ask.go:3`),
"the ONE agent brain" (`apps/integrations/channel.go:176`). That sense names a
model doing inference, which is `ai` and `agents`. It appears in package comments
and in no projection — no binary, address, tag, class, tool, command or page of
`books` or `integrations` is called brain — so HIP-0139 §1's nine projections
stay in bijection.

The second is `split-brain`, a failure mode in room eviction
(`apps/team/collabws.go:342`) and in the fast-forward-only import guard
(`apps/git/github_import.go:418`). It is a hyphenated phrase naming a condition,
not a name; HIP-0139 §2.3 bars a hyphen from a capability NAME and says nothing
about English.

The residual cost is that a reader meeting "brain" in prose must now ask which
sense. That is paid once, in this section, and the capability's sense is the one
any projection carries.

### §3 The boundary

Five names sit near this object. Only `knowledge` and `index` are capabilities;
`memory` and `rag` are addresses `ai` answers at, and `vector` is two operations
`product` owns (`openapi/misfiled.txt` lines `/v1/memory ai`, `/v1/rag ai`,
`/v1/vector product`). Each is settled below, normatively.

| name | operations | owner after this HIP |
|---|---|---|
| `knowledge` | 9 at `/v1/kb` | `brain`, renamed and folded (§2.1) |
| `rag` | 5 at `/v1/rag` | `brain` (§3.2) |
| `memory` | 7 at `/v1/memory` | `ai`, at `/v1/ai/memory` (§3.3) |
| `index` | 17 at `/v1/index` | `index` (§3.4) |
| `vector` | 2 at `/v1/vector` | `product`, at `/v1/product/vector` (§3.5) |

#### §3.1 `knowledge` is not a peer

There is no `brain`-and-`knowledge` boundary to draw, because there is one
capability. Its nine operations are the ones §4 re-addresses, and its default
instance is the brain every organization has without creating one.

#### §3.2 `rag` is a technique, not a thing

`brain` owns the five operations at `/v1/rag` and the one at `/v1/docs/ingest`.
They write and read a named, caller-selected store — the index name is
`{owner}-{store}-docs` (`ai/object/search_docs.go:144`), the store default is
`rag-files` (`ai/object/rag.go:48`), and both the embed and query request types
carry `Store`. That store is a brain, and a file filter over one brain is a
query, not a second capability.

This is the store boundary HIP-0139 §7.2 requires a split to run along, and it
amends HIP-1211's fold of `/v1/ai/rag` and `/v1/ai/rag/ingest`: a surface follows
the store it writes, and the store is leaving. `rag` MUST NOT survive as an
address. It names a method rather than a thing a customer can point at, and
HIP-0139 §3.1 has no room for a second top-level address for one capability.

After the split `ai` MUST NOT open a brain's stores directly. Retrieval inside a
chat completion is a call into this capability with the caller's organization
already established — the shape `search` uses for the in-process door
(HIP-1147) — because two apps sharing one store is the defect HIP-0106 names and
a split that leaves one behind is refused.

The selector on the model wire names a brain and MUST spell it `brain`, in both
the header and the body form (`ai/controllers/chat_retrieval.go:33-51`). A
capability is one word in every projection; an extension field spelling it
differently is a second name for one object.

#### §3.3 `memory` stays with `ai`, and the reason is tenancy

`/v1/memory`'s seven operations are `ai`'s and fold to `/v1/ai/memory` (HIP-1211).
They MUST NOT come to `brain`, and `brain` MUST NOT hold a per-person scope.

The tenancy differs, and tenancy is a boundary rather than a preference. A memory
is keyed `(org, userId)` and that pair is taken only from the verified credential
(`ai/controllers/memory.go:15-26`, `:57`); a brain is keyed `(org, name)` and the
name is a caller's choice. A store where one column is a person and a store where
one column is a chosen name are not one store, and merging them would put a
caller-chosen value where a principal-derived one belongs.

The kinds inside a brain include `memory`, and that is not a contradiction: what
an agent files for the organization is the organization's, indexed beside the
wiki page a person wrote (`apps/knowledge/kb.go:54`). One question decides which
store a memory belongs in — **who may read it back**. If the answer is the
organization, it is a brain document. If the answer is one person, it is `ai`'s.

#### §3.4 `index` is an engine, `search` is a door

`index` stays whole. It is one encrypted store with the organization as a column
on every query and an index as a row (HIP-1132), which makes it a lexical ENGINE
rather than a corpus. `brain` MUST NOT open a lexical index of its own; where a
brain needs lexical recall it uses `index`, and where a caller wants both legs
fused with per-leg provenance it uses `POST /v1/search` (HIP-1147).

`search` stays a door and owns no store. Its request gains a `brain` field, since
the semantic leg it fuses is now plural; absent, the leg reads the organization's
default brain, by §5's rule and no other.

#### §3.5 `vector` and `embeddings` are not candidates

`vector` is not a capability and MUST NOT become one. The two operations at
`/v1/vector` are read-only dashboard projections that `product` serves
(`apps/product/product.go:163`, `:252`), and the line `/v1/vector product` closes
by fold into `product`, not into `brain`. The word names an engine the platform
runs; a brain names the corpus, and the engine underneath it is an implementation
this capability does not publish.

`embeddings` is one operation on the vendor-compatible wire. HIP-0139 §3.2 fixes
it to `ai` because every vendor SDK hard-codes the path. It does not move.

### §4 The address

Every route below is PROPOSED. None is served.

The capability answers under `/v1/brain`, and the root IS the collection of
brains: a capability whose object is its own resource does not say the noun
twice.

| operation | what it is |
|---|---|
| `GET /v1/brain` | the brains this run may read, each with its purpose |
| `POST /v1/brain` | create one |
| `GET /v1/brain/{brain}` | read one |
| `PATCH /v1/brain/{brain}` | change purpose, chunk, default or state |
| `DELETE /v1/brain/{brain}` | delete one, and its collection with it |
| `POST /v1/brain/{brain}/search` | retrieval, optionally narrowed by project, kind or file |
| `POST /v1/brain/{brain}/documents` | ingest one document |
| `DELETE /v1/brain/{brain}/documents/{document}` | remove one |
| `POST /v1/brain/{brain}/import` | ingest an archive |
| `GET /v1/brain/{brain}/graph` | the render projection |
| `GET /v1/brain/connectors` | the organization's connectors, each naming its brain |
| `GET /v1/brain/connectors/catalog` | the connectors that can be connected |
| `GET /v1/brain/connectors/{provider}/connect` | start authorization |
| `GET /v1/brain/connectors/{provider}/callback` | finish authorization |
| `POST /v1/brain/connectors/{provider}/sync` | pull now |
| `DELETE /v1/brain/connectors/{provider}` | disconnect |
| `GET /v1/admin/brain` | the operator's view across organizations (HIP-0139 §3.2) |

Every operation is typed (HIP-0106 §4) except `import`, whose body is the upload
itself — an archive, an XML document or a JSON export chosen by `?format=` — and
therefore cannot decode as a typed input (`apps/knowledge/import.go:129-150`). It
is declared with prose beside its route. The ten operations arriving from
`/v1/ai/stores` answer an untyped envelope today because the module owns their
handlers; a surface that leaves the module loses that reason, so they MUST be
typed on arrival.

A connector is per-organization and NAMES the brain it feeds. It is not per
brain: one authorization to a third-party workspace is one credential, and
re-authorizing per brain would multiply a customer's consent screens for nothing.
That is why the connector routes carry no `{brain}` segment — and why the
callback carries none either. A redirect URI is registered ahead of time and
cannot hold a caller-chosen segment, so the brain rides in the HMAC-bound state
beside the organization (`apps/knowledge/connectors.go:16`), where a callback
cannot choose it.

`connectors` is therefore a reserved word: no brain may be named it. That is the
whole reserved set, and a name outside `^[a-z0-9][a-z0-9-]{0,63}$` is refused.

### §5 Selection, and refusal

An agent carries `brains`, a list of names it may read. `POST /v1/agents` and its
view and patch inputs each gain the one field.

1. Absent means the organization's default brain. It does NOT mean every brain.
   An empty configuration takes the narrow reading; a widening is always written
   down.
2. `["*"]` means every brain in the organization, said explicitly. It is the same
   spelling `Tools` uses for the same idea (`apps/agents/store.go:63`), because
   there is one way to say "whatever this organization has".
3. A retrieval request MAY name one brain. It MUST be one the run may read.
4. Where a request names none, the run reads its agent's first brain, and a run
   with no agent reads the organization's default.

The list cannot ride on `Tools []string`. The agent door publishes one tool per
CAPABILITY with the operation as an argument, because the flat list measured
1,189 tools in 977,636 bytes and clients keep 128 (`fleet/grouped.go:16-36`).
Every brain would therefore be the same tool name, and the field's value space is
capability names.

Resolution happens in ONE function, which takes the organization and the
requested name and returns the brain or refuses. Applying the default and
admitting a caller's choice are one decision, and splitting them is how a surface
ends up trusting a name nobody checked — the reason `ai`'s store resolver is one
function (`ai/object/search_docs.go:191`). Asking for the default by name yields
the default, since it selects the identical collection.

**A brain is never substituted.** Three failures, three distinct answers:

- The name is not one this run may read — it does not exist, it belongs to
  another organization, or it is outside the agent's list. **404**, and the three
  cases are indistinguishable. A run's view of the organization's brains IS its
  list, so `GET /v1/brain` and a named read agree, and the name space is not an
  oracle. Never 403: that would confirm a brain exists, which is the existence
  oracle HIP-0139 §8.2 refuses for the same reason.
- The brain resolves and its index is unreachable. The answer is empty, carries
  `degraded: true`, and names the brain
  (`apps/knowledge/subsystem.go:124`). A caller continues without context rather
  than failing the turn.
- The brain resolves and holds nothing matching. An ordinary empty answer, not
  degraded. "No documents" and "the index is down" MUST NOT read the same.

Falling back to the default on an unresolvable name is the one behaviour this
section forbids outright. It turns a typo into a widening: an agent configured
for the support corpus silently reads the organization's everything, answers
plausibly, and nothing in the response says so.

### §6 Tenancy

Three levels. Two are boundaries and one is a predicate, and the difference is
the whole of this section.

1. **Organization — a physical boundary, never a field.** Resolved from the
   validated principal (`principal.Acting`, `apps/knowledge/subsystem.go:141`)
   and refused when absent (HIP-0026). It is never a path segment, never a query
   parameter and never a body field. `GET /v1/brain/{brain}` carries one
   identifier and it is the brain's; an operation addressing a corpus by
   `{owner}/{name}` puts half the tenancy key on the wire.
2. **Brain — a physical boundary, and a field.** The name is the caller's choice
   and is resolved WITHIN the organization (§5). The protected thing is the PAIR,
   which is why one function sees both halves.
3. **Project — a predicate, not a boundary.** A project narrows a query inside
   one brain, as the indexed payload key it already is
   (`apps/knowledge/index.go:156`). It MUST NOT select a brain and MUST NOT widen
   across brains. Where a project's documents must be unreadable by the rest of
   the organization, that is a brain, not a project: a predicate protects nothing
   against a query that omits it.

The vector namespace is derived from the pair through one function that MUST be
injective in the pair. Concatenating a sanitized organization with a chosen name
is injective only when the join character is barred from the half the caller
chooses — otherwise `(a, b_c)` and `(a_b, c)` name one collection. With `_`
joining and `_` outside the name alphabet (§4), the last `_` always delimits, and
the organization's own underscores are safe because the organization is not a
caller's input. The organization half stays injective under the existing
sanitizer, which hash-suffixes what would otherwise collide
(`apps/knowledge/index.go:100-107`).

Every point ALSO carries the organization and the brain in its payload, and a
query filters on both. The two boundaries are independent on purpose: a
collection-name defect cannot leak, because the payload filter still excludes
foreign points, and a payload defect cannot leak, because the collection was
never opened.

Every brain has a collection, the default included. There is no shorter,
brain-less name for a collection to collide with.

### §7 The store, and there is none

This capability owns no store, and MUST NOT open one.

The documents are the framework engine's, as one module. Three kinds are indexed
— `page`, `memory`, `source` — and two are stored and not indexed: `connector`,
which holds a KMS path and never a token, and `link`, which carries no text
(`apps/knowledge/kb.go:64`, `:56-57`). The kinds a request names are the bare
nouns, because the capability is already the namespace and a prefix inside it
names the same thing twice. Any new kind MUST enter as a framework kind, so the
one indexing hook indexes it.

The brain RECORD is a framework document of its own kind, and it is not indexed —
configuration is not corpus.

The vectors are the shared vector store's, one collection per brain, written only
through the one index path (`apps/knowledge/index.go:22-27`). Both stores are
owned elsewhere. Deleting this subsystem loses a door and a configuration, not a
customer's documents.

### §8 What does not exist

`/v1/brain` has no operations. Six things are missing, and they are the whole of
what this proposal costs to build:

1. **The second axis.** The collection is a function of the organization alone
   (`apps/knowledge/index.go:108`), and no point carries a brain.
2. **The record.** There is no brain kind. The configuration that would fill it
   sits on `object.Store` in `hanzoai/ai` (`object/store.go:52`), reachable as a
   store and not as a brain.
3. **A list an agent can call.** `GET /v1/ai/stores` and `GET
   /v1/ai/stores/names` are public, and `ai` contributes one entry — a health
   read — to the agent door's catalog, so an agent cannot discover what to name.
4. **The field on the agent** (§5). `createAgentIn` carries nine fields and none
   of them names a corpus (`apps/agents/agents.go:515-524`).
5. **The field on a retrieval.** `searchIn` is query, limit, project and kinds
   (`apps/knowledge/subsystem.go:108`).
6. **The resolver** (§5). `knowledge` has no analogue of `ai`'s.

Nine operations at `/v1/kb` are served, public and `ga`, and eight of the nine
are reachable from the agent door. Everything in §4 that is not one of those nine
is a proposal.

### §9 Money, events, telemetry, stage, upstream

The capability is **free**, in those words (`plugin/knowledge/main.go:26`,
`Price: cloud.Free`). The one debit it causes lands through `ai`: embeddings for
index and query take the metered gateway path with the same model on both sides.
Storage of a document is the framework's, and the vectors ride the platform's own
store.

It publishes **no events** on the bus, so a customer's webhooks receive no
`brain.*` delivery.

Beyond the request span it registers nothing. Its provenance is on the wire
instead: every answer names the brain it read, so an answer from the wrong corpus
is visible in the payload rather than only in a trace, and a degraded answer says
which brain degraded (§5).

Its stage is **`ga`** on the commit that lands it. The address serves what
`/v1/kb` serves, which is public and `ga` today, and demoting a live surface
behind a flag so a new name can be reached is a regression a customer pays for.
The fold is what makes `ga` correct here: `/v1/brain` is not a new product, it is
where an existing one answers.

It derives from **no** upstream project: none is forked, embedded or mirrored.
The import formats are implemented from their public shapes in pure Go
(`apps/knowledge/{obsidian,roam,evernote,notion}`).

## Rationale

The alternative is to add `brain` beside the five names already here. It is the
cheaper commit and the more expensive year: a customer would then have a corpus
under `/v1/kb`, a corpus under `/v1/ai/stores`, a corpus under `/v1/rag`, and a
sixth word for the same object — four addresses, one thing, and no rule saying
which to call. A name is only worth adding when it removes names. This one
removes four from the address axis and adds one, and leaves the capability
vocabulary the size it is.

The second alternative is to leave the object in `ai` and let an agent select a
store by header. That is what a chat completion does, and it fails for an agent
in two ways: a header is not a configuration, so nothing durable says which
corpora an agent may read; and `ai` publishes one entry to the agent door, so an
agent cannot enumerate what a header could name. Selection has to sit where the
agent record sits and where the door can reach.

Making a brain a boundary rather than a saved filter is the choice with a cost:
one collection per brain instead of one per organization. It buys the property
that "this agent reads only support" survives a query that forgets a predicate,
which a saved filter never does. The estate already pays this cost once, per
organization, for the same reason.

## Security Considerations

A brain is an organization's institutional memory, cut into pieces that agents
select by name. The wrong implementation leaks either a whole company or the one
piece a company deliberately walled off.

**The pair is the boundary.** A resolver that reads the organization half off the
wire hands one tenant another's corpus in one request. The organization comes
from the validated principal only; the name is the only identifier a caller
supplies, and §6 keeps the organization out of the path.

**The derivation must be injective in the pair.** A join that is spellable inside
the caller's half folds two brains onto one collection — inside an organization
if it is lucky, across organizations if it is not. The name alphabet in §4 and
the injective organization encoder are the two facts that close it, and the
payload filter on both keys is the independent second boundary that holds if
either is wrong.

**An unresolvable name must refuse, not widen.** Substituting the default is a
disclosure that looks like a working system: the answer is fluent, the documents
are real, and nothing says the corpus was the wrong one. This is why §5 forbids
it outright and why the refusal is 404 rather than 403 — a distinguishable
refusal turns the name space into an oracle for what a neighbouring organization
has built.

**Retrieved text is data, never instructions.** Everything indexed reaches an
agent's context. A brain returns documents and MUST NOT execute them, and in
particular retrieved text MUST NOT choose the next brain: selection comes from
the agent record and the request, both of which are outside the corpus.

**Connector tokens are third-party credentials.** The connector document holds
the KMS path and non-secret metadata, never the token
(`apps/knowledge/connectors.go:13-15`), and the authorization state is HMAC-bound
to the organization and now to the brain, so a callback can be replayed into
neither.

**Archives are attacker-supplied.** Every read in the import path is bounded
(`apps/knowledge/import.go:142`, `:174`), so a crafted archive exhausts a limit
rather than the process.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0128 — Resource Surface Standard
- HIP-0135 — What Is Public
- HIP-0139 — Capability
- HIP-1132 — Index — Full-Text Search
- HIP-1147 — Search — Hybrid Retrieval
- HIP-1210 — Agents — Define, Run, Keep
- HIP-1211 — AI — The Model API
- HIP-1260 — Knowledge — Wiki and Agent Memory

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
