# Implementation audit — Go, C++ and Rust against the HIP corpus

Where each proposal's `implementation-go`, `implementation-cpp` and
`implementation-rust` would come from. One row per assessed HIP in
`.audit-runtimes.tsv`:

    <language>:<hip-number>	<shipped|partial|none>	<evidence>

The evidence is a path and line, or a symbol, that a reader can check. It is
kept because the front matter carries a verdict and a verdict without its
reasoning is a claim nobody can re-derive. Paths are relative to `~/work/hanzo`
unless they name another tree, in which case they are written out.

The audit read the code and looked for the HIP that specifies it, rather than
reading 260 proposals and guessing. A HIP absent from the file was not assessed
in that language — which is why `not assessed` is a column in the index and not
a zero.

## What was assessed

| | shipped | partial | none | assessed |
|:--|--:|--:|--:|--:|
| Go | 146 | 33 | 7 | 186 |
| C++ | 1 | 2 | 0 | 3 |
| Rust | 10 | 25 | 1 | 36 |

225 rows over 210 distinct HIPs; 14 HIPs carry a verdict in more than one
runtime. Go reaches all 122 capability proposals and 64 of the 121 remaining
Standards Track ones. Fifty proposals have no verdict in any runtime.

## How a Go verdict was reached for a capability

`type: Standards Track` with `capability: <name>` is 122 of the 260 proposals,
and `scripts/coverage.py` fixes what the key means: the HIP specifies the
`/v1/<name>` app the cloud serves. That makes the test mechanical, because
cloud publishes the surface it actually serves in two artifacts:

- `cloud/plugin/<name>/openapi.json` — the app binary's own projection of its
  live router, written when the binary is built. `cloud/openapi/openapi.go:1`
  states the property that makes it evidence rather than description: the
  document is read from `app.Fiber().GetRoutes()`, so there is no second route
  registry for it to drift from.
- `cloud/private.yaml` — those 127 subsets composed, 1,748 paths, held to the
  subsets by the composition proof in `cloud/mk/fleet.mk`.

A Go verdict here is therefore: the app binary exists, `manifest/apps.go`
routes it, and every route the HIP names resolves in the composed document.
`partial` means the HIP names an operation the fleet does not serve and does
not itself say so — several HIPs record their own gaps, and where they do, the
absence confirms the spec rather than contradicting it.

What this does not prove, and the artifact's own header says so, is that the
deployed edge delivers a path to the subsystem that publishes it. Only a probe
of the live host sees that. The working tree's `private.yaml` was regenerated
2026-09-04.

## What was left unassessed, and why

Hanzo's stack is mostly Go, Python and TypeScript. A proposal implemented in
Python or TypeScript is not `none` in Rust — it is unassessed, and recording
`none` would read as "we looked for Rust and there is none" when the honest
statement is that Rust was never the language for it. So the following carry no
row at all:

- **Model and training specs.** HIP-0002 (HLLM), 0003 (Jin), 0006 (per-user
  fine-tuning), 0039 (Zen) are architecture written over a Python pipeline.
  `node/hanzo-libs/hanzo-hmm` is a classical Hidden Markov Model and its own
  doc comment distinguishes itself from HLLM.
- **Frontend, docs and design.** HIP-0045, 0115, 0504, 0506 and their siblings.
- **Governance, process and meta.** The 13 Meta, 3 Process and 1 Informational
  proposals were not graded at all.
- **Repositories that are another language than the HIP's subject suggests.**
  `hanzo/operator` is Rust, so the Operator CRD HIPs are graded there and not
  in Go — HIP-0400 says so itself, marking Go parity deprecated. `hanzo/cli` is
  Rust; `hanzo/platform` is TypeScript; `hanzo/registry` is empty;
  `hanzo/llm` does not exist.
- **C++ almost everywhere.** The complete original C++ in the estate is
  `datastore/src/Server/ZAP/` (372 lines), `bot-cpp` (1,197 lines of
  header-only retrieval algorithms that no HIP specifies), and authored kernels
  inside otherwise-forked CUDA/Metal/HIP crates. The 675,725 lines under
  `datastore/src` are a ClickHouse rebrand, 173,406 under `forks/llama.cpp` are
  upstream, `redis` and `kv` are C rather than C++, and
  `insights/common/insightsql_parser` is a renamed PostHog parser. Three rows
  is the true size of the C++ intersection.

