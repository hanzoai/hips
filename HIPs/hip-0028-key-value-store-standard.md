---
hip: 0028
title: Key-Value Store Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
---

# HIP-28: Key-Value Store Standard

## Abstract

This proposal defines the standard for Hanzo KV, the high-performance key-value store
that serves as the shared caching, session, pub/sub, and streaming backbone for all
services in the Hanzo ecosystem. Hanzo KV is built on Valkey 8.1, the Linux Foundation
fork of Redis, and is distributed as `ghcr.io/hanzoai/kv:latest`. It exposes the RESP3
wire protocol on port 6379 and is a drop-in replacement for any Redis client.

**Repository**: [github.com/hanzoai/kv](https://github.com/hanzoai/kv)
**Port**: 6379
**Docker**: `ghcr.io/hanzoai/kv:latest` and `docker.io/hanzoai/kv:latest`
**License**: BSD-3-Clause

## Motivation

Every service in the Hanzo ecosystem -- IAM, LLM Gateway, Cloud, Chat, Commerce, Bot,
Analytics, Zen -- needs a fast shared store for at least one of the following:

1. **Session and token caching**: OAuth tokens, rate-limit counters, CSRF nonces
2. **Pub/Sub messaging**: real-time event propagation between services
3. **Streams**: append-only logs for audit trails and event sourcing
4. **Ephemeral state**: inference request queues, job locks, circuit-breaker state
5. **Leaderboard/sorted-set operations**: billing rank, usage tracking

Previously, the Hanzo infrastructure relied on the Bitnami Redis Helm chart deployed via
`helm install redis bitnami/redis`. This worked, but introduced three problems:

- **Licensing risk**: Redis Labs changed Redis to a dual-license model (RSALv2 + SSPLv1)
  in March 2024. Both licenses restrict how cloud providers and SaaS platforms can
  distribute Redis. For an infrastructure company like Hanzo that ships managed services,
  this is a direct legal exposure.
- **Operational opacity**: The Bitnami chart bundles a metrics sidecar (redis-exporter),
  init containers, and Sentinel by default. When any of these sidecars fail (e.g., the
  exporter cannot authenticate to a password-protected instance), the entire pod enters
  CrashLoopBackOff and the root cause is obscured.
- **Image bloat**: The Bitnami Redis image is ~150MB compressed. A minimal Alpine-based
  Valkey image is ~12MB. In a cluster with rolling updates, smaller images mean faster
  pulls and shorter disruption windows.

Hanzo KV solves all three by replacing the entire Bitnami stack with a single,
purpose-built container image based on Valkey.

## Design Philosophy

This section explains every major design decision and why the alternatives were rejected.
Infrastructure choices compound -- a wrong call here propagates to every service that
touches KV. Each heading below addresses one decision.

### Why Valkey over Redis

In March 2024, Redis Ltd. changed the Redis license from BSD-3-Clause to a dual license:
Redis Source Available License v2 (RSALv2) and Server Side Public License v1 (SSPLv1).
Under both licenses, a company that provides Redis as part of a managed service (which
Hanzo does, via cloud.hanzo.ai and the Hanzo PaaS) must either negotiate a commercial
license with Redis Ltd. or open-source its entire management stack under SSPL terms.

Within weeks of the license change, the Linux Foundation announced Valkey, a community
fork of Redis 7.2.4 under the original BSD-3-Clause license. The founding contributors
include engineers from AWS (who maintained ElastiCache), Google Cloud (Memorystore),
Oracle, Ericsson, and Snap. Valkey is not a clean-room rewrite; it is a direct fork with
full commit history, which means every Redis command, data structure, and protocol
behavior is preserved identically.

Valkey 8.0 shipped in September 2024 with multi-threaded I/O and RDMA support. Valkey
8.1 (our current production version) added over-memory hash-table optimization and
improved cluster slot migration. Performance benchmarks show Valkey 8.1 matching or
exceeding Redis 7.4 on all standard workloads, with up to 2x throughput improvement on
multi-core machines due to the new I/O threading model.

The decision is straightforward: identical functionality, better performance, no
licensing risk, stronger community governance.

### Why Not Dragonfly or KeyDB

**Dragonfly** is an impressive in-memory store that claims 25x throughput over Redis
on a single node. However, Dragonfly uses the Business Source License (BSL 1.1), which
has the same restrictions as RSALv2 for managed-service providers. Using Dragonfly would
trade one licensing problem for another. Additionally, Dragonfly's internal architecture
(shared-nothing per-core sharding) means it does not support all Redis commands
identically -- notably, Lua scripting semantics differ in edge cases around
cross-slot operations.

**KeyDB** was a promising multi-threaded Redis fork from Snap Inc. However, after Snap
acquired KeyDB in 2022, active development slowed significantly. The last major release
(v6.3.4) is over a year old. The project has 200+ open issues with no maintainer
responses. For production infrastructure, depending on an effectively-abandoned project
is unacceptable.

**DragonflyDB** and **Kvrocks** (Apache-2.0, RocksDB-backed) were also evaluated.
Kvrocks is interesting for disk-backed workloads but adds latency (~1ms vs ~0.1ms)
that matters for our hot-path token validation. Dragonfly's BSL disqualifies it.

Valkey wins on all axes: open license, active governance, wire compatibility, and
production-proven at hyperscaler scale.

### Why Single Instance over Cluster Mode

Hanzo KV currently runs as a single-instance StatefulSet with 2Gi of PVC storage and
a 2Gi memory limit. This is a deliberate choice, not a shortcut.

**Scale math**: Our current production dataset (sessions, rate-limit counters, cache
entries across all services) occupies approximately 400MB of memory. Even with 10x
growth, we stay under 4GB. A single Valkey instance on modern hardware can saturate a
10Gbps NIC at ~1.2 million ops/sec. Our peak observed throughput is approximately 8,000
ops/sec. We are three orders of magnitude below the single-node ceiling.

**Cluster complexity**: Redis Cluster (and by extension Valkey Cluster) introduces hash
slots, cross-slot restrictions on multi-key operations, MOVED/ASK redirects, and cluster
bus gossip traffic. Every Redis client library must understand cluster topology. Some
operations (MULTI/EXEC across slots, Lua scripts touching multiple keys on different
slots) simply do not work. This complexity buys horizontal scaling we do not need.

**Failure modes**: A single instance has exactly one failure mode -- the pod dies and
restarts. With AOF persistence, data loss on restart is bounded to the last fsync
interval (1 second by default). A cluster has N failure modes: split-brain during
network partition, slot migration failures, gossip protocol desynchronization, and
partial availability when a master is down and its replica has not yet been promoted.

**Vertical ceiling**: DOKS nodes support up to 64GB of memory. We can scale the KV
StatefulSet to 32GB before even considering cluster mode. When we reach that point
(which would imply ~80x current load), we will revisit with a separate HIP.

### Why StatefulSet over Deployment

A Deployment with `replicas: 1` and a PVC looks similar to a StatefulSet, but the
semantics differ in ways that matter for a database:

- **Stable network identity**: StatefulSet guarantees the pod is always named
  `redis-master-0`. Other services can rely on this for debugging and log correlation.
- **Ordered, graceful shutdown**: StatefulSet sends SIGTERM and waits for the pod to
  flush AOF before killing it. A Deployment may kill the old pod before the new one is
  ready, causing brief unavailability.
- **PVC lifecycle**: StatefulSet PVCs survive pod deletion and rescheduling. With a
  Deployment, accidental `kubectl delete deployment` also deletes the ReplicaSet, and
  depending on PVC reclaim policy, you may lose data.
- **Rolling update safety**: StatefulSet guarantees at-most-one semantics -- the old pod
  is fully terminated before the new one starts. This prevents two instances fighting
  over the same PVC.

The StatefulSet name is `redis-master` (not `kv` or `hanzo-kv`) for backward
compatibility. Every service in the cluster connects to `redis-master.hanzo.svc:6379`.
Renaming the StatefulSet would require coordinated updates to IAM, Cloud, Console,
Gateway, Bot, Analytics, Zen, and every other service that references the hostname.
The cost of renaming exceeds the benefit.

### Why We Removed the Metrics Sidecar

The Bitnami Redis chart ships with a `redis-exporter` sidecar that scrapes `INFO` output
and exposes Prometheus metrics on port 9121. When we migrated to Hanzo KV with password
authentication, the exporter sidecar could not authenticate because it expected the
password in a different environment variable format than our secret layout provided.

Rather than debug the exporter's authentication logic and add another secret reference,
we removed the sidecar entirely. The reasoning:

- Valkey's built-in `INFO` command already provides all metrics (memory, connections,
  keyspace, replication, persistence) in a machine-parseable format.
