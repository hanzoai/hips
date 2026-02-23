---
hip: 0029
title: Relational Database Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
requires: HIP-0, HIP-14
---

# HIP-29: Relational Database Standard

## Abstract

This proposal defines the relational database standard for all Hanzo services.
Hanzo SQL provides relational data storage via PostgreSQL, deployed as in-cluster
StatefulSets on each DOKS Kubernetes cluster. Every Hanzo service that requires
persistent relational storage MUST connect to the cluster-local PostgreSQL instance
following this specification.

**Repository**: [github.com/hanzoai/postgres](https://github.com/hanzoai/postgres)
**Image**: `ghcr.io/hanzoai/sql:latest`

## Motivation

Hanzo operates a growing number of services (IAM, Cloud, Console, KMS, Platform,
Commerce, Gateway) across two Kubernetes clusters. Without a single database
standard, teams independently chose different engines, connection patterns, and
backup strategies. This led to:

- Operational inconsistency across services
- Duplicated infrastructure cost (managed DB instances at $15-65/mo each)
- No shared strategy for vector search, which multiple AI services need
- Ad-hoc credential management with no audit trail

We need ONE standard way to:

- Provision and connect to relational databases
- Manage schema migrations
- Handle backups and disaster recovery
- Integrate vector similarity search for AI workloads
- Rotate credentials through KMS

## Design Philosophy

This section explains the reasoning behind each major architectural decision.
Understanding the *why* is as important as understanding the *what*.

### Why PostgreSQL over MySQL

Both engines are mature and battle-tested. We chose PostgreSQL for four reasons:

1. **pgvector for AI embeddings.** Cloud, LLM Gateway, and Agent SDK all perform
   vector similarity search for semantic caching and RAG pipelines. pgvector
   provides native vector indexing (IVFFlat, HNSW) inside PostgreSQL itself.
   This eliminates the need for a separate vector database (Pinecone, Weaviate,
   Qdrant) and the associated operational cost of running another stateful service.

2. **JSONB for flexible schema.** Many Hanzo services store semi-structured data
   (user metadata, OAuth token payloads, agent tool configurations). PostgreSQL's
   JSONB type supports indexing, partial updates, and containment queries natively.
   MySQL's JSON support exists but lacks GIN indexing and efficient partial-path
   updates.

3. **Better concurrency model (MVCC).** PostgreSQL's multi-version concurrency
   control allows readers to never block writers. MySQL's InnoDB has similar MVCC
   semantics, but PostgreSQL's implementation handles long-running analytical
   queries alongside OLTP workloads more gracefully, which matters when services
   run both real-time API queries and batch analytics.

4. **Richer extension ecosystem.** Beyond pgvector, we use pg_trgm (trigram-based
   fuzzy text search for user lookups), uuid-ossp (native UUID generation), and
   pg_stat_statements (query performance monitoring). PostgreSQL's extension model
   lets us add capabilities without changing the core engine.

**Note on IAM**: Hanzo IAM (Casdoor fork) supports both MySQL and PostgreSQL.
Local development may use MySQL for convenience (`compose.mysql.yml`), but all
staging and production deployments MUST use PostgreSQL. The `conf/app.conf`
`driverName` field MUST be set to `postgres` in non-local environments.

### Why In-Cluster over Managed (DO Managed DB, RDS)

Managed PostgreSQL on DigitalOcean costs $15/mo for a basic 1GB instance and
$65/mo for a production-grade 4GB instance. We run 6+ databases across two
clusters. At managed pricing, that is $90-390/mo just for database compute,
before considering connection pooling add-ons or read replicas.

In-cluster PostgreSQL running as a StatefulSet costs nothing beyond the node
resources already allocated. The trade-offs:

| Concern | Managed DB | In-Cluster |
|---------|-----------|------------|
| Cost | $15-65/mo per DB | $0 incremental (uses existing node CPU/RAM) |
| Backups | Automated daily | We manage (pg_dump cron + S3) |
| HA/Failover | Built-in | Manual (streaming replication when needed) |
| Extension control | Limited (provider must whitelist) | Full (we control postgresql.conf) |
| Network latency | Cross-VPC (~1-5ms) | Pod-to-pod (~0.1ms) |
| pg_hba.conf | Provider-managed | Full control |

The critical advantage beyond cost is **extension control**. Managed providers
often restrict or delay support for extensions like pgvector. Running in-cluster
means we install any extension immediately.

The primary trade-off is **backup responsibility**. We accept this trade-off
because Kubernetes PVC snapshots plus scheduled pg_dump to S3-compatible storage
(MinIO or DO Spaces) provides equivalent durability with full control over
retention policy.

### Why Single Instance over Patroni/Citus

At current scale (Feb 2026), a single PostgreSQL instance on each cluster
handles all service load comfortably. Observed peak connections across all
services: ~120 concurrent on hanzo-k8s, ~80 on lux-k8s. A single PostgreSQL
instance supports 100-200 concurrent connections without issue (default
`max_connections = 200`).

Patroni adds:

- etcd or Consul dependency for leader election
- Streaming replication configuration and monitoring
- Automated failover logic that can split-brain if misconfigured
- 2-3x operational complexity

This is premature. When any of the following triggers occur, we will introduce
streaming replication:

1. Sustained connection count exceeds 150 on a single cluster
2. Any single query workload requires a dedicated read replica
3. Recovery Point Objective (RPO) drops below 1 hour
4. A service requires multi-region reads

Until then, the single-instance architecture stays. Simplicity is a feature.

### Why pgvector over Dedicated Vector Databases

Multiple Hanzo services require vector similarity search:

| Service | Use Case | Vector Dimensions |
|---------|----------|-------------------|
| Cloud | Semantic caching of LLM responses | 1536 (text-embedding-3-small) |
| LLM Gateway | Request deduplication and cache lookup | 1536 |
| Agent SDK | RAG retrieval for agent memory | 1536-3072 |
| Search | Document embedding search | 1536 |
| IAM | User profile similarity (future) | 768 |

A dedicated vector database (Pinecone, Weaviate, Qdrant) would mean:

- Another stateful service to deploy, monitor, and back up
- Data synchronization between PostgreSQL (source of truth) and vector DB
- Additional network hops for queries that join relational and vector data
- Separate credential management

pgvector keeps everything in one database. A typical AI-augmented query:

```sql
-- Find similar cached responses for a user within their organization
SELECT c.response, c.embedding <=> $1::vector AS distance
FROM llm_cache c
JOIN users u ON c.user_id = u.id
WHERE u.org_id = $2
  AND c.model = $3
  AND c.embedding <=> $1::vector < 0.3
ORDER BY distance
LIMIT 5;
```

This query joins relational data (user, org) with vector search in a single
round-trip. With a separate vector DB, this requires two queries and
application-level joining.

**Performance**: pgvector with HNSW indexing handles up to ~5M vectors per table
with sub-10ms query latency. Our largest table (llm_cache) is projected to reach
~1M vectors by end of 2026. When we exceed 10M vectors in a single table, we
will evaluate dedicated vector infrastructure. Until then, pgvector is sufficient.

## Specification

### Cluster Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                    hanzo-k8s (24.199.76.156)                        │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  PostgreSQL StatefulSet (postgres.hanzo.svc:5432)        │       │
│  │                                                          │       │
│  │  Databases:                                              │       │
│  │    iam           - Hanzo IAM (Casdoor)                   │       │
│  │    cloud         - Hanzo Cloud                           │       │
│  │    console       - Hanzo Console                         │       │
│  │    hanzo_cloud   - Hanzo Cloud (legacy schema)           │       │
│  │    kms           - KMS (Infisical)                       │       │
│  │    platform      - PaaS Platform (Dokploy)              │       │
│  │                                                          │       │
│  │  Extensions: pgvector, pg_trgm, uuid-ossp,              │       │
│  │              pg_stat_statements                          │       │
│  └──────────────────────────────────────────────────────────┘       │
│         ↑              ↑              ↑             ↑                │
│    ┌────┴───┐    ┌────┴───┐    ┌────┴───┐    ┌───┴────┐           │
│    │  IAM   │    │ Cloud  │    │Console │    │  KMS   │           │
│    │        │    │        │    │        │    │        │           │
│    └────────┘    └────────┘    └────────┘    └────────┘           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    lux-k8s (24.144.69.101)                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  PostgreSQL StatefulSet (postgres.hanzo.svc:5432)        │       │
│  │                                                          │       │
│  │  Databases:                                              │       │
│  │    cloud         - Lux Cloud                             │       │
│  │    commerce      - Commerce / Billing                    │       │
│  │    console       - Lux Console                           │       │
│  │    gateway       - KrakenD API Gateway                   │       │
│  │    hanzo         - Core Hanzo services                   │       │
│  │    kms           - KMS (Infisical)                       │       │
│  │                                                          │       │
│  │  Extensions: pgvector, pg_trgm, uuid-ossp               │       │
│  └──────────────────────────────────────────────────────────┘       │
│         ↑              ↑              ↑             ↑                │
│    ┌────┴───┐    ┌────┴───┐    ┌────┴───┐    ┌───┴────┐           │
│    │Commerce│    │Gateway │    │ Cloud  │    │  KMS   │           │
│    │        │    │        │    │        │    │        │           │
│    └────────┘    └────────┘    └────────┘    └────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### Connection Standard

All services MUST connect using the following pattern:

```
postgresql://<user>:<password>@postgres.hanzo.svc:5432/<dbname>?sslmode=disable
```

**Environment variable**: `DATABASE_URL`

The `sslmode=disable` is acceptable because traffic is pod-to-pod within the
same Kubernetes namespace, encrypted at the CNI level. External connections
are not permitted (see Security section).

For services that use separate DSN components:

```bash
DB_HOST=postgres.hanzo.svc
DB_PORT=5432
DB_USER=<service-specific-user>
DB_PASSWORD=<from-kms>
DB_NAME=<database-name>
DB_SSLMODE=disable
```

### Service-Specific Connection Patterns

Different services use different ORMs and connection methods. All MUST resolve
credentials from KMS secrets:

| Service | ORM / Driver | Connection Config |
|---------|-------------|-------------------|
| IAM | Beego ORM (xorm) | `conf/app.conf` `dataSourceName` field |
| Cloud | Prisma | `DATABASE_URL` env var |
| Console | Prisma | `DATABASE_URL` env var |
| KMS | Internal (Infisical) | `DB_CONNECTION_URI` env var |
| Platform | Prisma | `DATABASE_URL` env var |
| Commerce | raw `database/sql` | `DATABASE_URL` env var |
| Gateway | KrakenD config | `dsn` in gateway config JSON |

### Required Extensions

Every Hanzo SQL instance MUST have these extensions installed:

```sql
-- Vector similarity search for AI workloads
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigram-based fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Native UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Query performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### PostgreSQL Configuration

Key configuration values (deviations from defaults):

```ini
# postgresql.conf

# Connection limits
max_connections = 200
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 4MB
maintenance_work_mem = 128MB

# WAL configuration
wal_level = replica
max_wal_senders = 3
wal_keep_size = 1GB

# pgvector tuning
# HNSW index build parallelism
max_parallel_maintenance_workers = 2
max_parallel_workers_per_gather = 2

# Logging
log_min_duration_statement = 1000
log_statement = 'ddl'
log_connections = on
log_disconnections = on

# Checkpoints
checkpoint_completion_target = 0.9
checkpoint_timeout = 10min
```

`wal_level = replica` is set proactively so that enabling streaming replication
in the future does not require a PostgreSQL restart.

### Schema Migration Standard

Services MUST manage schema migrations using one of these approved methods:

1. **Prisma Migrate** (recommended for TypeScript services)
   ```bash
   npx prisma migrate dev      # Development
   npx prisma migrate deploy   # Production
   ```

2. **Beego ORM auto-sync** (IAM only, legacy)
   - Controlled by `autoMigrate` in `conf/app.conf`
   - MUST be `false` in production after initial setup

3. **Raw SQL migrations** (Go services, shell scripts)
   - Stored in `migrations/` directory
   - Numbered sequentially: `001_initial.sql`, `002_add_vectors.sql`
   - Applied via `psql` or a lightweight migration tool

All migrations MUST be:

- **Idempotent**: Safe to run multiple times (`IF NOT EXISTS`, `IF NOT EXISTS`)
- **Forward-only**: No down migrations in production
- **Reviewed**: Schema changes require PR review from infrastructure team
- **Tested**: Run against a test database before production

### Database Naming Convention

```
<service>        -- e.g., iam, cloud, console, kms, platform, commerce
<service>_<env>  -- only if running multiple environments in one cluster
```

Database names MUST be lowercase, use underscores (not hyphens), and match the
service name exactly. The exception is `hanzo_cloud` which is a legacy name
retained for backward compatibility.

### User and Role Standard

Each database MUST have a dedicated user:

```sql
-- Per-database user (created by KMS bootstrap)
CREATE USER iam_user WITH PASSWORD '<from-kms>';
GRANT ALL PRIVILEGES ON DATABASE iam TO iam_user;

CREATE USER cloud_user WITH PASSWORD '<from-kms>';
GRANT ALL PRIVILEGES ON DATABASE cloud TO cloud_user;
```

A superuser `hanzo` exists for administrative operations (backups, extension
installation, new database creation). Service applications MUST NOT use the
superuser account.

## Implementation

### Container Image

The Hanzo SQL image is built from the official PostgreSQL 16 image with
extensions pre-installed:

```dockerfile
FROM postgres:16-bookworm

# Install pgvector
RUN apt-get update && \
    apt-get install -y postgresql-16-pgvector && \
    rm -rf /var/lib/apt/lists/*

# Install additional extensions
RUN apt-get update && \
    apt-get install -y postgresql-16-pg-trgm && \
    rm -rf /var/lib/apt/lists/*

# Custom entrypoint for extension initialization
COPY init-extensions.sh /docker-entrypoint-initdb.d/

# Custom postgresql.conf
COPY postgresql.conf /etc/postgresql/postgresql.conf

CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
```

**Image**: `ghcr.io/hanzoai/sql:latest`
**Base**: `postgres:16-bookworm`
**Architectures**: `linux/amd64`, `linux/arm64`

### Kubernetes StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: hanzo
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: ghcr.io/hanzoai/sql:latest
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: password
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2000m"
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "hanzo"]
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "hanzo"]
            initialDelaySeconds: 5
            periodSeconds: 5
  volumeClaimTemplates:
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: do-block-storage
        resources:
          requests:
            storage: 50Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: hanzo
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
  clusterIP: None  # Headless for StatefulSet
```

### Backup Strategy

Backups run via a Kubernetes CronJob:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: hanzo
spec:
  schedule: "0 */6 * * *"  # Every 6 hours
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: ghcr.io/hanzoai/sql:latest
              command:
                - /bin/sh
                - -c
                - |
                  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
                  BACKUP_DIR=/backups/${TIMESTAMP}
                  mkdir -p ${BACKUP_DIR}

                  # Dump each database separately
                  for db in iam cloud console hanzo_cloud kms platform; do
                    pg_dump -h postgres.hanzo.svc -U hanzo \
                      -Fc --no-owner --no-acl \
                      ${db} > ${BACKUP_DIR}/${db}.dump
                  done

                  # Upload to S3-compatible storage
                  aws s3 sync ${BACKUP_DIR} \
                    s3://hanzo-backups/postgres/${TIMESTAMP}/ \
                    --endpoint-url ${S3_ENDPOINT}

                  # Clean up local
                  rm -rf ${BACKUP_DIR}

                  # Prune backups older than 30 days
                  aws s3 ls s3://hanzo-backups/postgres/ \
                    --endpoint-url ${S3_ENDPOINT} | \
                    awk '{print $2}' | \
                    while read dir; do
                      dir_date=$(echo $dir | tr -d '/')
                      if [ $(date -d "$dir_date" +%s 2>/dev/null || echo 0) -lt \
                           $(date -d '30 days ago' +%s) ]; then
                        aws s3 rm --recursive \
                          s3://hanzo-backups/postgres/${dir} \
                          --endpoint-url ${S3_ENDPOINT}
                      fi
                    done
              envFrom:
                - secretRef:
                    name: postgres-credentials
                - secretRef:
                    name: s3-backup-credentials
          restartPolicy: OnFailure
```

**Backup schedule**: Every 6 hours
**Retention**: 30 days
**Storage**: S3-compatible (MinIO in-cluster or DO Spaces)
**Format**: pg_dump custom format (`-Fc`) for selective restore

### Restore Procedure

```bash
# Download backup
aws s3 cp s3://hanzo-backups/postgres/20260215_060000/iam.dump ./iam.dump \
  --endpoint-url ${S3_ENDPOINT}

# Restore to database
pg_restore -h postgres.hanzo.svc -U hanzo \
  -d iam --clean --if-exists --no-owner \
  ./iam.dump
```

### Monitoring

PostgreSQL metrics are exposed via `postgres_exporter` sidecar to Prometheus:

| Metric | Alert Threshold | Description |
|--------|----------------|-------------|
| `pg_stat_activity_count` | > 150 | Active connection count |
| `pg_database_size_bytes` | > 40GB | Database size |
| `pg_stat_bgwriter_buffers_backend` | Increasing | Shared buffer pressure |
| `pg_replication_lag_seconds` | > 60s | Replication lag (when enabled) |
| `pg_up` | 0 | PostgreSQL is down |

## Security

### Network Isolation

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-network-policy
  namespace: hanzo
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: hanzo
      ports:
        - protocol: TCP
          port: 5432
```

Only pods in the `hanzo` namespace can connect. All other traffic is denied.

### pg_hba.conf

```
# TYPE  DATABASE  USER       ADDRESS        METHOD
local   all       all                       trust
host    all       all        10.0.0.0/8     md5
host    all       all        0.0.0.0/0      reject
```

- Local socket connections (within the pod): trusted
- Pod network (10.0.0.0/8): password authentication
- Everything else: rejected

### Credential Management

All database passwords are managed by KMS (Infisical at kms.hanzo.ai):

1. KMS stores `DATABASE_URL` for each service
2. `KMSSecret` CRDs sync secrets into Kubernetes
3. Pods mount secrets as environment variables
4. Password rotation: update in KMS, restart affected pods

```yaml
# KMSSecret resource for IAM database credentials
apiVersion: secrets.infisical.com/v1alpha1
kind: KMSSecret
metadata:
  name: iam-database
  namespace: hanzo
spec:
  hostAPI: https://kms.hanzo.ai/api
  authentication:
    universalAuth:
      secretsScope:
        envSlug: prod
        secretsPath: /iam
      credentialsRef:
        secretName: kms-universal-auth
        secretNamespace: hanzo
  managedSecretReference:
    secretName: iam-database-url
    secretNamespace: hanzo
    secretType: Opaque
```

### Encryption

- **In transit**: Not required within cluster (pod-to-pod traffic is encrypted
  at the CNI level on DOKS). If cross-cluster replication is ever added,
  TLS MUST be enabled on the replication connection.
- **At rest**: DigitalOcean block storage volumes are encrypted at the
  infrastructure level. PVC data inherits this encryption.

## Compatibility

### IAM Dual-Engine Support

Hanzo IAM (Casdoor fork) supports both MySQL and PostgreSQL. For local
development convenience, MySQL is available:

```bash
# Local dev with MySQL
docker compose -f compose.mysql.yml up -d
cp conf/app.mysql.conf conf/app.conf

# Staging/Production MUST use PostgreSQL
cp conf/app.dev.conf conf/app.conf  # PostgreSQL config
```

The `driverName` in `conf/app.conf` determines the engine:

```ini
driverName = postgres   # Production (REQUIRED)
driverName = mysql      # Local development only
```

### Connection Pooling

For services with high connection churn (API gateways, serverless functions),
connection pooling via PgBouncer MAY be deployed as a sidecar:

```yaml
# PgBouncer sidecar (optional, per-service)
- name: pgbouncer
  image: bitnami/pgbouncer:latest
  env:
    - name: POSTGRESQL_HOST
      value: postgres.hanzo.svc
    - name: PGBOUNCER_POOL_MODE
      value: transaction
    - name: PGBOUNCER_MAX_CLIENT_CONN
      value: "200"
    - name: PGBOUNCER_DEFAULT_POOL_SIZE
      value: "20"
```

This is optional. Most services maintain persistent connections and do not
require pooling.

## Future Work

### Phase 2: Streaming Replication

When triggered (see "Why Single Instance" above):

```
Primary (postgres-0) → Streaming Replication → Replica (postgres-1)
                                                      ↑
                                              Read-only queries
```

### Phase 3: Logical Replication for Cross-Cluster Sync

If hanzo-k8s and lux-k8s need shared data (e.g., unified user directory):

```
hanzo-k8s postgres → Logical Replication → lux-k8s postgres
    (publisher)                              (subscriber)
```

### Phase 4: Citus for Horizontal Scaling

If any single database exceeds the capacity of a single PostgreSQL instance
(projected: 2027+), Citus provides transparent sharding.

## References

1. [HIP-0: Architecture](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-14: Application Deployment Standard](./hip-0014-application-deployment-standard.md)
3. [PostgreSQL 16 Documentation](https://www.postgresql.org/docs/16/)
4. [pgvector](https://github.com/pgvector/pgvector)
5. [Infisical KMS](https://infisical.com/docs)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
