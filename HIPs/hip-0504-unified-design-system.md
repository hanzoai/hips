---
hip: 0504
title: Unified Cross-Platform Design System
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-06-24
requires: HIP-36
---

# HIP-504: Unified Cross-Platform Design System

## Abstract

This proposal defines the canonical design-system architecture for every Hanzo, Lux, and Zoo surface — web, native (React Native / Expo), and desktop (Tauri). It establishes one substrate (`@hanzo/gui`), one component library (`@hanzo/ui`), and brands as values (`@luxfi/ui`, `@zooai/ui`) rather than forks. A component is defined once, themed many times, and rendered everywhere. The standard is binding: per-brand component forks and brand-scoped substrates are non-conformant.

## Motivation

The ecosystem grew three parallel component systems for one concept: `@hanzo/gui` (a Tamagui + Tauri + React Native cross-platform substrate), a standalone `@hanzo/ui` (no relation to it), and per-brand forks (`@luxfi/ui`, `@zooai/ui`). The same `Button` existed three times, drifting independently. Every app chose a different way; brand changes meant editing N copies; cross-platform support was inconsistent. This is the complection this HIP removes.

## Specification

### Two orthogonal axes

Design-system concerns separate along two independent axes. Brand is one axis; it is **not** the substrate axis.

- **Substrate** (mechanism — how to render on web/native/desktop): tokens, themes, the compiler, accessible primitives. Brand- and app-agnostic.
- **Components** (composition — the parts): the design language, composed from substrate primitives. The single public surface apps import.
- **Brand** (values): theme tokens (color, type, radius, motion) plus a small set of brand-specific compositions. Brands re-implement nothing.

| | Substrate | Components |
|---|---|---|
| Generic | `@hanzo/gui` | `@hanzo/ui` |
| Domain (web3) | `@hanzo/gui-web3` | `@hanzo/ui-web3` |
| Brand (lux/zoo) | — *(forbidden)* | `@luxfi/ui`, `@zooai/ui` |

### Normative rules

1. **MUST — one definition.** Every component is defined exactly once (in `@hanzo/ui` / `@hanzo/ui-web3`). No duplicate component implementation may exist elsewhere in the dependency tree.
2. **MUST — substrate splits by domain, never by brand.** Cross-platform capability lives in `@hanzo/gui` (generic) or a domain module such as `@hanzo/gui-web3` (wallet-connect, chain selector, address/amount inputs, native QR/camera, hardware-wallet bridge). A brand-scoped substrate package (e.g. `@luxfi/gui`) is **non-conformant** — domain primitives are brand-agnostic and shared by Lux and Zoo alike.
3. **MUST — brand is a value, not a place.** `@luxfi/ui` / `@zooai/ui` are theme tokens plus brand-only compositions over `@hanzo/ui`. A new brand is a token set, not a component fork. Adding `@parsdao/ui` means writing a theme.
4. **MUST — one import per app.** An app depends only on its brand `ui` (`@hanzo/ui` for Hanzo). Importing `@hanzo/gui` directly from an app is non-conformant; the substrate is internal.
5. **MUST — stable public API.** Re-basing `@hanzo/ui` onto `@hanzo/gui` preserves its import surface; consuming apps upgrade without source changes.
6. **MUST — visual-regression gate.** Each migration phase is gated by a Playwright visual-regression suite: rendered output MUST match the pre-migration baseline within tolerance before the phase merges. Decomplecting the implementation MUST NOT change the user-visible pixels.

### Dependency spine

```text
@hanzo/gui ──┬── @hanzo/gui-web3        substrate: generic + crypto domain (shared)
             ▼
@hanzo/ui ───┴── @hanzo/ui-web3         components composed from the substrate
             ▼
@luxfi/ui  = @hanzo/ui(+web3) + lux theme + lux-only compositions
@zooai/ui  = @hanzo/ui(+web3) + zoo theme + zoo-only compositions
             ▼
Lux apps → @luxfi/ui   Zoo apps → @zooai/ui   Hanzo apps → @hanzo/ui   (one import each)
```

### Migration phases

Each phase builds green and passes the visual-regression gate before the next begins. No big-bang.

- **Phase 0 — Foundation.** `@hanzo/ui` takes a dependency on `@hanzo/gui` and re-bases its components as substrate compositions, keeping the public API identical. Standalone primitives are deleted.
- **Phase 1 — Brands.** `@luxfi/ui` and `@zooai/ui` become token/theme overlays on the new `@hanzo/ui`; brand-unique widgets re-expressed as substrate compositions.
- **Phase 2 — Adopt.** Sites and apps move to the unified brand `ui` and inherit web / native / desktop.

## Conformance

A package or app is conformant iff: it imports exactly one `ui` package (its brand's); it defines no component that already exists upstream; it contributes no brand-scoped substrate; and (for migration PRs) it passes the visual-regression gate. The `@hanzo/gui` developer reference is the gui-docs Architecture page; this HIP is the binding form.

## Security Considerations

The web3 substrate (`@hanzo/gui-web3`) is the single place key-handling primitives (wallet connect, hardware-wallet bridge, address entry) live, so security review and supply-chain scrutiny concentrate on one audited module rather than N brand forks. Brand packages, holding only tokens and compositions, carry no key-handling surface.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
