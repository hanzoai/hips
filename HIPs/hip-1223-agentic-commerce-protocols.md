---
hip: 1223
title: Agentic Commerce — Pay-per-Request, Checkout, Mandates and Machine Payments
author: Hanzo AI
type: Standards Track
category: Application
status: Draft
implementation-go: partial
created: 2026-11-20
requires: HIP-0018, HIP-0106, HIP-0139, HIP-1163, HIP-1220
---

# HIP-1223: Agentic Commerce — Pay-per-Request, Checkout, Mandates and Machine Payments

## Abstract

An agent buys things for a person: it reads a price, agrees to it, pays, and keeps a receipt, with
no human in the loop for the click. Five published specifications define the wire for that, each for a
different part of it, and `hanzoai/commerce` implements them as Go packages:

| Part | Specification | Package |
|---|---|---|
| A resource asks for a payment per request | x402 version 2 | `payment/x402` |
| An agent opens, changes and completes a merchant's checkout | Agentic Commerce Protocol (ACP), API 2026-04-17 | `agentic/acp` |
| A merchant declares what it sells, negotiates capabilities and signs its messages | Universal Commerce Protocol (UCP), release 2026-08-25 | `agentic/ucp` |
| A person's authority to buy is a signed mandate, verified before money moves | Agent Payments Protocol (AP2), v0.2 | `agentic/ap2` |
| A resource names a payment method and an intent in the HTTP authentication framework | "Payment" HTTP authentication scheme (MPP), Internet-Draft draft-httpauth-payment-01 | `agentic/mpp` |

This HIP states what is implemented of each, where each one stops, and the rules that hold for all
of them. The wire of every one is its specification's, not ours. What is ours is only where they meet
commerce's own checkout and order model, and everything priced, paid to or limited is data the
operator sets.

## Motivation

A merchant that runs commerce should be reachable by an agent without a custom integration per agent
platform, and a service that wants to charge per request should not have to write a payment
protocol. The specifications exist. What was missing is one implementation of each that is public,
tested against the specifications' own examples, and plain about the part it leaves out.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### §1 Rules for every protocol

1. **The wire is the specification's.** Field names, header names, enumerations, error reasons and
   status codes MUST be those the specification prints, at the version the package names in its
   documentation. A package MUST NOT add a field, rename one or give a second spelling.
2. **Examples are tests.** Every example a specification prints for a feature the package
   implements MUST be decoded and re-encoded in the package's tests, and each implemented MUST of the
   specification MUST have a test that fails when it is broken. Where a specification's examples
   disagree with its own schema, the test names the example and pins the disagreement.
3. **Nothing is chosen for the operator.** A price, a payee address, a token, a network, a spending
   limit, a cap and a retention period are configuration. A package MUST NOT contain a default for
   one, and a configuration that leaves one out MUST be refused at start, not discovered by a payer.
4. **What is not implemented is said.** A part the specification does not publish, publishes only as a
   draft that has not settled, or that needs a party commerce is not, MUST be left out and named in
   the package documentation. It MUST NOT be stubbed.
5. **Behind commerce's own model.** A checkout protocol creates, changes and completes a commerce
   checkout (`api/billing`: `CreateCheckout`, `UpdateCheckout`, `CompleteCheckout`, `ReadOrder`),
   priced from the catalog. It MUST NOT price or move money itself, and a completion MUST be
   refused before money moves when the price quoted to the agent is no longer the price charged.
6. **net/http at the edge.** Each package serves its surface as an `http.Handler` and keeps its logic
   free of the transport, so any host can mount it; zip hosts mount it with `zip.AdaptNetHTTP`.
   A package takes the caller's identity from a function the host supplies, never from a request
   header it trusts blindly.
7. **State that outlives a request is the host's, and says so.** A replay or idempotency record that
   must hold across replicas is behind a small interface; the in-memory implementation is for tests
   and a single process, the durable one rides commerce's own datastore, and a record that expires
   needs a sweep the host schedules.

### §2 x402: `payment/x402`

The protocol is x402 version 2: the `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`
headers carrying base64 JSON, CAIP-2 networks, the `exact` scheme with the `eip3009` asset transfer
method. Other schemes and transfer methods (`upto`, batch settlement, permit2, ERC-7710),
extensions and the discovery API are not implemented.

The package is the mechanism and names no price:

- **Types and codec.** `PaymentRequired`, `PaymentRequirements`, `PaymentPayload`,
  `SettlementResponse`, `VerifyResponse`, `SupportedResponse`; `EncodeHeader`, `DecodeHeader`,
  `ParsePayment`.