## Six rows collide with the corpus's own Final-versus-none check

`scripts/lint-hips.py` FM011 refuses `status: Final` alongside
`implementation-go: none`, on the ground that both are claims about one body of
code and one of them is wrong. Six rows trip it:

    go:0065  Backup & Disaster Recovery Standard
    go:0089  DRBG / Randomness Beacon (SP 800-90A/B)
    go:0098  Governance / Upgrade Keys (ML-DSA-87 / SLH-DSA cold roots)
    go:0103  Bridge PQ-Only Profile
    go:0521  Org Hierarchy
    go:0902  Proof of Code — Consensus over Git Refs

Applying them means first deciding whether each proposal is really Final.
HIP-0521 answers for itself: its §136 reads "Not yet implemented." The seventh
`none`, HIP-0142, is Draft and raises no contradiction.

## Three Final crypto proposals name a canonical file that was never written

`~/work/lux/consensus/protocol/auth/` holds `account_id.go`,
`contract_profile.go`, `hash.go`, `permit.go`, `precompile.go`,
`scheme_ids.go` and `tx_envelope.go`, with tests. Four HIPs cite files in that
package as their canonical reference and three of those files are absent:
`beacon.go` (HIP-0089), `governance.go` (HIP-0098) and `bridge_profile.go`
(HIP-0103, which names it three times). The pattern is not that the package is
missing — HIP-0085, 0086, 0087 and 0088 each name a file in it that is there,
with a test beside it, and each is `shipped`. It is that three siblings were
marked Final against a reference nobody wrote.

HIP-0104 is the same shape one layer up. `precompile.go:50` pins
`PrecompileAddrPQVerifyMLDSA65 = 0x301` and declares the four function-pointer
types, but the EVM wiring it names — `coreth/core/vm/contracts_pq.go` and
`coreth/precompile/pqverify/` — is not present, so four PQ precompile addresses
are declared and nothing dispatches to them.

## Threshold ML-DSA is implemented and the daemon does not use it

`~/work/lux/pulsar/pkg/pulsar` genuinely implements distributed BCC signing and
DKG — `bcc_sign.go:131`, `distributed_bcc.go:398 NewDistributedBCCSigner`,
`dkg_gpu.go`. The seam that would expose it does not reach it:
`pkg/pulsard/engine.go:67` registers only `Unimplemented()`, and
`reference.go:41 ReferenceDealer` says in its own comment that it "performs no
threshold protocol: it simply signs with the group secret it holds." Q-Chain
finality (HIP-0079) depends on threshold signing, so what is running underneath
it is a trusted dealer. HIP-0084 is Final.

## A capability's operations exist at an address one letter from its spec

HIP-0139 §2.2 settled that the singular is canonical and the plural is a rewrite
the router performs at the door. Three capability HIPs still write the plural in
their own route tables, and in one case it is the whole surface:

- **HIP-1181 (plan)** names fifteen operations under `/v1/plans`.
  `manifest/apps.go:138` gives the app `/v1/plan`, and all fourteen served
  routes are there. `cloud/plugin/skills/main.go:26` names this defect in
  passing — "apps/plan, whose name was one letter off its prefix". Three of the
  HIP's operations (`/cloud`, `/entries`, `/seed`) exist under neither
  spelling, which is why the row is `partial`.
- **HIP-1203 (affiliate)** and **HIP-1143 (referral)** write
  `/v1/admin/affiliates/*` and `/v1/admin/referrals/*`; the manifest and the
  router carry the singular, and every operation each HIP lists resolves there.
  Both are `shipped`.

HIP-0129 (eval) is the same disagreement running the other way: §3 declares the
surface "singular throughout" and the router serves `datasets`, `evaluators`,
`rubrics`, `runs`, `scores` and `traces`, with no `judge`, `experiment`, `queue`
or `health` at all.

## A Final HIP citing a manifest line for a row that does not exist