- For our current scale, `kubectl exec` into the pod and running `kv-cli INFO` is
  sufficient for debugging.
- When we need continuous Prometheus metrics, we will deploy `oliver006/redis_exporter`
  as a separate Deployment (not a sidecar) with its own authentication config, decoupled
  from the KV pod lifecycle.

**Principle**: a database pod should contain exactly one process -- the database. Every
sidecar is a potential crash-loop vector that takes the database down with it.

### Why AOF-Only Persistence (No RDB Snapshots)

The `kv.conf` ConfigMap sets `appendonly yes` and `save ""` (disables RDB snapshots).

**AOF** (Append Only File) logs every write operation. On restart, Valkey replays the
log to reconstruct state. The file grows over time but is compacted automatically via
`BGREWRITEAOF`.

**RDB** snapshots are point-in-time binary dumps. They are smaller and faster to load
but create a gap: data written between the last snapshot and a crash is lost.

For our workload (sessions, caches, rate-limit counters), AOF is the right choice:

- Most data is ephemeral (TTL < 1 hour), so total AOF size stays small.
- The 1-second fsync window is acceptable -- losing the last second of rate-limit
  counters or cache entries on a pod restart is not a data integrity issue.
- RDB snapshots cause periodic latency spikes due to `fork()` -- the kernel must
  copy-on-write the entire memory space. On a 2GB instance this takes ~50ms, but it
  scales linearly and becomes problematic at larger sizes.

