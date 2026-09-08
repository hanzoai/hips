---
hip: "0136"
title: One Secret, One Path
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
implementation-go: partial
created: 2026-08-03
requires: HIP-0027, HIP-0119
---


# HIP-0136: One Secret, One Path

## Abstract

A secret's location is **derivable**, never remembered. Given the app that reads
it and the environment variable it becomes, there is exactly one path it can be
at, one Kubernetes Secret it lands in, and one key inside that Secret. Nobody
looks it up, because there is nothing to look up.

    hanzo/iam/IAM_SERVICE_TOKEN@prod

Read that as: the `hanzo` org's `iam` app reads `IAM_SERVICE_TOKEN`, in `prod`.
Every part is a fact you already had before you went looking.

## Motivation

This is written from an outage. `index-chat` sat in CrashLoopBackOff for 18
hours — 221 restarts — exiting with *"You must provide a master key"* and
printing a freshly generated key into its own log each time. The key was never
missing. It was in KMS the whole time. Nobody could find it, because one concept
had four names across two namespaces:

    env var      INDEX_MASTER_KEY
    k8s secrets  search-secrets/SEARCH_MASTER_KEY
                 chat-index-key/INDEX_MASTER_KEY
                 index-chat-env/INDEX_MASTER_KEY
                 index-chat-env-mnemonic
    KMS          /platform/index-chat, read at envSlug `default`
                 every other service reads `prod`

During the repair an engineer queried the right path at the wrong env, got
`total: 0`, and concluded the secret did not exist. It did. That is the cost of a
path you have to know rather than derive.

Across the fleet the `secretsPath` field had grown five incompatible shapes. It
sometimes named the app, sometimes the secret, sometimes a category, sometimes
nothing:

    /                        the root, flat
    /aml  /studio  /pkg      the app
    /iam-service-token       the SECRET, not the app
    /cloud-sign              a purpose
    /platform/index-chat     a category, then the app

Five shapes is not a convention with exceptions. It is the absence of one.

## There is ONE KMS: `api.hanzo.ai/v1/kms`

It answers `path` / `env` / `name`, resolving to `/orgs/<org>/<path>/<NAME>`, and
it is the only store any service reads.

There is currently a SECOND DEPLOYMENT of it — `localhost:8200` / `kms.hanzo.ai`,
which every chart's `kmsSecrets` still points at through the KMSSecret CRD's
`hostAPI`. That is not a second architecture and must never be written up as one.
It is the same `luxfi/kms` binary serving the same `/v1/kms/secrets` routes under
the same JWT boundary — its own source says of the two endpoints, *"gates on the same
thing requireOrgJWT ultimately does: whether the caller's own org authorizes this
deployment's home org. Two doors, one boundary."* One program, deployed twice,
with its data split across the two.

The split is what makes secrets unfindable, and it is a migration item, not a
design. A name present in one deployment is absent from the other, so a query
against the wrong one returns `total: 0` — indistinguishable from a secret that
never existed, and exactly how a migration deletes a live credential. See the
Migration section: the standalone's contents move into `api.hanzo.ai/v1/kms`,
every `hostAPI` repoints there, and the standalone is scaled to zero.

**White-labelling is a frontend concern, not a second store.** `kms.lux.cloud`
resolves to this same API with Lux branding, as `kms.hanzo.ai` does with Hanzo's;
the org boundary already separates the data. A brand does not earn a deployment.
An operator that needs its own MPC root — a Lux committee signing in `lux-k8s`
rather than `hanzo-k8s` — configures that under one API too; the REK's location
is deployment configuration, not a fork of the service.

## Specification

### 1. The path

A secret is addressed by four coordinates and nothing else:

    <org>/<app>/<NAME>@<env>

**`org`** — the KMS project the secret lives in, which for a shared platform
service is the tenant that owns it: `hanzo`. This is the store boundary already —
KMS resolves `/orgs/<org>/…` — so stating it makes explicit what was implicit.

A service with its OWN project (its own machine identity, e.g. `base` at
`hanzo-base`) is addressed by that project instead, and keeps it. The project is
the real authorization boundary; the path below it is organization. Anything
holding material the rest of the namespace must not read belongs in its own
project, and moving it into the shared one to satisfy a naming rule would be a
downgrade.

**`app`** — the app that **READS** the secret. Never the app that produced it,
never a category, never a purpose. One question with one answer: *which process
will hold this in memory?* It is the same string as the app's name in
`charts/app/values/<namespace>/<app>.yaml` and its Kubernetes workload.

