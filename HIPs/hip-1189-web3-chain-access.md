---
hip: 1189
title: Web3 — Chain Access
author: Hanzo AI
type: Standards Track
category: Core
capability: web3
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1189: Web3 — Chain Access

## Abstract

Web3 is the chain-access surface: which chains this deployment can reach, a
JSON-RPC door onto each, and the balance read a wallet interface needs. It holds
no key, signs nothing, indexes nothing, and stores nothing. It is implemented in
`hanzoai/cloud` at `apps/web3`. `web3` is the word people say for the faculty,
and HIP-0139 §2.2 already carries it.

## Motivation

A console page that shows a chain, a balance or a transaction needs one address
to call and one answer it can trust. Reaching a chain directly from a browser
means every page carries an upstream URL, frequently with a provider key in its
path, and every deployment's chain list is whatever each page happened to be
built with. One door, fed by one declared registry, makes the reachable set a
property of the deployment instead of a property of the caller.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

It owns none. Chain state belongs to the chain, and this capability keeps no
copy, no cache and no index of it.

What it holds is a declared registry, read once at mount from `WEB3_CHAINS`: a
JSON object of id → `{name, chainId, rpc}` (`apps/web3/web3.go:27-31`). The
registry is DECLARED, never guessed. A malformed value MUST fail the mount
rather than serve a silently empty list — an operator who wrote the variable
meant to configure chains, and finding out at the first request is worse than
finding out at boot. An empty value is legal and means this deployment reaches
no chains: the surface still mounts and answers honestly. There MUST be no
fallback to a public endpoint, because a silent fallback means someone's traffic
quietly leaves the estate.

### §2 The addresses

Four operations, all typed. Nothing here is declared-but-untyped.

`GET /v1/chains` answers `{chains:[{id, name, chainId}]}`, sorted by id, empty
when none are configured and never a fabricated entry. It is exactly the set
`/v1/rpc` will accept. The upstream URL is not a field on the value: it is the
deployment's own, frequently carrying a provider key, and this answer goes to a
browser.

`GET /v1/chains/{chain}` adds `live` and `height`. An unreachable chain is a 200
with `live:false`, not a 502 — "configured" and "up" are different facts, and a
transport error here would make a console page break rather than show the
outage. `height` is OMITTED when the chain did not answer rather than reported
as zero, because zero is a real height on a fresh chain.

`POST /v1/rpc/{chain}` forwards a JSON-RPC 2.0 call and returns the answer
unchanged. The request is modelled field by field — `jsonrpc`, `id`, `method`,
`params` — so the operation is typed like every other, with `params` and `id`
left raw because JSON-RPC defines them as method-specific and caller-chosen. An
upstream error comes back AS a JSON-RPC error object at 200, because that is
what a JSON-RPC client parses; reshaping it into an HTTP 5xx would break every
standard client library. An upstream that could not be reached at all answers
the internal-error code with `id` echoed.

`GET /v1/tokens/{chain}/{address}` answers `{chain, address, native}`. The
balance is the RPC's own 0x-quantity and MUST NOT be rendered as a float,
because a wei value does not survive float64. The address is checked for the
0x-plus-forty-hex shape before any upstream call.

Every route this capability serves is under one of three roots that are not its
own name. The three pairs are ledgered in cloud's `openapi/misfiled.txt` and
close by fold, never by alias (HIP-0139 §7); there is no store here, so there is
no boundary to split on.

### §3 The boundary

**explorer** (HIP-1253) owns the indexer relationship. The rule is sharp: this
capability answers only what a single RPC call can prove, and everything that
needs an index to answer at all is explorer's. That is why token positions are
absent. "Every token this address holds" is not one `eth_call`; walking a token
list would return a number that silently omits whatever the list missed, and a
route that returned an empty array forever would look like a feature and be a
lie. Ownership and metadata are the same argument.

**wallets** (HIP-1161) owns keys, custody and signing. This capability holds no
key material and performs no signature. A signed transaction reaches a chain
through `/v1/rpc/{chain}` as an ordinary method call, exactly like a read.

Everything else a chain console needs — sign-in, projects, API keys, webhooks —
already belongs to a capability that owns it. Re-serving any of them under a
second prefix would be two implementations of one noun.

### §4 The tenant

There is no per-org row here to scope, because a chain is a public ledger. The
boundary that applies instead is authentication: every operation resolves the
caller through `principal.Acting` before it does anything else, so a request
without a validated principal carrying an org claim is refused 403 (HIP-0026).
That refusal is the whole reason this is not an open RPC relay pointed at the
deployment's paid upstream.

A caller cannot name an upstream. The `{chain}` segment is resolved through the
declared registry and an unknown id is 404, never a pass-through, so the set of
addresses this process will call is fixed at mount and is not a function of any
request.

### §5 Money

Free, and said in those words: the surface declares `cloud.Free`
(`plugin/web3/main.go`). No call here debits any plane. The cost it does incur —
upstream quota — is bounded by §4 and by the limits in the security section, not
by a meter.

### §6 Events and observability

It publishes nothing on the bus; a customer's webhooks receive no `web3.*`
event. Beyond the request span every route gets, it emits two structured log
lines: one at mount naming the configured chains, and a warning wherever an
upstream fails to answer — the fact behind a `live:false`, recorded where an
operator can read it rather than lost inside a 200.

### §7 Stage

`beta`, declared on the manifest row (`manifest/apps.go`, `Stage: Beta`): the
surface is in no public projection and is reached by flag until promotion
(HIP-0139 §8).

### §8 Upstream

It derives from none: it forks, embeds and mirrors no OSS project. It speaks
JSON-RPC 2.0 and carries the EIP-155 chain id as a field so a caller can check
it matches the wallet it is about to sign with. Both are wire facts, not code.
The whole implementation is the standard library, the cloud request tier and the
typed-route package.

## Rationale

The alternative to a declared registry is discovery: probe a set of endpoints,
or fall back to a public one when the configured upstream is missing. Both make
the reachable set a runtime accident, and the fallback in particular sends a
customer's traffic somewhere nobody chose. Failing the mount on a malformed
registry costs one restart and buys the property that a listed chain is a chain
this deployment actually has an upstream for.

The alternative to returning JSON-RPC errors verbatim is translating them into
HTTP status codes, which reads tidier in a document and breaks every client
library that already knows how to parse the error object it was given.

## Security Considerations

The dangerous wrong implementation is an open relay, and it has two shapes.

Without the principal check, anyone on the internet points this at the
deployment's upstream and spends its quota — the upstream is paid for, the
caller is not, and nothing about the request looks abnormal. The check is the
first statement in every operation.

If the `{chain}` segment were treated as a URL, or if an unknown id fell through
to a default, the surface becomes a request-forgery door onto whatever the
process can reach, including the cluster's own network. Resolution goes through
the declared map with no fall-through: an id that is not in it is 404.

Three further bounds keep a hostile or broken upstream from deciding this
process's behaviour. The response is read through a limit, so an upstream
answering an HTML error page or a redirect loop cannot exhaust memory. A call is
bounded in time, so an upstream that has stopped answering does not hold a
request open indefinitely. And the upstream URL is unexported on the chain
value, so no listing, error or log line can disclose the provider key carried in
its path.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1161 — Wallets — Key Custody
- HIP-1253 — Explorer — Chain Data

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