### Why Dangerous Commands Are Disabled

The ConfigMap includes:

```
rename-command FLUSHDB ""
rename-command FLUSHALL ""
```

These commands delete all data instantly with no confirmation and no undo. In a shared
KV instance used by 10+ services, a single `FLUSHALL` (whether from a misconfigured
service, a debugging session, or an attacker with the password) would simultaneously
break sessions for every user across every Hanzo service.

Disabling these commands at the configuration level means they cannot be executed even
with valid authentication. If we genuinely need to flush data (e.g., during a migration),
we can temporarily re-enable them by editing the ConfigMap and restarting the pod.

## Specification

### Wire Protocol

Hanzo KV implements RESP3 (REdis Serialization Protocol version 3) as defined by the
Redis protocol specification. All commands from the Redis 7.2 command set are supported.
Any client library that speaks RESP2 or RESP3 is compatible.

### Connection Parameters

```yaml
host: redis-master.hanzo.svc.cluster.local
port: 6379
password: <from K8s secret "redis", key "redis-password">
db: 0           # default database
protocol: resp3  # RESP3 preferred, RESP2 accepted
tls: false       # intra-cluster, TLS not required
```

### Client Connection String

Services should construct their connection URL as:

```
redis://:${REDIS_PASSWORD}@redis-master:6379/0
```

Or for explicit host within the hanzo namespace:

```
redis://:${REDIS_PASSWORD}@redis-master.hanzo.svc.cluster.local:6379/0
```

### Configuration Reference

