---
hip: 0142
title: One Manifest, Five Kinds
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: none
created: 2026-08-28
requires: HIP-0014, HIP-0036
---

# HIP-0142: One Manifest, Five Kinds

## Abstract

`hanzo.yml` is the one file a repository uses to declare itself to the build
fabric. It is **data**. Many readers can read data; only a runtime can execute
code — so there is no `hanzo.ts`, no `hanzo.go`, no `hanzo.rs`. Any language may
*generate* `hanzo.yml` as a dev-time step, and exactly one thing is the contract.

Today the manifest says what to **test** and what **image** to build. It cannot
say what the project *is*. A repository that ships a Helm chart, a `compose.yml`,
a function with no Dockerfile, or a whole release of charts has no field to say
so, so each of those arrives by an arrangement outside the file.

This HIP adds one field — `kind` — and one optional companion — `path`. `kind`
names how a project arrives; each value maps to exactly one runtime primitive.
`kind` absent means what the file means today, so every manifest in the fleet
keeps working unedited.

## Motivation

Measured over the `hanzo`, `lux` and `zoo` checkouts:

```
find ~/work/{hanzo,lux,zoo} -maxdepth 2 -name hanzo.yml | wc -l   # 103
```

Every top-level key that actually appears in those 103 files, and how many
declare it:

| key | files | read by |
|---|---:|---|
| `test` | 90 | ci |
| `images` | 36 | ci, platform, the push reactor |
| `kms` | 9 | ci, platform |
| `version` | 5 | ci |
| `site` | 2 | ci |
| `deploy` | 2 | ci, platform |
| `client` | 2 | ci |
| `e2e` | 1 | platform |
| `build` | 1 | platform |

Two further keys are read and declared by no repository in that survey —
`binaries` and `bucket`, the artifact lane read by ci and by `hanzo build` — and
two more are read by platform alone: `publish` and `source`.

The number that matters is this one: **66 of the 103 declare no image lane at
all.** They are not broken. Most are test gates, and platform's validator returns
"nothing here for me" for them on purpose. But that same silence is what a chart
repository produces, and a chart repository *does* have something to deliver. One
absence is being asked to carry two opposite meanings, and no reader downstream
can recover which was intended.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. `kind` — one field, five values

```yaml
kind: image | fn | chart | compose | universe
```

`kind` names how the project arrives at the fabric. It is optional, and **absent
means `image`**, which is what every manifest in the fleet already means.

A reader that does not recognise the value MUST refuse the manifest rather than
guess at it. The set is closed: a sixth arrival is a new HIP, not a new string.

### 2. `path` — where that kind reads from

```yaml
path: <repo-relative path>
```

Optional, one per manifest, with a default per kind:

| kind | default `path` | what it points at |
|---|---|---|
| `image` | — | unused; each `images:` entry carries its own `context` |
| `fn` | `.` | the build context |
| `chart` | `chart` | a chart directory |
| `compose` | `compose.yml` | a compose file |
| `universe` | `charts` | a directory of chart directories |

`path` MUST be repo-relative and MUST NOT ascend. `..` and absolute paths are
refused, along with any character outside `[A-Za-z0-9._/-]`, by the same rule and
for the same reason as `kms.path` (HIP-0136 §1): the value reaches a clone as a
path segment, and a value that can traverse upward re-addresses the read.

### 3. Each kind is exactly one runtime primitive

| kind | build | release |
|---|---|---|
| `image` | BuildKit, `dockerfile.v0` frontend, the repo's Dockerfile | operator workload CR — `deploy.target.crd`, default `App` |
| `fn` | the same door with **no Dockerfile**: `hanzoai/pack` is the gateway frontend and detects the ecosystem | operator `Function` CR, invoked at `/v1/functions/{name}/invoke` |
| `chart` | nothing | one `HelmChart` — chart bytes and values, both from `path` |
| `compose` | nothing | the compose file at `path`, converted to that same `HelmChart` |
| `universe` | nothing | every chart under `path`, one release |

Two properties hold this together. `compose` is not a second delivery mechanism
but a *notation* that converts to the chart primitive, so nothing downstream of
the conversion can tell the difference. And `fn` differs from `image` only in
which BuildKit frontend runs and which CR receives the result — one build door
serves both, and `fn` MUST NOT add a second.

### 4. `kind` is not `deploy.target.crd`

Two fields spell a Kubernetes-shaped noun and they sit on different axes.