A secret read by two apps is **one entry**, and both name their own path only if
they genuinely hold different material. Two apps sharing one credential share one
path; copying it to a second path so each can "own" one is what produced
`chat-index-key` and `index-chat-env` — two names, one key, guaranteed to drift.

**`NAME`** — exactly the environment variable the value becomes. Not a
description of it, not a slug, not a renaming. `INDEX_MASTER_KEY` in the
container is `INDEX_MASTER_KEY` in KMS. When the variable and the key disagree,
every reader must carry a translation, and a translation is a thing that can be
wrong.

**`env`** — `prod`. There is one environment on this plane and it is the chart
default. `default` is not an environment; it was a Infisical-ism that leaked, and
it is what made a present secret read as absent.

### 2. The Kubernetes side is derived, not chosen

Declaring the path fixes everything downstream. There are no further decisions:

```yaml
kmsSecrets:
- name: <app>-env-kms-sync        # the KMSSecret CR
  secretsPath: /<app>             # the org is the store; the app is the path
  keys: [<NAME>, ...]             # the variable names, verbatim
  secretName: <app>-env           # the Secret the pod mounts
```

and the container reads it the only way it can:

```yaml
- name: <NAME>
  valueFrom:
    secretKeyRef:
      name: <app>-env
      key: <NAME>
```

`hostAPI`, `projectSlug`, `envSlug`, `credentialsSecret` and `resyncInterval` come
from the chart's `kms:` defaults. Set them only when the app runs outside the
platform namespace, where the credential it authenticates with is its own
namespace's.

**The Secret lives in the app's own namespace.** The controller reads its
credential from, and writes its managed Secret to, the release namespace. A
secret synced beside a *different* app is not available to this one — that is
precisely how a key sat in `hanzo` while the service that needed it ran in
`tenant-hanzo` and died for 18 hours.

### 3. `optional: true` is banned on a value the service requires

```yaml
    secretKeyRef:
      name: index-chat-env
      key: INDEX_MASTER_KEY
      optional: true            # ← this
```

`optional` converts a missing Secret — which Kubernetes reports precisely, as
`CreateContainerConfigError`, naming the Secret — into a container that starts
and then kills itself for reasons only its logs know. It buys nothing and it
costs the diagnosis. If the service cannot run without the value, let the kubelet
say so.

### 4. Deriving a path you have never seen

Two questions, no lookup:

1. *Which app reads it?* → `<app>`
2. *What is the variable called?* → `<NAME>`

```
gateway needs STRIPE_SECRET_KEY  →  hanzo/gateway/STRIPE_SECRET_KEY@prod
                                 →  secretsPath: /gateway
                                 →  Secret gateway-env, key STRIPE_SECRET_KEY
```

If answering (1) is hard, the secret is shared and the sharing is the thing to
fix — not the path.

## Relationship to HIP-0027

HIP-0027 §"Secret Organization Model" specifies `Organization → Project →
Environment → Folder → Key`, with **a project per deployable service** —
`hanzo-iam`, `gateway`, `chat`, `cloud`, `console` — so that "a compromised
service identity can only read its own secrets."

**That is not what shipped.** Every `kmsSecrets` declaration in the fleet takes
the chart default `projectSlug: hanzo`, one project for the whole org, with the
service distinguished only by `secretsPath`. The sole exception is `base`
(`hanzo-base`). The per-service projects that HIP-0027 tabulates as "current
projects in production" are not what the charts address.

This HIP states the rule for the tree that exists: one project per **org**, and
the app in the **path**. Where the two disagree about where a service's secrets
live, this one is normative and HIP-0027's project-per-service layout is
superseded.

What is **not** superseded is HIP-0027's *reason* for wanting it. That isolation
goal remains unmet — see Security Considerations. Closing it is a change of
identity topology, not of naming, and belongs in its own proposal.

## Migration

Four of eleven declarations already conform. Seven move:

| app | today | becomes |
|---|---|---|
| `admin-guard` | `/admin-guard-secrets` | `/admin-guard` |
| `chat` | `/chat-guest-key` | `/chat` |
| `cloud` | `/cloud-sign` | `/cloud` |
| `cloud` | `/integrations/cloudflare` (env `default`) | `/cloud` (env `prod`) |
| `iam` | `/iam-service-token` | `/iam` |
| `team` | `/team-go-secret` | `/team` |

Already conforming: `aml`, `bot-browser`, `pkg`, `studio`.