The production `kv.conf` (mounted from ConfigMap):

```conf
# Persistence: AOF only, no RDB snapshots
appendonly yes
save ""

# Eviction: LRU when memory limit is reached
maxmemory-policy allkeys-lru

# Safety: disable destructive bulk operations
rename-command FLUSHDB ""
rename-command FLUSHALL ""
```

Additional settings applied via container command-line arguments:

```
--requirepass $(REDIS_PASSWORD)   # authentication
--dir /data                       # persistence directory
--bind 0.0.0.0                    # accept connections on all interfaces
--maxmemory-policy allkeys-lru    # eviction policy (also in kv.conf for safety)
--protected-mode no               # allow non-loopback connections (K8s networking)
```

### Health Checks

**Readiness probe** (is the instance ready to accept commands?):

```yaml
exec:
  command: ["sh", "-c", "kv-cli -a \"$REDIS_PASSWORD\" ping | grep -q PONG"]
initialDelaySeconds: 5
periodSeconds: 10
failureThreshold: 3
```

**Liveness probe** (is the instance alive and not deadlocked?):

```yaml
exec:
  command: ["sh", "-c", "kv-cli -a \"$REDIS_PASSWORD\" ping | grep -q PONG"]
initialDelaySeconds: 15
periodSeconds: 30
failureThreshold: 5
```

The liveness probe has a longer `initialDelaySeconds` and `failureThreshold` to avoid
killing a pod that is replaying a large AOF on startup.

### Resource Allocation

```yaml
resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 2Gi
```

The memory limit (2Gi) acts as a hard ceiling. Combined with `allkeys-lru`, Valkey will
evict the least-recently-used keys when approaching this limit rather than crashing with
an OOM error.

### Storage

```yaml
volumeClaimTemplates:
  - metadata:
      name: redis-data
    spec:
      accessModes: [ReadWriteOnce]
      resources:
        requests:
          storage: 2Gi
```

The PVC stores the AOF file. With our current workload, the AOF (after automatic
compaction) stays under 100MB. The 2Gi allocation provides 20x headroom.

## Implementation

### Container Image

The Dockerfile is minimal by design:

```dockerfile
ARG KV_VERSION=8.1

FROM valkey/valkey:${KV_VERSION}-alpine AS base
FROM base

LABEL maintainer="dev@hanzo.ai"
LABEL org.opencontainers.image.source="https://github.com/hanzoai/kv"
LABEL org.opencontainers.image.description="Hanzo KV - High-performance key-value store"
LABEL org.opencontainers.image.vendor="Hanzo AI"

# Install Hanzo KV CLI tools
# Primary names are kv-* ; legacy valkey-* names remain as symlinks
RUN cp /usr/local/bin/valkey-server    /usr/local/bin/kv-server    \
 && cp /usr/local/bin/valkey-cli       /usr/local/bin/kv-cli       \
 && ln -sf /usr/local/bin/kv-cli       /usr/local/bin/kv           \
 && cp /usr/local/bin/valkey-sentinel  /usr/local/bin/kv-sentinel  2>/dev/null; \
    cp /usr/local/bin/valkey-benchmark /usr/local/bin/kv-benchmark 2>/dev/null; \
    cp /usr/local/bin/valkey-check-aof /usr/local/bin/kv-check-aof 2>/dev/null; \
    cp /usr/local/bin/valkey-check-rdb /usr/local/bin/kv-check-rdb 2>/dev/null; \
    true

EXPOSE 6379

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD kv ping | grep -q PONG || exit 1

ENTRYPOINT ["kv-server"]
CMD ["--bind", "0.0.0.0", "--dir", "/data", \
     "--maxmemory-policy", "allkeys-lru", "--protected-mode", "no"]
```

Key points:

- **Base image**: `valkey/valkey:8.1-alpine` (~12MB compressed)
- **CLI renaming**: All Valkey binaries are copied to `kv-*` names. The original
  `valkey-*` names remain as the originals. This gives operators a clean Hanzo-branded
  CLI while maintaining compatibility with scripts that reference `valkey-cli`.
