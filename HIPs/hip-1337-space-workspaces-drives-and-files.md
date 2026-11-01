---
hip: 1337
title: Space — Sovereign Organization Workspaces, Virtual Drives & File Namespaces
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
capability: space
implementation-go: shipped
created: 2026-11-01
requires: HIP-0106, HIP-0118, HIP-1165
---

# HIP-1337: Space — Sovereign Organization Workspaces, Virtual Drives & File Namespaces

## Abstract

Package `space` (`/v1/space`) establishes a multi-tenant workspace, drive, and file abstraction layered over Hanzo's S-Chain distributed object store ([`hanzoai/s3`](https://github.com/hanzoai/s3)). While Hanzo IAM answers "who" (organization, team, user, agent), `space` answers "where" (namespaces, drives, and file trees).

This proposal specifies the virtual drive model, presigned zero-copy file uploads/downloads, and cardinality management across organizations and team spaces.

## Motivation

Direct object storage APIs expose low-level bucket management that conflicts with multi-tenant organization boundaries. Creating a discrete cloud bucket per drive causes high cardinality that severely degrades bucket listing performance and complicates billing attribution. Conversely, flat shared buckets lack organizational boundaries, permission inheritance, and human folder semantics.

`space` resolves this by decoupling logical drives from physical buckets: one physical bucket exists per `(org, space)` pair, and drives are represented as key prefixes within that bucket. This preserves sub-millisecond prefix listing, eliminates per-tenant bucket explosion, and enables billing rollups directly to the parent organization.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in RFC 2119.

### 1. Concepts and Hierarchy

* **Space**: An organization-owned namespace representing a functional domain (e.g. `engineering`, `legal`, `finance`). Billing attaches strictly to the owning organization.
* **Drive**: A named logical drive within a space. A drive is implemented as the first key segment of an S3 object path (`<org>-<space>/<drive>/...`).
* **Folder**: Emergent from `/` delimiters in object keys. No explicit folders table exists, preventing naming drift upon file renames.
* **Bucket Mapping**: Exactly one S3 bucket is provisioned per `(org, space)` pair. Name syntax matches `^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`.

### 2. Zero-Copy I/O via Presigned URLs

File payloads MUST NOT pass through the API gateway or control plane process:
* **Upload**: Clients call `POST /v1/space/:space/drives/:drive/files` to mint an authenticated presigned `PUT` URL against the public S3 endpoint.
* **Download**: Clients call `GET /v1/space/:space/drives/:drive/files/*` to mint an authenticated presigned `GET` URL.
* **Presign TTL**: Presigned URLs MUST expire after 5 minutes (`presignTTL = 5 * time.Minute`). The short TTL serves as the primary capability revocation window.

### 3. HTTP Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/v1/space` | List all spaces in the authenticated organization |
| `POST` | `/v1/space` | Create a new space |
| `GET` | `/v1/space/:space` | Get space metadata and storage stats |
| `DELETE` | `/v1/space/:space` | Delete a space and purge underlying buckets |
| `GET` | `/v1/space/:space/drives` | List drives in a space |
| `POST` | `/v1/space/:space/drives` | Provision a new drive prefix |
| `GET` | `/v1/space/:space/drives/:drive/files` | List files and folders within a drive prefix |
| `POST` | `/v1/space/:space/drives/:drive/files` | Request presigned upload URL |
| `GET` | `/v1/space/:space/drives/:drive/files/*` | Request presigned download URL |
| `DELETE` | `/v1/space/:space/drives/:drive/files/*` | Delete an object |