**`base` is deliberately NOT in that table, and must not be added to it.** It sets
`projectSlug: hanzo-base` with its own `credentialsSecret`, so its `/` is the root
of its OWN project, reached by its OWN machine identity — not a shared path
carelessly left at the root of everyone else's. It holds
`EMBEDDED_IAM_ROOT_PASSWORD` and the IAM signing keys, and no other app in the
fleet can read them.

That is HIP-0027's project-per-service isolation, actually implemented, and it is
STRONGER than what this HIP describes. Folding it into `hanzo/base/*` would move
the most sensitive material in the estate into the shared project where every app
in the namespace could read it. An app with its own project keeps it. The rule
below is how a service in the SHARED project is addressed; `<org>` names the
project a secret lives in, and a service that has earned its own is the direction
of travel, not a deviation from it.

### Collapsing the second deployment

The path moves above are the small half. The larger one is that a second
deployment of this same service holds most of the data, and it goes away:

1. Copy every secret from the standalone (`kms.hanzo.ai`, ~1832 entries at root)
   into `api.hanzo.ai/v1/kms`, preserving `path`/`env`/`name`, verifying each
   value byte-identical after the write. Both speak the same API under the same
   JWT boundary, so this is a read here / write there with one token — not an
   envelope conversion.
2. Repoint every chart's `kmsSecrets` `hostAPI` at cloud, and drop the
   `localhost:8200` default from `charts/app/values.yaml`.
3. Confirm each app's Secret still carries byte-identical values, from a RUNNING
   pod, before anything is deleted.
4. Scale the standalone to zero, then remove it.

Order matters and step 3 is not optional: a Secret that syncs empty does not fail
the pod, it starts one that cannot work.

Each path move is **copy, repoint, verify, delete** — in that order, one app at a
time. The old entry is removed only after the new path has been read by a running
pod, because a secret that exists at neither path is an outage and a secret that
exists at both is merely untidy.

Two rules learned from the first attempt, which read cloud's embedded store by
mistake and would have destroyed live credentials:

**A read that returns nothing STOPS the move.** Never write what a read did not
return. An empty read followed by a write of that empty value, then a read-back
comparing empty to empty, reports success for a migration that moved nothing —
and the delete that follows then removes the only real copy. `admin-guard` gates
SuperAdmin admission to every raw admin surface; that sequence would have left it
booting with no `GUARD_HMAC_KEY`.

**Absence must be proven against the deployment the chart reads, by an unfiltered listing.** A
path-filtered list returning `total: 0` is not evidence: the same token that
reported zero for `/orgs/hanzo` returned five secrets when listed unfiltered.
Absence is only established by enumerating the store the chart actually reads.

An omitted `keys` list pulls the whole path, which is a different request from an
empty list rather than a shorthand for one, and stays that way. `base` is the one
service that makes it — reading the root of its own project — and neither the
list nor the project moves.

The one KMS reference in Go — `apps/platform/pin.go`'s
`orgs/hanzo/deploy/UNIVERSE_PIN_TOKEN@prod` — already has this shape. `deploy` is
a purpose rather than an app, which is the one standing exception: nothing reads
it but the release pipeline, which is not a deployed app. It stays until the
pipeline is one.

## Security Considerations

Nothing here changes what a secret is protected by; it changes where it is
found. Three properties are worth stating.

**The isolation HIP-0027 wanted is still missing, and this HIP does not add it.**
One project per org means one machine identity per namespace —
`hanzo-platform-iam-creds` in `hanzo` — so every app in that namespace can read
every path in that project. `secretsPath` organizes; it does not authorize. A
compromised app reads its neighbours' credentials, which is exactly what
project-per-service was meant to prevent.

Making the path derivable does not widen that: any app could already read any
path, whether or not it could guess the name, and a convention nobody follows is
not a control. But it should be recorded plainly that the boundary is the
**namespace's credential**, not the path, and that closing the gap means one
machine identity per app — a change to identity topology, deliberately out of
scope here.

**A path reveals its consumer.** `hanzo/gateway/STRIPE_SECRET_KEY@prod` says
gateway holds a Stripe key. That is already true of the running deployment and of
its values file, so the path adds no exposure — and it makes an over-broad grant
visible instead of buried.

**One entry, one rotation.** A credential copied to two paths rotates at one and
not the other, and the failure appears at whichever consumer was not rotated,
which is not the one that was changed. Sharing an entry makes rotation atomic.

Charts continue to carry references and never values. `templates/kmssecret.yaml`
has no `stringData` escape hatch, on purpose; this HIP does not add one.