- **No custom compilation**: We use the upstream Valkey binary as-is. Custom patches
  would create a maintenance burden and diverge from upstream security fixes.

### CLI Tools

| Command | Description |
|---------|-------------|
| `kv` | Interactive CLI (symlink to kv-cli) |
| `kv-server` | Start KV server |
| `kv-cli` | Command-line client |
| `kv-sentinel` | High-availability sentinel |
| `kv-benchmark` | Performance benchmarking tool |
| `kv-check-aof` | AOF file integrity checker |
| `kv-check-rdb` | RDB file integrity checker |

### CI/CD Pipeline

The deploy workflow (`.github/workflows/deploy.yml`) has two stages:

**Stage 1: Build**

1. Checkout source from `github.com/hanzoai/kv`
2. Authenticate to Hanzo KMS (Universal Auth) to fetch CI secrets
3. Build multi-arch image (`linux/amd64`, `linux/arm64`) via Docker Buildx
4. Push to GHCR (`ghcr.io/hanzoai/kv`) with tags: `latest`, git SHA, semver
5. Push to Docker Hub (`docker.io/hanzoai/kv`) as fallback (continue-on-error)

**Stage 2: Deploy (main branch only)**

1. Authenticate to Hanzo KMS for DigitalOcean API token
2. Configure `kubectl` for `hanzo-k8s` cluster via `doctl`
3. Rolling update: `kubectl -n hanzo set image statefulset/redis-master kv=ghcr.io/hanzoai/kv:latest`
4. Wait for rollout: `kubectl -n hanzo rollout status statefulset/redis-master --timeout=120s`

Trigger conditions: push to `main`, tag push (`v*`), or manual `workflow_dispatch`.

### K8s Manifest Structure

All manifests live in `universe/infra/k8s/kv/` and are aggregated via Kustomize:

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - statefulset.yaml
  - service.yaml
  - secret.yaml
  - configmap.yaml
```

### Migration from Bitnami Redis

The migration from the Bitnami Redis Helm chart to Hanzo KV was performed as follows:

1. **Scale down Bitnami**: `helm uninstall redis` removes the Deployment and Service but
   preserves the PVC (Helm default `resourcePolicy: keep`).
2. **Apply Hanzo KV manifests**: The StatefulSet uses the same PVC name (`redis-data`),
   same Service name (`redis-master`), and same secret name (`redis`). This means the new
   pod attaches to the existing PVC with all data intact.
3. **Verify data**: `kv-cli -a "$REDIS_PASSWORD" DBSIZE` confirms key count matches
   pre-migration.
4. **Remove Helm artifacts**: Clean up orphaned Helm release secrets.

The migration is zero-downtime because the Service name and selector labels are
preserved. Client connections fail for the ~30 seconds between the old pod terminating
and the new pod passing its readiness probe, which is within the retry tolerance of all
Hanzo services.

### Client SDKs

| Language | Package | Install |
|----------|---------|---------|
| Python | [hanzo-kv](https://pypi.org/project/hanzo-kv) | `pip install hanzo-kv` |
| Go | [hanzo/kv-go](https://github.com/hanzoai/kv-go) | `go get github.com/hanzoai/kv-go` |
| Node.js | [@hanzo/kv](https://github.com/hanzoai/kv-client) | `npm install @hanzo/kv` |

All three are thin wrappers around standard Redis client libraries (`redis-py`,
`go-redis`, `ioredis`) with Hanzo-specific defaults (connection URL construction,
KMS secret resolution, structured logging). Any vanilla Redis client works equally well.

## Security

### Authentication

All connections require a password. The password is stored in a K8s Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: redis
  namespace: hanzo
type: Opaque
stringData:
  redis-password: "<generated-value>"
```

