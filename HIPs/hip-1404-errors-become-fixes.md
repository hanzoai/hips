---
hip: 1404
title: Errors Become Fixes
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-11-20
requires: HIP-0139, HIP-1347
---

# HIP-1404: Errors Become Fixes

## Abstract

A platform that runs agents can use them on itself. This HIP specifies one error type with one key, an aggregator that turns a counted fault into one issue in the repository that owns it, an autonomous run that fixes the issue, and a gate that merges the fix when it is green and touches nothing a person must sign off. It is closed by a check that the fault stopped.

## Motivation

Faults were stated four ways (a 5xx, a failed run, a failed job, a client crash) so one failure was four unrelated lines and none was a count. A count is what decides whether an issue is worth a run, and a fix is only a fix if the key it was filed under stops.

## Specification

The key words MUST, MUST NOT, SHOULD and MAY are to be read as in RFC 2119.

### 1. One error

1. A fault MUST state a `code`, a `place`, a `site` and a `reason`. `place` is a route pattern, a run's agent, or a job's name, never an address a caller typed. `site` is the error's own site when it has one, else its root cause and the shape of its message.
2. Its fingerprint MUST be a function of `code`, `place` and `site` and of nothing else.
3. Every non-2xx response MUST carry `fingerprint` and a non-empty `detail`. Every 5xx, every run that ends in error, every failed scheduled job and every client crash MUST be stated on the event bus under its fingerprint.
4. A run MUST NOT end in error without a reason.

### 2. Aggregation

1. A consumer of the error stream MUST count faults by (org, fingerprint) and route each to the repository that owns it by service, product or capability.
2. When a class's count within its window crosses that class's threshold the consumer MUST file exactly one issue for the fingerprint, however many replicas count it, and MUST restate it rather than comment as the count grows.
3. The issue MUST carry counts, first and last seen, the build and a bounded set of request ids, and MUST NOT carry personal data or a secret.
4. Every threshold, window and limit MUST be configuration an operator edits, and the default MUST do nothing.

### 3. From issue to run

1. An issue carrying the configured label, filed by the aggregator or by a person, MUST become one run on its repository, on one branch of its own, as a service identity. A run MUST reproduce the fault with a failing test before it fixes it, and MUST open one pull request that closes the issue.
2. Runs MUST be bounded by a per-run budget, a per-org daily count and a per-repository concurrency, all configuration. Work that does not fit MUST wait; no run may block another.
3. The aggregator MUST NOT read its own writes back as a person's request.

### 4. Gate

1. A pull request of a run MAY merge itself only when the repository allows it, the whole change was read, every required check is green on the head that was read, and no path in it is high risk. High risk is exactly what the repository's review gate treats as requiring a person's sign-off.
2. The merge MUST be at the head that was read. A change that fails the path rule MUST be left to a person and said once.
3. The change then ships through the repository's ordinary release.

### 5. Regression

A fixed fingerprint seen again in a release that contains the fix MUST reopen its issue with the evidence and MAY run again, up to a configured number of attempts. Nothing is reverted automatically.

### 6. Safety

Every autonomous act MUST be audited as the service identity before it is done; an act the trail cannot hold MUST NOT be done. A kill switch in the operator's configuration MUST stop the next act and end every live run.

## Rationale

The fingerprint is the unit because it is the one thing a fix can be measured against. Thresholds, budgets and the path rule are configuration or the review gate's own so that no figure lives in code and no second policy exists beside the one that already guards releases.

## Security Considerations

The service identity has the reach of the repositories it is configured for and nothing else. A high-risk path never merges without a person. An aggregator that read its own labels as a person's would loop; the rule in 3.3 forbids it.

## References

- HIP-0139: One capability, nine projections
- HIP-1347: Event-Driven Agent Reliability
