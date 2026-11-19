---
hip: 1344
title: Agent-Optimized Storage and Recovery
author: Zach Kelling, Hanzo AI Research
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
created: 2026-11-16
requires: HIP-0119, HIP-0302, HIP-1342, HIP-1343
---

# HIP-1344: Agent-Optimized Storage and Recovery

## Abstract

This specification defines experimental storage fast paths, checkpoint planners, recovery contracts, and integrity extensions for Hanzo's object-backed workspace stack: `hanzoai/vfs` writing through `hanzoai/s3` and mounted into `hanzoai/visor` sandboxes. It establishes the architectural boundaries and falsifiable acceptance criteria for Research Bounties #1 through #10, preserving the frozen `vfs` format-v2 layout, monotone fencing, and post-quantum sealing invariants defined in HIP-1342 and HIP-0302.

## Motivation

Interactive coding agents generate irregular storage traffic characterized by frequent small unaligned metadata writes, sparse build trees, shared base images across concurrent tenants, periodic volume checkpoints, and host daemon restarts. While core journal integration and asynchronous garbage collection are tracked separately (`vfs` issues #9–#31), ten orthogonal workload bottlenecks remain: unaligned partial-write copies, extent-index memory bloat on large sparse files, high request amplification during bulk checkpoint IO, cross-layer entropy in sealed base images, cold toolchain reads, lifetime mixing during object packing, full-volume delta restores, process-only FUSE crashes, host-guest boundary copies, and end-to-end storage media integrity below encryption.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

### 1. Canonical Stack Boundary

Implementations targeting this HIP MUST compose cleanly within the canonical stack:

1. `hanzoai/vfs` owns local journaling, chunking, extent indexing, sealing, and object publication.
2. `hanzoai/s3` owns durable object storage, conditional publication (`If-Match`), placement, and compaction.
3. `hanzoai/visor` owns guest-host virtualization transport and FUSE mount lifecycles.
4. No optimization under this HIP MAY alter the frozen `vfs` format-v2 object layout, break cross-tenant cryptographic isolation (`HIP-0302`), or relax locally acknowledged `fsync` durability.

### 2. Storage, Packing, and Restore Extensions (Bounties #1–#7, #10)

#### 2.1 Partial-Write Absorption (Bounty #1)
`hanzoai/vfs` MAY buffer small unaligned journal writes in a dedicated scrap buffer while bypassing page copies for large aligned writes. Any implementation MUST report 4 KiB random-write throughput, CPU utilization, and write amplification against `journal` `main` using identical durability fences.

#### 2.2 Compact Sparse-Range Indexing (Bounty #2)
`hanzoai/vfs` MAY maintain an in-memory range index for journal spans and sparse extents without rewriting the format-v2 persistent B-tree. Acceptance tests MUST report bytes per extent, lookup p99 latency, and behavior on sparse files up to 1 PiB.

#### 2.3 Grouped Checkpoint IO (Bounty #3)
`hanzoai/vfs` and `hanzoai/s3` MAY schedule grouped multi-object IO batches for bulk checkpoint uploads and downloads while preserving per-Head S3 conditional consistency semantics. Benchmarks MUST report throughput (`bytes/s`) and S3 request count per GiB transferred.

#### 2.4 Similarity-Clustered Immutable Base Images (Bounty #4)
Before sealing and packing immutable read-only base images (`hanzoai/visor` / `hanzoai/vfs`), builders MAY cluster chunks by content similarity. Mutable tenant workspaces MUST NEVER share similarity groups across trust boundaries. Measurements MUST cover compression ratio, cold-start latency, and read amplification.

#### 2.5 Selective Hot-Data Mirroring (Bounty #5)
`hanzoai/vfs` MAY evaluate selective RAM/NVMe mirroring versus standard cache-tier migration for immutable shared toolchains, measuring p99 read latency and resident host memory per active sandbox.

#### 2.6 Lifetime-Aware Object Packing (Bounty #6)
Independent of asynchronous garbage collection (`hanzoai/vfs#24`), `hanzoai/vfs` MAY segregate short-lived ephemeral build outputs from long-lived workspace objects during initial pack construction. Experiments MUST quantify live-data copy reduction and storage amplification.

#### 2.7 Parallel Delta Restore (Bounty #7)
`hanzoai/vfs` MAY implement an experimental parallel delta planner for transfers between compatible sealed checkpoints, measuring delta bytes transferred, wall-clock restore time, and host CPU overhead.

#### 2.8 End-to-End Journal Integrity (Bounty #10)
`hanzoai/vfs` MAY emit hardware end-to-end data protection tags on supported NVMe devices alongside a software-only integrity verification path. Fault-injection tests MUST corrupt media blocks beneath the encrypted object layer and measure detection coverage and throughput cost.

### 3. Virtualization & Daemon Recovery Extensions (Bounties #8–#9)

#### 3.1 Transparent FUSE Daemon Recovery (Bounty #8)
Distinct from journal crash replay (`hanzoai/vfs#9`), `hanzoai/visor` SHOULD investigate restarting a crashed host-side FUSE daemon and re-attaching active mount handles where the host kernel supports FD preservation. Crash tests MUST prove zero loss of locally acknowledged `fsync` operations across process-only daemon kills.

#### 3.2 Virtualization-Boundary Fast IO (Bounty #9)
Only after profiling confirms host-to-guest gofer IO as a primary bottleneck, `hanzoai/visor` MAY prototype reduced-copy transport paths preserving gofer isolation boundaries and measuring syscall counts, memory copies, and task completion latency.

### 4. Research Integrity & Acceptance Contract

Published results from referenced FAST proceedings belong strictly to the original authors' environments and MUST NOT be cited as Hanzo performance claims until reproduced inside Hanzo repositories. Implementation PRs MUST clear Apache-2.0/MIT compatibility and patent checks before merging into production.

## Rationale

Grouping these ten storage and virtualization investigations under one HIP prevents fragmentation of `vfs` format guarantees and avoids accidental reinvention of parallel filesystem layers while still letting contributors validate aggressive IO hypotheses behind feature flags.

## Security Considerations

Improper cross-tenant deduplication or unauthenticated delta/mirror caches could create side channels or state leaks between sandboxed organizations. Similarity clustering (§2.4) and mirroring (§2.5) MUST remain strictly confined either to verified immutable public base images or within a single cryptographic tenant scope. End-to-end integrity tags (§2.8) MUST detect silent storage corruption prior to plaintext exposure.

## References

- HIP-0119 — Hanzo Service Conventions
- HIP-0302 — Encrypted SQLite Replication Standard
- HIP-1342 — Disk — A Filesystem on an Object Store
- HIP-1343 — Visor — The Sandbox Runtime
- `hanzoai/vfs`, `hanzoai/s3`, `hanzoai/visor`

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
