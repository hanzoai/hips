---
hip: 0143
title: Egress — The Outbound Trust Boundary
author: Hanzo AI Team
type: Standards Track
category: Security
status: Final
implementation-go: shipped
created: 2026-09-09
requires: HIP-0111, HIP-0119, HIP-0136
---

# HIP-0143: Egress — The Outbound Trust Boundary

## Abstract

A service that spends money at an upstream asks `egress` for a **call**. It does
not ask for a key, and it does not hold one. Egress (`hanzoai/egress`) attaches
the credential, makes the call, returns what the upstream said, and meters it.
Ingress decides who may come in; egress decides who may spend.

This is the one way an upstream credential is used. A HIP that puts
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SENDGRID_API_KEY`, a cloud provider
token, or a customer's own provider key into a service's environment is
specifying the design this replaces.

```
any caller  ──asks for a call──▶  egress  ──holds the key──▶  upstream
            ◀──── response ─────          (KMS custody)
```

## Motivation

An upstream credential is money. Put in a process environment it is money that
anything reaching that process can take, spent off our network, at no rate limit,
attributed to nobody, and undone only by a rotation at the vendor. The failure is
neither detected by us nor bounded by us.

Moving custody does not make a key unstealable. Nothing that lives in a cluster
is unstealable from someone who owns that cluster. What changes is what the theft
is worth: a stolen caller credential buys metered calls through our own meter —
rate limited, attributed, audited, and revocable in one place — instead of a
vendor bearer that spends without limit and invisibly.

The customer's own key is the sharper case. It is their money, their vendor
relationship and our liability, so it must be handled **more** carefully than
ours and MUST reach the upstream by this same path. A bring-your-own-key route
that bypassed egress to call directly would be the one place a customer's key is
handled worse than a platform key.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. A caller asks for a call

A caller describes the request it wants made — method, path, query, headers,
body — and names the `Provider` to make it at. The request's host is discarded:
egress resolves the upstream from the provider name, because an address is not
what makes an upstream payable. The transport is ZAP (HIP-0120), over TCP or a
unix socket.

Every client library worth using accepts an `*http.Client`, so adopting egress is
a transport swap rather than a rewrite. A caller MUST NOT reimplement the
provider surface: dialects, relay, streaming and media live in `hanzoai/ai` and
egress imports them, so a changed streaming shape or a moved usage field cannot
work in one and not the other.

### 2. A caller identifies itself with an IAM identity

`Token` is an IAM access token (HIP-0111), verified the way every service
verifies a caller: `iss` against the configured issuer, `aud` against the
configured audience, signature against the published JWKS. There is no egress API
key, no shared secret and no bearer invented for this boundary.

A service mints one from the machine identity it already has:

```
POST https://hanzo.id/v1/iam/oauth/token
Authorization: Basic base64(clientId:clientSecret)      # client_secret_basic
grant_type=client_credentials&resource=hanzo-egress
```

`resource` (RFC 8707) scopes the token to egress and the audience check fails
closed on a mismatch — which is why the audience has **no default**: a service
that accepts any audience accepts a token minted for a different app. A caller
MUST refresh shortly before expiry rather than on failure; a token that dies in
flight produces a `401` indistinguishable from a revoked identity.

A long-lived bearer in a config value is forbidden. It does not expire, nobody
rotates it, and it answers none of the questions egress asks before it spends.

### 3. Custody, and the path built from the principal

Credentials live in KMS (HIP-1134) under a path built from the **validated
principal**, never from a request field. A caller that could name its own path
could name another tenant's; that is the whole tenant boundary.

    /orgs/{org}/users/{user}/connectors/{provider}/{label}    per-user
    /orgs/{org}/cloud/{provider}/{label}                      per-org

Three properties are owed to a customer's key specifically, and MUST hold:

- **It is never returned, to anyone** — not to the customer who supplied it, not
  to an operator, not to a support tool. Write-only after enrolment. A key that
  can be read back leaks through whichever surface reads it.
- **It is spent only for its owner.** The credential used for a call is selected
  by the caller's validated principal, so one tenant's key cannot fund another's
  request even by mistake.
- **Its use is the customer's record too.** The audit trail that answers "who
  read this" answers "what did you spend my key on".

### 4. The key is fetched, never carried

A replica resolves a credential from KMS at call time behind a short TTL and
holds nothing durable. That is what makes replicas interchangeable and horizontal
by default, and it makes rotation ordinary: a key rewritten in KMS is in use
within the TTL, with no redeploy, no restart and no manifest change. It is also
why a suspect replica is deleted rather than investigated — it knew nothing that
outlives it.

An instance MUST NOT write the credential anywhere. It writes no file, refuses
core dumps, mounts no writable path, and pins its pages with
`mlockall(MCL_CURRENT|MCL_FUTURE)` before the store opens, so a key cannot reach
swap; without `LimitMEMLOCK=infinity` it refuses to start rather than serve
without that property.

### 5. A database session is the same shape, one layer down

A database is not a request and an answer, so what egress brokers there is the
whole session. It builds an ordinary connection URL, which is why a service
reading `DATABASE_URL` needs no code change:

```
postgres://sql:<IAM access token>@/books?host=/run/hanzo&sslmode=disable
```

The password field carries the caller's IAM token, because a Postgres client has
one field for a secret. Two consequences MUST be designed for:

- **A session ends when the token does.** Build the URL where the pool opens a
  connection, not once at boot.
- **`sslmode=disable` is on the leg to egress, not the leg to the database.**
  Egress reaches a database that is not ours over verified TLS with no setting
  that says otherwise. The egress socket MUST be reachable only by the service
  that owns it.

`Provider: "sql"` names the shared base (HIP-0144) and is reached with **no
credential at all** — egress connects on the trust between it and the base and
presents the caller's org as the database role. Any other provider name is a
connection URL enrolled once into the caller's own custody. An enrolled origin
MUST name a host on the public internet; a loopback or private address is
refused, because egress would otherwise be a tunnel to whatever answers there.

### 6. Where it runs

Egress runs **off the managed cluster**, on metal we own. A cloud provider API
token reaches every pod, every secret and every volume in that provider's managed
Kubernetes, so egress running there would hold a decrypted key inside the blast
radius it exists to escape. Renting the escape hatch from the provider it escapes
puts it back inside.

- The root is LUKS2, so a disk that leaves the rack is ciphertext, and the unlock
  is network-bound rather than a typed passphrase — the host asks an unlock
  service that is not in the same cloud. A stolen disk cannot ask; a cloud API
  token cannot answer.
- **Nobody logs in, including us.** No SSH, no shell, no console login, no debug
  endpoint returning state. That is only honest if nothing is repaired in place:
  a misbehaving host is destroyed and replaced from the image, which is possible
  because it holds no state worth keeping. Diagnosis is from outside — metrics,
  logs and health leave the host to the telemetry plane (HIP-0132).
- Secrets are never flags and never environment variables. The mnemonic, the
  sealing identity and the store's client secret arrive as systemd credentials
  (`LoadCredentialEncrypted`), read from `$CREDENTIALS_DIRECTORY`.

Every option is a flag with an environment fallback, so an instance is described
entirely by its unit file. The sealing recipient (`-recipient`) is a public key by
construction: whoever holds it can seal a credential and open none.

### 7. Cutover

Every provider key in the estate is live in more than one place, so the order is
load-bearing: **serve → seal → prove → cut → revoke**. Removing a key before
egress serves it 401s the fleet. "Prove" means a real call round-tripping,
streaming included; a status code is not a working call.

The local single-binary path is unaffected and stays as it is: keys from the
environment, direct calls, no KMS and no egress. This HIP governs the deployed
fleet.

## Rationale

The alternative is to leave keys where they are and control them by policy —
network egress rules, secret scanning, rotation schedules. Each is worth having
and none of them answers the question that matters after an incident: *what was
spent, by whom, and is it still spending?* A key in an environment cannot answer
it, because the spending happens at the vendor, on the vendor's record, under one
identity shared by every caller.

The second alternative is a per-service credential at each vendor, so a leak is
scoped. That is five rotations instead of one and still leaves the credential in
the process. Egress is the composition of three things that already exist — the
provider surface in `hanzoai/ai`, the edge policy in `gateway`, and custody in
KMS — and it should add custody and nothing else. A second copy of the provider
surface would drift silently, and we would learn about it from a customer.

## Security Considerations

**Bounded and observable, not unstealable.** A running host holds the key in
memory; only SEV-SNP or TDX closes that, and the boot line reports which of
`sev-snp`, `tdx` or `none` is in effect rather than assuming one. With no TPM,
nothing measures the code, so the disk does not refuse to unlock for a changed
binary. These are the limits, stated so a reader does not infer more than was
built.

**Stealing a caller token buys metered calls.** That is the intended reduction,
not an absence of risk. Rate limiting is per principal (`-rpm`, default 600 per
minute) and every call is attributed, so the theft is visible and revocable in
one place.

**The audience check is the boundary between apps.** A token minted for another
app must not be accepted here, which is why no default audience exists.

**A caller that still needs the key locally has not adopted egress; it has moved
the key.** Reading a caller pod must yield nothing that spends. That property is
falsifiable: enumerate the pod's environment and mounted secrets and find no
upstream credential.

## References

- HIP-0111 — Hanzo IAM Authentication Standard (the token and its audience)
- HIP-0119 — Hanzo Service Conventions
- HIP-0120 — ZAP-Native Transport & gRPC Elimination
- HIP-0132 — One Telemetry Plane
- HIP-0136 — One Secret, One Path
- HIP-0144 — Where State Lives (the shared base egress brokers)
- HIP-1065 — Connectors — A User's Own Credentials
- HIP-1134 — KMS — Secret Custody
- `hanzoai/egress` — `docs/using-egress.md`, `docs/architecture.md`

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
