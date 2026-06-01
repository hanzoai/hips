---
hip: 0428
title: chat
author: Hanzo Platform Team
type: Informational
category: Service Catalog
status: Final
created: 2026-05-19
---

# HIP-428: chat

## Abstract

Hanzo Chat is the conversational AI front-end (HIP-011): browser UI + Express backend talking to the LLM gateway. Supports 14 Zen models, 100+ third-party, MCP tools, file uploads, threads. Parked at replicas=0 during the current consolidation.

## CRD Kind

Managed by `kind: Service` ([HIP-400](hip-0400-service-crd.md)).

## Upstream

Fork of `mckaywrigley/chatbot-ui` family, heavily diverged.

## Source

- Repo: derived from the image (`ghcr.io/hanzoai/chat:0.7.9`)
- Image: `ghcr.io/hanzoai/chat:0.7.9`
- Current replicas in `do-sfo3-hanzo-k8s`: 0

## CR location

`~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/chat.yaml`

## Ingress

- Public hosts: `chat.hanzo.ai`, `hanzo.chat`
- Internal: `chat.hanzo.svc.cluster.local`

## Dependencies

Gateway (LLM), Meilisearch (search), SQL (threads), KV (session), IAM SSO, RAG API.

## Status

Active in cluster `do-sfo3-hanzo-k8s` at replicas=0 as of 2026-05-18 snapshot.