Services receive the password via environment variable injection from this secret.
The secret name (`redis`) and key (`redis-password`) match the Bitnami convention to
avoid changing every service deployment manifest.

In production, this secret is synced from Hanzo KMS (`kms.hanzo.ai`) via the KMS
Operator. The plaintext value in the manifest is a bootstrap default that gets
overwritten on first KMS sync.

### Network Isolation

- **Service type**: ClusterIP (no external exposure)
- **No NodePort, no LoadBalancer, no Ingress**
- Only pods within the `hanzo` namespace (or with appropriate NetworkPolicy) can reach
  port 6379
- The `--protected-mode no` flag is safe because the pod is never exposed outside the
  cluster. Protected mode is a Redis safety net for instances accidentally exposed to
  the internet without a password; our instance has both network isolation and a password.

### Dangerous Command Disablement

As specified in the Configuration section, `FLUSHDB` and `FLUSHALL` are renamed to empty
strings (disabled). Additional commands to consider disabling in future:

- `DEBUG` -- can crash the server or dump memory
- `CONFIG` -- can change runtime settings (e.g., disable authentication)
- `SHUTDOWN` -- can stop the server

These are not currently disabled because they are useful for debugging in a cluster
environment where only operators have `kubectl exec` access.

### TLS

TLS is available in Valkey 8.1 but not enabled for intra-cluster communication. The
reasoning:

- All traffic stays within the DOKS VPC, encrypted at the network layer by DigitalOcean
- TLS adds ~15% latency overhead on every command due to encryption/decryption
- The threat model (attacker with VPC access) implies they already have `kubectl` access
  and can read secrets directly

If we add external replication (e.g., cross-cluster) or expose KV outside the VPC, TLS
will be enabled via `--tls-port 6380 --tls-cert-file --tls-key-file --tls-ca-cert-file`.

### Memory Limits

The 2Gi memory limit prevents a runaway client from consuming all node memory and
triggering the Linux OOM killer (which would kill the KV process and potentially other
pods on the same node). With `allkeys-lru`, Valkey gracefully evicts cold keys instead
of refusing writes or crashing.

## Consumers

Services in the Hanzo ecosystem that connect to KV:

| Service | Use Case | Key Pattern |
|---------|----------|-------------|
| IAM (hanzo.id) | Session tokens, OAuth state | `iam:session:*`, `iam:oauth:*` |
| LLM Gateway | Rate limiting, response cache | `llm:rate:*`, `llm:cache:*` |
| Cloud | Job queues, inference state | `cloud:job:*`, `cloud:inf:*` |
| Console | Session cache | `console:session:*` |
| Chat | Conversation state, pub/sub | `chat:conv:*`, `chat:stream:*` |
| Bot | Command state, cooldowns | `bot:state:*`, `bot:cd:*` |
| Analytics | Event buffering | `analytics:buf:*` |
| Zen | Model routing cache | `zen:route:*` |
| Commerce | Cart state, rate limits | `commerce:cart:*` |

### Key Namespace Convention

All keys SHOULD be prefixed with `<service>:<category>:<id>`. This enables:

- Per-service monitoring via `kv-cli --stat` or `SCAN` with pattern matching
- Targeted eviction of one service's keys without affecting others
- Clear ownership when debugging unexpected key growth

## Monitoring

### Built-in Metrics

Valkey's `INFO` command provides comprehensive metrics without any sidecar:

```bash
# Memory usage
kv-cli -a "$REDIS_PASSWORD" INFO memory

# Client connections
kv-cli -a "$REDIS_PASSWORD" INFO clients

# Keyspace statistics
kv-cli -a "$REDIS_PASSWORD" INFO keyspace

# Persistence status
kv-cli -a "$REDIS_PASSWORD" INFO persistence

# All metrics
kv-cli -a "$REDIS_PASSWORD" INFO all
```

### Key Metrics to Watch