- `kind` names **what the repository is**, before anything is built.
- `deploy.target.crd` names **which operator CR a built image rolls onto** —
  `App` or `Service` — and is meaningful only for `kind: image`.

Conflating them would make `kind: chart` ask for a workload CR carrying an image
the chart lane never builds.

### 5. Compatibility

`kind` absent is `image`, and `image` is today's behaviour to the letter:

- `images:` present → build them (unchanged).
- `build:` present → build it (unchanged).
- neither, and no `deploy:` → the manifest declares nothing for the build lane
  (unchanged: platform's validator answers null, ci runs the `test:` gate).
- neither, with `deploy:` → still an error (unchanged).

A manifest naming `kind: chart`, `compose` or `universe` declares **no** image
lane, and `images:`/`build:` are meaningless in it. A reader MUST NOT answer
"nothing here" for such a manifest. That confusion is what this HIP removes.

### 6. Readers

`hanzo.yml` has four readers, and each must be taught `kind` on its own. Until it
is, a reader treats every manifest as `kind: image` — correct for the whole fleet
today, and wrong the moment a chart repository declares itself.

| reader | entry point | reads | what `kind` changes there |
|---|---|---|---|
| `hanzoai/ci` | `.hanzo/workflows/build.yml` — the `yq` expressions in `Test (per hanzo.yml)`, `KMS login`, `Build & push images`, `Build & publish binaries`, and the client and site steps | `test`, `images`, `kms`, `version`, `site`/`sites`, `client`, `binaries`, `bucket` | skip the image lane for `chart`/`compose`/`universe`; swap the frontend for `fn` |
| platform | `hanzoai/platform`, `pkg/platform/src/services/ci/platform-config.ts` — `validatePlatformConfig` | `images`, `build`, `deploy`, `e2e`, `publish`, `kms`, `source` | the schema and the validator, where `kind` is defined. Then `build-scheduler.ts` (schedules nothing for a chart kind, correctly, and releases nothing either), `buildkit-job.ts` (`--frontend=dockerfile.v0` → the pack gateway for `fn`), `build-completion.ts` (the chart release), `k8s/operator/cr-builder.ts` (a `HelmChart` is not one of `WORKLOAD_KINDS`) |
| `hanzo build` | `hanzoai/cloud`, `cli/commands.go` — `(*BuildReq).loadRecipe` | `binaries`, `bucket` | refuse a chart repository by name, rather than by "declares no binaries:" |
| the push reactor | `hanzoai/cloud`, `apps/git/build_on_push.go` — `readPipeline`, `pipelineFromBlob`, the `pipeline` struct | `images` | a `kind: chart` push MUST NOT be a silent no-op |

The build door itself — `hanzoai/cloud`, `apps/platform/runner.go` — reads no
`hanzo.yml`. The recipe reaches it verbatim in the request body, so it grows a
chart lane only when a caller sends one.

## Rationale

The obvious alternative is to keep inferring: a repository with a `Chart.yaml` is
a chart, one with a `compose.yml` is a compose project, one with neither is a
test gate. Inference costs nothing to adopt and cannot be made correct. A
repository may hold a chart *and* a Dockerfile — most of ours that hold a chart
do — so the files present do not order themselves, and every reader would need
the same precedence table, written four times, drifting from the day it lands.

The second alternative is a per-kind block: `chart: { path: … }`,
`compose: { file: … }`. It carries the same information as `kind` plus `path`
and reintroduces the ambiguity, because two blocks can be present at once.

One scalar naming the arrival, and one scalar saying where it reads from, is the
smallest thing that is unambiguous by construction.

## Security Considerations

`path` is attacker-influenced in the sense that matters: it is committed by
whoever can push to the repository, and it is consumed as a path segment against
a checkout and, for the chart kinds, against the directory whose bytes become a
release. An unchecked value reads outside the repository. §2 therefore fixes the
charset and refuses `..` at parse time rather than at each use site, which is the
same boundary discipline `kms.path` uses and for the same reason: validating once
where the value enters keeps every consumer safe without every consumer knowing.

`kind` itself grants nothing. It selects among primitives a caller could already
reach, and a value outside the closed set is refused rather than defaulted, so it
cannot be used to steer a manifest into an unintended lane.

## References

- HIP-0014 — Application Deployment Standard
- HIP-0036 — CI/CD Build System Standard
- HIP-0136 — One Secret, One Path

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
