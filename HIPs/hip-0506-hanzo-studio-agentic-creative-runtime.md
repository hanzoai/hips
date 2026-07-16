---
hip: 0506
title: Hanzo Studio — Agentic Multi-Modal Creative Runtime
author: Hanzo AI Team
type: Standards Track
category: Application
status: Draft
created: 2026-07-15
requires: HIP-0106, HIP-0504
---

# HIP-506: Hanzo Studio — Agentic Multi-Modal Creative Runtime

## Abstract

Hanzo Studio is the one place to generate, refine, curate, and publish creative
work of **every modality** — image, product photography, packaging, video, music,
voice, 3D, documents (docx/xlsx/pptx/pdf), LaTeX papers, decks, sites, and social/
ad content — driven by chat. You talk to Studio; the agent either runs a saved
workflow **or** writes and runs arbitrary code in a sandbox; outputs land in one
per-org asset store; you curate, fork, and remix continuously. The ComfyUI node
editor becomes an **Advanced** view over the same substrate. This is a
**composition of already-shipped Hanzo cloud apps**, not a rewrite: `exec`/
`functions` (sandbox), `tasks` (durable queue), `gpu` (dispatch), `connectorruntime`
(Google Drive et al.). One and only one way.

## Motivation

Generative work today is fragmented across single-modality tools with no shared
catalog, no curation memory, no reuse of base assets, and no path from "chat" to
"editable pipeline." Hanzo already ships every substrate needed — a sandbox that
runs Python/Node/container isolated on a dedicated pool, a durable task queue,
GPU federation (BYO-GPU + cloud), a multi-tenant IAM/session/billing spine, and
the Studio engine with video/audio/music/3D node packs vendored. What is missing
is the **composition**: a chat-first surface, a preset/curation memory that makes
output get closer to intent each pass, and the wiring from the copilot to the
sandbox and queue. This HIP specifies that composition.

## Specification

### 1. Two planes — control vs compute (never braided)

**Control plane = the Go cloud binary (`apps.Wire`)** owns all state in one binary:
tenancy/IAM/session, the durable **`tasks`** queue (fronts `tasks.hanzo.ai`), the
**`gpu`** dispatch + BYO-GPU supervision, the **`exec`/`functions`** sandbox
(runs `python·node·go·deno·bash·container` isolated on `code-exec-pool`),
**`connectorruntime`** (external content), and a thin **`studio`** app for the
asset catalog/library, presets, and curation (per-org SQLite / Hanzo Base).

**Data plane = where compute runs** (stateless, no auth logic): GPU graphs on the
Hanzo Studio engine (BYO-GPU or cloud GPU) dispatched via `tasks`; arbitrary
agent/user code on the `exec` sandbox.

**Security boundary:** the control plane never executes agent/user code inline.
Agent code always goes to `exec`; GPU graphs always through `tasks`.
`go-embed-python` is **not** required — `exec` is the Python runtime; gpython is a
non-goal; the engine is never rewritten in Go.

### 2. Execution model — two verbs

The copilot has exactly two backends, both already built:
1. `run(workflow, inputs)` → enqueue on `tasks` → GPU worker → outputs.
2. `sandbox.exec(lang, code, files?, gpu?)` → `exec` app → outputs.

Node graphs are one shape of (1); anything a node can't express is (2). This is
full agentic flexibility with zero new runtime.

### 3. Creation KINDs + the dynamic questionnaire (core UX)

Each kind of thing = a **KIND** = parameterized workflow template + a
**questionnaire spec**. The copilot: (a) you pick/say a KIND; (b) it asks **only
what's missing**, a generative questionnaire grounded by your presets — never
asking what it can infer; (c) it **assembles/updates the backend workflow live**
as you chat (node graph via `tasks`→GPU, or `exec` code), runs it, shows the
result; (d) you **edit the built workflow in Advanced mode** or refine by chat.
New KINDs are themselves AI-buildable and saved per-org.

Seed KIND catalog (each = template + questionnaire on the substrate above):