| Metric | Warning Threshold | Critical Threshold |
|--------|------------------|--------------------|
| `used_memory` | > 1.5Gi (75% of limit) | > 1.8Gi (90%) |
| `connected_clients` | > 100 | > 500 |
| `evicted_keys` | > 0 (indicates memory pressure) | > 1000/min |
| `rejected_connections` | > 0 | > 10/min |
| `aof_last_bgrewrite_status` | `err` | - |
| `instantaneous_ops_per_sec` | > 50,000 | > 100,000 |

### Future: Prometheus Integration

When continuous monitoring is needed, deploy `oliver006/redis_exporter` as a standalone
Deployment in the `hanzo` namespace:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kv-exporter
  namespace: hanzo
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: exporter
          image: oliver006/redis_exporter:latest
          env:
            - name: REDIS_ADDR
              value: redis-master:6379
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: redis
                  key: redis-password
          ports:
            - containerPort: 9121
```

This runs as a separate pod, not a sidecar. If the exporter crashes, KV is unaffected.

## Backward Compatibility

This standard is designed for zero-disruption adoption:

- **Service name**: `redis-master` (unchanged from Bitnami)
- **Secret name**: `redis` with key `redis-password` (unchanged from Bitnami)
- **Port**: 6379 (unchanged)
- **Protocol**: RESP3, backward-compatible with RESP2 clients
- **Labels**: `app.kubernetes.io/name: redis` (unchanged, for existing selectors)
- **PVC name**: `redis-data` (unchanged, preserves existing data)

Services do not need any code changes. The connection URL, password, and port are
identical. The only observable difference is that `INFO server` reports `valkey_version`
instead of `redis_version`, which may affect monitoring scripts that parse this field.

## Future Work

1. **Valkey Cluster mode**: When dataset exceeds 32GB or ops/sec exceeds 500K, evaluate
   Valkey Cluster with 3 masters and 3 replicas. This will require a new HIP.
2. **Read replicas**: For read-heavy workloads (LLM cache, analytics), add one or more
   read replicas behind a separate Service (`redis-reader.hanzo.svc`).
3. **TLS**: Enable when cross-cluster replication or external access is required.
4. **Prometheus exporter**: Deploy as standalone pod when continuous dashboarding is
   needed.
5. **KMS secret rotation**: Automate password rotation via KMS Operator with zero-downtime
   client re-authentication.
6. **Sentinel**: For automatic failover without full cluster mode, evaluate Valkey
   Sentinel with a primary and two replicas.

## Reference Implementation

**Repository**: [github.com/hanzoai/kv](https://github.com/hanzoai/kv)

**Key Files**:

- `Dockerfile` -- Multi-arch container image based on Valkey 8.1 Alpine
- `.github/workflows/deploy.yml` -- CI/CD: build, push to GHCR/Docker Hub, deploy to K8s
- `.github/workflows/ci.yml` -- Upstream Valkey test suite
- `valkey.conf` -- Full reference configuration (upstream defaults)
- `sentinel.conf` -- Sentinel configuration for HA deployments

**K8s Manifests** (`universe/infra/k8s/kv/`):

- `statefulset.yaml` -- StatefulSet `redis-master` with PVC and health checks
- `service.yaml` -- ClusterIP Service on port 6379
- `configmap.yaml` -- `kv.conf` (AOF, eviction policy, disabled commands)
- `secret.yaml` -- Redis-compatible password secret
- `kustomization.yaml` -- Kustomize aggregation

**Status**: Implemented and running in production on `hanzo-k8s` (`24.199.76.156`)

## References

1. [HIP-0: Hanzo AI Architecture Framework](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
3. [Valkey Project](https://valkey.io/) -- Linux Foundation fork of Redis
4. [Redis License Change Announcement](https://redis.io/blog/redis-adopts-dual-source-available-licensing/) -- March 2024
5. [Valkey 8.1 Release Notes](https://valkey.io/blog/valkey-8-1-0-rc1/)
6. [RESP3 Protocol Specification](https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
