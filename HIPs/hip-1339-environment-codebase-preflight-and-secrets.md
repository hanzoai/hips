---
hip: 1339
title: Environment — Codebase Pre-Flight Environments, Sandboxed Scripts & Scoped Secrets
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
capability: environment
implementation-go: shipped
created: 2026-11-01
requires: HIP-0106, HIP-0118, HIP-0136, HIP-1146, HIP-1330
---

# HIP-1339: Environment — Codebase Pre-Flight Environments, Sandboxed Scripts & Scoped Secrets

## Abstract

Package `environment` (`/v1/environment`) defines the pre-flight execution contract for software repositories before autonomous coding agents and execution harnesses launch. It standardizes the installation commands, background daemon start commands, and repository-scoped secret references required to make a codebase build, test, and run.

This proposal specifies the separation between proposed setups and saved environments, and the strict isolation of repository secrets in Hanzo KMS.

## Motivation

Autonomous coding agents (such as `hanzo dev`) operate inside ephemeral microVM sandboxes (`hanzoai/kata`, `hanzoai/visor`). When an agent clones a codebase, it requires specific dependency installations (e.g. `npm install`, `cargo fetch`) and background services (e.g. database daemons, mock servers).

Without a standardized environment contract, agents either repeatedly guess build configurations or require manual developer intervention for every session. Furthermore, hardcoding development secrets into repositories or committing `.env` files violates zero-trust principles. A unified, repo-scoped environment specification provides reproducible agent runs while ensuring sensitive credentials stay sealed in KMS.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. The Environment Lifecycle

* **Setup Run**: When an unconfigured repository is initialized, a setup agent explores the repository tree, detects toolchains, tests build commands, and generates an `Environment` proposal (`state = proposed`).
* **Saved Environment**: A human administrator reviews and saves the environment (`state = ready`). Once saved, every subsequent agent run executes the defined scripts automatically.
* **Script Limits**: Install scripts and start commands MUST NOT exceed 16 KiB (`scriptCap = 16 << 10`).

### 2. Secret Custody & Injection

* Secrets associated with a codebase are stored as **names only** in the environment manifest.
* Plaintext secret values MUST be sealed directly in Hanzo KMS under canonical paths:
  `/orgs/<org>/environment/<repo>/<SECRET_NAME>`
* The API endpoints (`GET /v1/environment`, `GET /v1/environment/:repo`) MUST NEVER return plaintext secret values. Values are injected directly into ephemeral sandbox memory at runtime via KMS grants.
* Secret values are capped at 64 KiB (`valueCap = 64 << 10`).

### 3. HTTP Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/v1/environment` | List environments for all repositories in the organization |
| `GET` | `/v1/environment/:repo` | Get environment configuration for a specific repository |
| `PUT` | `/v1/environment/:repo` | Save install commands, start commands, and environment settings |
| `DELETE` | `/v1/environment/:repo` | Remove repository environment and purge associated secrets |
| `PUT` | `/v1/environment/:repo/secrets/:name` | Set or update a repository-scoped secret (sealed in KMS) |
| `DELETE` | `/v1/environment/:repo/secrets/:name` | Revoke a repository-scoped secret |