| KIND | Substrate |
|---|---|
| Product photography (multi-view ecom: front·side·back) | Studio try-on/relight graph (karma pipeline generalized) |
| **Ghost mannequin** (product on invisible form, no person) | try-on graph, ghost preset — a reusable, forkable base |
| **3D fabric-drape form** (no person — dress-form/mannequin) | 3D cloth-drape sim to see how fabric hangs/drapes |
| **3D try-on** (garment on a 3D avatar/body) | garment → 3D body fit + drape |
| CAD → product mockup (fashion, packaging, any) | CAD/dieline → photoreal mockup graph |
| CAD → 3D product | multi-view 2D → 3D reconstruction (Hunyuan3D-class) |
| Social post / ad / marketing | image·video graph + brand preset + `exec` (copy, layout) |
| Marketing email | `exec` (HTML/MJML email + brand preset) |
| Sales deck · investor deck · guide | `exec` code-canvas + brand preset (Claude-Design pattern) |
| Video | Wan · LTX · Hunyuan · CogVideo |
| Music / audio / song | ACE-Step · `mugen` |
| Voice / narration | `koe` · `tts` · `livekit` (realtime) |
| Document (docx·xlsx·pptx·pdf) | `exec` (python-docx/openpyxl/python-pptx/weasyprint) |
| LaTeX academic paper | `exec` (tectonic/latexmk) — LaTeX, never .md |
| Deck / doc / site / app | `exec` code-canvas (Claude-Design pattern) |

**Preset library:** a rich, scrollable catalog of ready-to-use presets — model
presets, **ghost bodies** (2D + 3D forms), **ready-to-wear garments**, scenes,
brand/design-systems, doc/deck templates. Presets are the reuse primitive: save
once, fork/remix forever, never re-upload a base.

### Template sources — import, don't hand-build
Two existing libraries seed the KIND catalog; almost no pipeline is authored from
scratch:
- **Generative pipelines = imported Studio workflows.** Every vendored node pack
  ships canonical example workflows (Wan·LTXVideo·CogVideoX·
  HunyuanVideo for video, ACE-Step for music, Hunyuan3D-class for 3D, VideoHelper
  for edit). Import those (+ curated community graphs) as ready KIND templates —
  the broader set of video/music/3D/voice pipelines is a bulk **import**, not a
  build. A `studio import-workflows` step registers each pack's examples per-org.
- **App / site / doc / deck = the hanzo.app template library.** The org already
  has a deep set: `hanzoai/templates` (saas-landing · blog-platform ·
  analytics-dashboard · ai-chat-interface · ecommerce-storefront · social-feed ·
  kanban-board · crypto-portfolio · markdown-editor · …), plus `nextjs-template`,
  `chat-template`, `docs-template`, `papers-template`, `ecommerce-boilerplate`.
  These ground the **app/site KIND** (code-canvas via `exec` → preview → deploy via
  PaaS). The **Website/Prototype** template picks from this library.

So the "broader set of generative pipelines" and the app/site templates are both
**imported from what the org already ships**, then curated + made KINDs.

### 4. Presets = the grounded model; multi-view → reusable sources → 3D

Presets are the grounding ("the AI grounded learned model"): model presets, brand/
design-system presets, product & packaging templates. They pre-fill the
questionnaire and constrain generation so output is on-brand by default.

**Product pipeline (commerce-first):**
- Generate ecom product photography in **multiple views — front, side, back**;
  **each view is saved as a preset/source** in the store.
- Saved sources are **reused as inputs without re-uploading** — base and generated
  assets are continually refined, sorted, and organized in one library.
- **Multi-view 2D → 3D:** a workflow spins the saved front/side/back views into a
  **3D model** (Hunyuan3D-class multi-view reconstruction).
- **3D → variants:** render the 3D **stylized with a model** (lifestyle) **and
  product-only without any human** (packshot) for social / ads / marketing, and
  **stylized into documents and ad content**. From the 3D + brand preset, the same
  pipeline emits **social posts, ads, and videos**.

### 5. Curation → feedback loop → closer each time

Every asset carries a state (draft·approved·queued·published) plus **👍/👎 +
comments**. The signal grounds the next run: approved/👍 → positive exemplars
appended to the KIND's preset; 👎 + comment → negative constraints. The copilot
reads recent curation before assembling a workflow, so "more like the approved
ones, avoid the flagged look" is default. Endpoints: `POST /v1/library/status`
(exists) + `POST /v1/library/vote` + comments. Optional preset/LoRA distillation
later; no fine-tune required to improve.

### 6. Change any element · continuous remix

- **Change any element:** every element is addressable and editable — a strap or
  color (masked inpaint), a graph node (Advanced), a slide/cell/paragraph (`exec`).
  Nothing is monolithic; "change X, keep everything else" is a first-class op.
- **Continuous remix:** any output is an input. Remix/variate/fork endlessly;
  Studio is a loop, not one-shot generation.

### 7. Fork / clone

