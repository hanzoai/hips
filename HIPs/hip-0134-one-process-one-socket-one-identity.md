---
hip: 0134
title: One Process, One Socket, One Identity
author: Hanzo AI
type: Standards Track
category: Core
status: Final
created: 2026-07-28
requires: HIP-0106, HIP-0114, HIP-0116, HIP-0120, HIP-0122
---

# HIP-0134: One Process, One Socket, One Identity

## Abstract

Every Hanzo service is a plugin of the `cloud` binary (HIP-0106, HIP-0116).
Plugins reach each other over ZAP on unix domain sockets. IAM is the only
thing that reads a JWT, and the principal it establishes is what every other
plugin uses.

That is the architecture. This HIP states it, and states its three
consequences — each of which is a thing that does not exist:

1. **No second listener.** A plugin serves its own socket. There is no ZAP
   TCP port to reach it on, so there is no wire to authenticate or encrypt.
2. **No second name.** The binary is `cloud`. There is no `cloud-api`.
3. **No second identity path.** IAM owns the principal. Nothing re-derives
   identity from headers, no edge process mints an identity-header set, and
   no gate in front of a plugin decides who may read what.

## Specification

### 1. Transport: a socket per plugin

A plugin listens on exactly one address — its unix socket. The host hands it
that address; the plugin does not choose a port.

    {CLOUD_DATA_DIR}/run/<plugin>.sock      # default /run/hanzo/<plugin>.sock

The wire is ZAP (HIP-0114, HIP-0120). A plugin's routes ARE its ZAP surface
(HIP-0122), so there is no second registry of methods and no second
serialization. `zip` selects the ZAP transport for a bare address, which is
what a socket path is.

A caller resolves a peer by name, never by address:

    cloud.Dial("treasury").As(c).Get(ctx, org, "/v1/treasury/reserve", &out)

Resolution happens per call, so a plugin that starts later is picked up
without a restart. A missing socket is the answer "that plugin is not running
here", returned as an error — never a zero value.

A plugin MUST NOT open a TCP listener. The only TCP listeners in a deployment
are the edge HTTP listener, terminated by ingress, and the ops listener for
health and metrics (HIP-0113).

### 2. Authentication: the kernel, then IAM

Two facts do all the work.

**The kernel proves the peer.** A 0600 socket in the run directory is
reachable only by processes on the same host running as the same user. There
is no network path to it. This is the entire authentication of the internal
plane: no credential to mint, distribute, rotate, or revoke, and nothing that
can fail open.

**IAM proves the human.** The IAM plugin validates the JWT and establishes
the principal — org, user, admin — once, in one place.

A call carries the principal IAM established. Because the socket bounds who
may speak, carrying it is delegation rather than assertion: a caller passes on
authority it already holds, and the callee still applies its own rules. There
is no way to obtain a principal except from IAM.

Nothing sanitizes, re-derives, or re-validates a principal IAM established. A
component that re-checks identity is a second implementation of IAM, and two
implementations of "who is the caller" do not double the assurance — they
create a disagreement, and the weaker one is the one an attacker uses.

### 3. Authorization: in the plugin, on the principal

The plugin that owns the data decides who may see it, reading the principal
and filtering server-side on every query.

**Org scope by default.** A request for org X returns org X's rows. Not a UI
filter, and not a query the client can widen.

**SuperAdmin is the only cross-org scope**, and it is ONE predicate
everywhere: `owner == "admin"`, membership of the reserved `admin` org. An
org admin (`isAdmin` inside their own org) has no platform authority.
Conflating the two is privilege escalation.

An edge gate may answer "is this a valid session" — that is authentication,
relayed from IAM. A gate that decides *which rows you may see* has taken the
plugin's job, and the plugin will never grow the ability to do it correctly.

### 4. Naming

**The binary is `cloud`.** A second Service name for the same pods is a second
door with different properties.