- **Verify.** `Verify` checks that the payload echoes the terms that were offered (scheme, network,
  amount, asset, payee, and the token's EIP-712 name and version), that it authorizes exactly that
  payee and amount, and that the EIP-712 `TransferWithAuthorization` signature recovers to the payer
  it names. `InWindow` checks `validAfter` and `validBefore` exclusively, as the token contract does.
  A signature with a high `s`, a nonce that is not exactly 32 bytes and a malformed address are
  refused.
- **Facilitator.** The interface of specification section 7, `Verify` and `Settle`. `Remote` reaches
  any facilitator that serves `POST /verify`, `POST /settle` and `GET /supported`; a host that settles
  on its own books implements the interface instead. Two independent facilitators are two values of
  the one interface.
- **Table.** The resource price table over configured assets (`Asset`: network, token, the token's
  signing domain, decimals, payee, timeout; `Price`: a decimal amount in whole units). Amounts convert
  to atomic units without rounding and a price that would need rounding is refused.
- **Gate.** The flow of specification section 6.1, authorization: `Admit` verifies before the resource
  runs and `Settle` settles after it succeeded. A payment admitted and not settled is released and may
  be used again; one in flight is refused to a second request, so one payment cannot run a resource
  twice in a process.
- **Adapters.** `Middleware` for `net/http` settles at the first success status, before the first byte,
  so `PAYMENT-RESPONSE` rides the response and nothing is buffered. `Paywall` does the same for a zip
  router, settling when the handler has returned and answered below 400. A response of 400 or more, or
  a returned error, settles nothing; a payment that fails to settle replaces the response with the 402
  the specification defines. A HEAD request is priced as GET, because servers answer HEAD with the GET
  handler, and the host's naming function folds a path the way its router does.
- **Client.** `Sign`, `Signer` and `Transport`, an `http.RoundTripper` that answers a 402 once. A
  `Signer` signs only what its `Allow` function approves and signs nothing when `Allow` is not set:
  the ceiling on what an agent may spend belongs to whoever runs it.

`GET /v1/x402/prices` is how a host publishes its table: one row per priced resource with the exact
requirements for paying it, so a client can sign before it is refused.

HIP-1163 is the x402 capability of the hosted cloud, which settles on its own ledger. It uses this
package for everything that is the protocol and keeps the ledger settlement, the price registry and
the payee wallet.

### §3 ACP: `agentic/acp`

Implemented, seller side, API version 2026-04-17:

- Create, update, retrieve, complete and cancel a checkout session; line items, totals, messages,
  the session status machine and the `order` on completion.
- `API-Version` with `supported_versions` on a version error, `Authorization`, `Request-Id`, and
  `Idempotency-Key` as the specification defines it: the same key and body replays the stored answer,
  the same key with another body is the specified error, a request in flight is told to retry.
- The order webhook the merchant sends the agent, signed as the specification states.
- The discovery document, capability negotiation, and the declaration of the tokenized-card payment
  handler.
- Request signing: the specification leaves the algorithm and the keys out of band, so a `Verifier`
  the host supplies is shown the method, the path, the key, the timestamp and the body, and a
  timestamp outside the skew in either direction is refused.

Behind commerce: an item id is a catalog id (a credit pack or a plan); the payment is a shared payment
token the buyer granted the agent, charged by `CompleteCheckout`; one unit of one item per checkout, in
USD. A second item, another currency and any other payment type are refused with the specified error.
A plan whose price changed since the quote is refused, `price_changed`, before the card is touched.

Not implemented: the delegate-payment endpoint (it belongs to the payment service provider, not the
merchant), 3-D Secure authentication, seller-backed handlers and business-to-business payment terms,
the discount extension, cart, the product feed API, the MCP binding, and delegate authentication.
Affiliate attribution, intent traces and marketing consent are validated and accepted but not stored.

### §4 UCP: `agentic/ucp`

Implemented, business side, release 2026-08-25:

- The profile served at `/.well-known/ucp` (public, cacheable), the validation of a platform's profile, the
  authority binding, and capability negotiation: intersection, highest shared version, pruning of orphans.
- A profile fetcher that is safe to point at a stranger: https only, no redirects, special-use addresses
  refused at connect time, and bounds on size, time, concurrency and cache that the host configures.
- The Checkout capability over the REST transport: create, get, update, complete, cancel; messages, totals,
  the status machine, `continue_url`; `UCP-Agent`, `Idempotency-Key`, the error registry.
- HTTP Message Signatures (RFC 9421) as the specification profiles them: ES256, ES384, EdDSA, coverage of
  method, authority, path, query, content digest and the integrity headers, `created` and `expires`, response
  signing, and a registry of platforms the host trusts. The specification's own Ed25519 test vector is
  reproduced byte for byte.
- The Order capability: get order, and the signed webhook to the platform's profile, over a client that does
  not follow redirects or connect to special-use addresses.

Behind commerce as in section 3: the price refusal of `api/billing` is reported as the specification's
recoverable `totals_changed`.

Not implemented: cart and catalog, the MCP, A2A and embedded transports, fulfillment, discount, buyer consent
and the other extensions (their members round-trip untouched), identity linking, food, lodging, location, ask,
and stablecoin payment.

### §5 AP2: `agentic/ap2`

Implemented from the normative documents and schemas of version 0.2. The reference SDK and samples are
not normative and differ from them in places; where they differ the documents were followed.

- Closed and open checkout mandates and payment mandates as SD-JWTs, the JWK, all ten constraints,
  receipts, and the dispute rules, with strict decoding.
- ES256 signing and verification; `none`, HS256, ES384 and EdDSA are refused. Every hash the
  specification links (`sd_hash`, `checkout_hash`, `transaction_id`) is computed over the bytes as sent,
  since the specification defines no canonical form.
- A verifier for the merchant, the processor and the agent's authority: signature, issuer key, audience,
  expiry, nonce, replay, the binding of the cart to the payment mandate, and every constraint, with a
  negative test for each. An unknown constraint is `unresolved_constraint`, never ignored.
- A `Seller` that issues the merchant-signed checkout and completes a verified mandate against a
  `Backend`; `Commerce` is the one over `api/billing`, one unit of one credit pack, USD, shared payment token
  only, refusing any mismatch of amount, currency or item and every plan before money moves.

Not implemented: the user credential model (OpenID4VP), a trailing key-binding token, `x5c`, mDoc,
delegation between agents, and any transport: AP2 defines no wire for carrying a mandate, so the
transport is the host's or UCP's. A success payment receipt is not issued by commerce, because the
schema requires a network confirmation identifier commerce's payment result does not carry; the library
signs one when a `Backend` supplies it.

### §6 MPP: `agentic/mpp`

The "Payment" HTTP authentication scheme is an Internet-Draft, not a standard, and the package says so.
It follows draft-httpauth-payment-01 and, where the editors' later working copy publishes test vectors
the published text lacks, the working copy; each such place is named in the package documentation.

Implemented: the challenge with its HMAC binding, the request-body digest binding, the credential, the
receipt, the problem types, `Accept-Payment`, canonical JSON, and the `x-payment-info` discovery
extension. `Gate` is a resource server's middleware: replay and concurrent-use protection, expiry,
amount and body binding, and a TLS requirement. The challenge is
bound to the caller and to the route it was issued for. `Client` is a `RoundTripper` that answers a 402
through a payer, never over plain http and never past an expired challenge. A payment method is a
plug-in (`Method`); the shared-payment-token charge method is implemented, and `Commerce` settles it
through the checkout and spends the credit it grants against the priced resource.

Not implemented: the session and subscription intents, and every method whose draft needs a chain, a
channel, a card network or a facilitator commerce does not run. Rate limiting belongs to the host.

### §7 Configuration

What an operator supplies, and what a package refuses to start without: the payee, token, network,
timeout and price of an x402 resource; the merchant's account at its payment service provider, the
order permalink, the retry interval and the identity function for ACP and UCP; the business signing key (from KMS), the
trust registry of platforms and the idempotency retention for UCP; the issuer and merchant keys and a
shared secret of at least 32 bytes for AP2; the realm, the secret, the replay store and the price
function for MPP. None has a default, and none is a value this HIP or the code states.

## Rationale

One package per specification, each testable against the examples its own specification prints, is the
only way a claim of support can be checked. Putting the protocols in `commerce` rather than in each
host keeps one checkout model behind five wires, so a price changes in one place and a refusal of a
stale quote means the same thing on every wire.

x402 is a mechanism with a table, a gate and a facilitator interface rather than a product because the
parts vary independently: who settles (a chain, a ledger, any facilitator), what is priced (a route
table, a fee knob, a marketplace listing) and where it is served (net/http, zip). Each varies behind one
interface and none needs the others.

## Security Considerations

Money moves in three places, and each is guarded where it moves. An x402 payment is verified before the
resource runs, settles once, and a failed resource settles nothing; a payment in flight is not admitted
twice. A checkout is completed under an idempotency key bound to the request body, so a replay answers
with the stored result and a different body is refused, and the charge is bound to the checkout and the
key so a completion sent twice is one purchase. A price quoted to an agent and the price charged are the
same number or nothing is charged.

A request signature is verified by a host function that sees the method, the path, the key, the timestamp
and the body, and a timestamp outside the skew in either direction is refused. Message signatures are
checked over everything the specification says they cover, with the algorithm taken from the key and never
from the message; a key is found only through the profile the request names and only for a platform the host
trusts. A profile or a webhook address supplied by a stranger is fetched without following redirects and
without connecting to a special-use address. A mandate's signature, hashes, expiry, nonce and constraints are all checked before
a checkout is opened from it.

The packages were reviewed adversarially before they merged; the findings and their fixes are in the
commit history of each package.

## References

- x402 specification version 2, HTTP transport and the exact scheme on EVM (`x402-foundation/x402`).
- Agentic Commerce Protocol, API 2026-04-17 (`agentic-commerce-protocol/agentic-commerce-protocol`).
- Universal Commerce Protocol, release 2026-08-25 (`Universal-Commerce-Protocol/ucp`).
- Agent Payments Protocol, v0.2 (`google-agentic-commerce/AP2`).
- The "Payment" HTTP Authentication Scheme, draft-httpauth-payment-01, and the payment intent and
  discovery drafts it names.
- RFC 9421 HTTP Message Signatures; RFC 8785 JSON Canonicalization; RFC 9457 Problem Details;
  EIP-712; EIP-3009; CAIP-2.
- HIP-0018 — Payment Processing Standard
- HIP-0139 — Capability
- HIP-1163 — x402 — Pay Per Request
- HIP-1220 — Commerce — The Merchant Half

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