HIP-1120 states "Every route is under `/v1/crm` (`manifest/apps.go:273`)".
There is no `crm` row in `manifest/apps.go` — line 273 is a comment inside the
`dataset` row — and no `/v1/crm` path exists in `cloud/private.yaml`. The Go
code is real and at another address: `cloud/apps/crm/crm.go:1` declares
companies, contacts, opportunities and applications as framework DocTypes in
module `crm`, registered by the blank import at `cloud/plugin/framework/main.go:25`
and served through the generic `/v1/framework/*` surface.

That is one instance of a pattern the Go pass hit repeatedly: the
implementations mostly exist and the pointers rotted. HIP-0004 names
`hanzoai/llm`, absent, while the LLM gateway is pure Go in `hanzoai/ai`;
HIP-0027 names `hanzoai/kms`, whose `DEPRECATED.md` retires it in favour of
`luxfi/kms`; HIP-0036 names `hanzoai/build`, absent; HIP-0033 names
`hanzoai/registry`, empty, for a surface served by `cloud/apps/registry`;
HIP-0111 names `hanzoai/iam2`, which does not exist, for a surface in
`hanzoai/iam`. HIP-0122 is the one that would mislead a reader most: it names
the right module, `github.com/zap-proto/zip` at `~/work/zap/zip`, while a dead
`hanzoai/zip` sits in the tree whose `ZAPListen` returns "zip: ZAP wire dispatch
not yet implemented" and whose own `DEPRECATED.md` says it must not be imported.

## Twelve operator CRDs are declared and nothing watches them

`operator/` is Rust, and four of its Kinds reconcile: Service (HIP-0400),
Datastore (0401), SQL (0402), KV (0403) and Ingress (0411) each have a
controller registered in `operator/src/main.rs`. Twelve more are declared in
`operator/src/crd.rs` and installed by `operator/src/install.rs` with no
watcher: DocDB, S3, DNS, Base, IAM, KMS, LLM, Gateway, MPC, Network, Indexer,
Explorer. Five of those HIPs cite a reconciler file by name —
`controllers/dns.rs`, `controllers/gateway.rs`, `controllers/mpc.rs`,
`controllers/network.rs`, `controllers/baseapp.rs` — and none of those files
exists; `operator/src/controllers/` holds app, bitcoin, chain, datastore,
ethereum, ingress, kms, kv, service, solana, sql, tenant and upgrade. Applying
one of those CRs materializes nothing.

A Go answer exists for four of them, under a different API group:
`nchain/api/v1alpha1/{gateway,network,indexer,explorer}_types.go` with
controllers and generated CRD YAML, published as `nchain.hanzo.ai/v1alpha1`
rather than the `hanzo.ai/v1` the HIPs pin. That is why HIP-0412, 0414, 0418
and 0419 carry both a Go and a Rust row, each `partial` for a different reason.

## A compliance surface that is built, required, and not mounted

HIP-0518 (Final) specifies `/v1/aml`. It is fully served in Go by
`~/go/pkg/mod/github.com/luxfi/aml@v0.3.5/pkg/api/routes.go:201-211` — the
transaction post, the case lifecycle, the rule list and the rule test — in a
module `cloud/go.mod` pins at v0.3.5. Cloud references it only in comments, and
`cloud/apps/risk/determine.go:39` states it plainly: "This binary does not link
it and does not make one — the AML plane at /v1/aml."

## Five capabilities the cloud serves have no HIP and no ratchet line

`manifest/apps.go` carries rows for `ci` (2 routes), `market` (33), `space`
(6), `standing` (1) and `trust` (16), and no HIP declares any of them.
`capability-coverage.txt`, which is where a capability without a spec is
supposed to be recorded, carries only `zen` and `plugins`. This is an
observation about `manifest/apps.go` and the corpus, not a claim about what
`scripts/coverage.py` would report: that gate reads `fleet:` from
`hanzoai/openapi`'s `capabilities.yaml`, and the checkout of that file at
`~/work/hanzo/openapi/capabilities.yaml` has no `fleet:` block, so it is older
than the mechanism the script describes.