**One IAM application per guarded surface, named for the surface**:
`hanzo-admin` for admin.hanzo.ai, `hanzo-platform` for platform.hanzo.ai,
`hanzo-ci` for ci.hanzo.ai. An application named for a component — a guard, a
proxy — that fronts several surfaces makes them indistinguishable in the
audit log and gives them a shared blast radius. Redirect URIs are the
surface's own callback exactly; no wildcards.

Changing a surface's application is create-new → cut the surface over →
verify login → retire old. An in-place rename invalidates every live token
whose `aud` names the client.

## Rationale

**Why a socket rather than a token.** Authenticating a local call with a
credential means minting, distributing, rotating, and revoking it — four
operations that can each fail open — to establish a fact the kernel already
knows and cannot be lied to about. `credz` authenticates its peers with
`SO_PEERCRED` for this reason; this HIP applies the same argument to every
plugin.

**Why identity has exactly one owner.** Every mechanism that guards a second
identity path — a sanitizing middleware, a mesh-mTLS plan for an internal
wire, a ForwardAuth gate per surface — is a correct answer to a question that
only exists because identity was put on a header and the hop was put on a
network. Remove those two choices and the mechanisms above them are not
simplified; they are unnecessary.

**JSON is an edge concern**, translated exactly once, and terminating client
TLS is a distinct job. Both are satisfied by the gateway plugin owning the
edge. Neither requires a separate process minting headers.

## Backwards Compatibility

The following are non-conforming in a deployment and are removed rather than
reconfigured:

| Thing | Why it goes |
|---|---|
| ZAP TCP listener on a service | The socket is the plane; a TCP port is an unauthenticated second door |
| `cloud-api` Service or hostname | The binary is `cloud`; a second name is a second trust posture |
| Identity-sanitizing middleware | A second identity implementation; IAM owns the principal |
| ForwardAuth gate as a surface's authorization | Authorization belongs to the plugin that owns the data |
| A surface borrowing another surface's IAM client | One app per surface, named for the surface |

Order matters, because a removal that outpaces its replacement opens a hole:
give each surface its own IAM app and in-plugin org scoping first; then
retire the gate; then remove the second listener and the second name; and
remove the sanitizing middleware once no path reaches a plugin except through
IAM. A step whose successor is not yet in place is not started.

## Security Considerations

**Socket permissions are the perimeter.** The run directory is writable only
by the service user, sockets are 0600, and the run directory is never a
shared volume another tenant's workload can mount. A world-readable socket is
equivalent to an open unauthenticated port.

**Delegation is not escalation.** `As()` forwards the principal a caller
already holds; the callee applies its own rules. Nothing in the internal
plane grants authority a caller did not arrive with.

**Shared build fabric is a separate boundary.** Running another tenant's code
— CI — on a runner that mounts a registry credential, shares a docker daemon,
or reuses state across jobs is a tenancy violation regardless of the identity
plane. A job running foreign code gets an ephemeral runner, no long-lived
credential, and no shared daemon.

**What an attacker must achieve.** With the internal plane on sockets, a
cross-tenant read requires code execution as the service user on the host —
not a forged header, not a reachable port, not a stolen bearer token.

## Reference Implementation

- `hanzoai/cloud` `dial.go` — peer resolution by name, ZAP over the callee's
  socket, delegation via `As`, errors that name the transport they tried.
- `hanzoai/cloud` `serve.go` `listenOn` — a plugin honours the host-provided
  socket address and serves that alone.
- `hanzoai/zip` `transport.go` — the scheme table: a bare address selects ZAP,
  which is why a plugin needs no transport configuration.
- `hanzoai/iam` — the principal's single owner.

## References

- HIP-0026 — Identity & Access Management standard
- HIP-0106 — Cloud: unified Hanzo binary
- HIP-0113 — Ops listener: health, readiness, metrics
- HIP-0114 — ZAP inter-VM cognitive transport
- HIP-0116 — Plugin & VM model
- HIP-0120 — ZAP-native transport, gRPC elimination
- HIP-0122 — zip: the ZAP-native application server core