Workflows, **collections**, and design-systems are forkable per-org — clone a
proven workflow or collection to start a new production, document set, site, or
paper series from a known-good baseline (template + presets + curation baseline).
One verb (`fork`), any object.

### 8. Surfaces

- **Chat-first home (default):** monochrome Hanzo look, "What should we create?",
  design-system + template + model pickers, projects/assets below. Served by the
  `studio` cloud app.
- **Advanced mode:** the Studio node editor, itself editable by chat (the copilot
  reads+mutates the graph).
- **Specialized editor modes per KIND:** LaTeX paper editor (source + live PDF via
  `exec`), CAD→3D viewport, CAD→mockup, deck/doc/site code-canvas. Each is a
  front-end over the KIND's workflow; the node editor is the universal fallback.
- **CLI:** `hanzo studio` (login·generate·run·assets·pull) and `hanzo design-sync`
  (register a design-system package/tokens for the org). `hanzo.sh` installs the
  one binary.

### 9. Connectors — Google Drive (and beyond)

Reuse `connectorruntime` + provider APIs. **Google Drive** first: index/read Drive
files (Docs/Sheets/Slides + binaries) into the catalog as references; build/edit/
write-back Docs/Sheets/Slides and generated assets via an `exec` Drive-API flow.
OAuth per-user (Drive scope), tokens in KMS, per-org. One connector interface;
Notion/S3/GitHub drop in the same seam. The agent treats connector content as
just more inputs/outputs.

### 10. Multi-modal engines (already in-org / vendored)

Image: Qwen-Image-Edit, Flux, SDXL. Video: `wan2.2`, `ltx`, WanVideoWrapper,
LTXVideo, CogVideoX, HunyuanVideo, DiffuEraser, VideoHelperSuite. Music/audio:
ACE-Step, `mugen`. Voice: `koe`, `tts`, `livekit`/`live`/`stream`. 3D:
Hunyuan3D-class packs. Documents/papers: `exec` libs.

## Phased plan (reuse-first)

1. **Wire copilot → `exec` + `tasks`** — `sandbox.exec` and `run` tools on the
   existing clients. Unlocks documents, arbitrary generation, Drive edits.
2. **Chat-first monochrome home** — rebuild `studio_home.html` reading `/v1/library`;
   templates from vendored packs; KIND questionnaires.
3. **Thin `studio` cloud app** — port library/catalog/session/billing/presets into
   `apps.Wire()` (per-org SQLite).
4. **Curation + preset feedback loop** — votes/comments → preset exemplars.
5. **Product pipeline** — multi-view ecom → saved sources → CAD→mockup, CAD→3D,
   3D→(model & packshot)→social/ads/video.
6. **`hanzo studio` + `design-sync` CLI**; **Google Drive** connector; specialized
   editor modes (LaTeX, 3D).

## Compatibility (the one place we name ComfyUI)

In-product, workflows are **Hanzo Studio workflows** — we never surface the name
"ComfyUI." Externally, one compatibility statement holds:

> **Hanzo Studio workflows are compatible with the ComfyUI workflow format.**

Extent of support:
- **Graph/API format:** identical. Any ComfyUI workflow JSON (UI or API/prompt form)
  imports and runs in Studio unchanged; every asset's embedded graph is this format.
- **Node packs:** run **unmodified.** The engine is a fork with core packages
  renamed (`comfy*`→`studio*`, `Comfy*`→`Studio*`); the `studio_compat` meta-path
  shim aliases every `comfy*` import to its `studio*` counterpart at load, so
  upstream packs need no forking. We **vendor the latest** packs pinned by SHA
  (`custom_nodes/hanzo-packs.txt`) and track upstream.
- **Display:** all "ComfyUI" display strings are re-branded to Hanzo Studio; the
  compatibility is a capability, not a surface.

So: import any community/pack workflow, run any node pack, get the latest — with
zero "ComfyUI" anywhere in the product.

## Non-goals

Rewriting the Studio (Python) engine in Go; gpython; embedding torch/CUDA in the Go
binary; rebuilding a sandbox or queue (they exist); per-brand forks of the studio
surface (white-label by hostname per HIP-0504).

## Status

Substrate verified live 2026-07-15: `exec`/`functions` (python·node·go·deno·bash·
container), `tasks` (durable, embedded), `gpu` + BYO-GPU supervision,
`code-exec-pool` (2 nodes), studio monochrome + org switcher (`v0.15.5`), 439
karma assets indexed in-org. The work is composition + the chat-first surface.
