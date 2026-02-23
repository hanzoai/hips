---
hip: 0058
title: Unified Database Abstraction Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0026, HIP-0028, HIP-0029, HIP-0042, HIP-0047
---

# HIP-58: Unified Database Abstraction Standard

## Abstract

This proposal defines Hanzo DB, a unified database abstraction layer that exposes
SQL, key-value, document, vector, and timeseries operations through a single API
endpoint. Hanzo DB does not replace the underlying engines -- PostgreSQL (HIP-0029),
Valkey (HIP-0028), DocumentDB (MongoDB-compatible), Qdrant (HIP-0042), and ClickHouse
(HIP-0047) -- it routes queries to them. Developers interact with one connection
string, one set of credentials, and one query language. The individual backends
remain accessible for workloads that need direct access.

**Repository**: [github.com/hanzoai/db](https://github.com/hanzoai/db)
**Ports**: 8058 (HTTP/gRPC API), 5432 (PostgreSQL wire protocol)
**Docker**: `ghcr.io/hanzoai/db:latest`
**License**: Apache-2.0

## Motivation

The Hanzo ecosystem now operates five distinct database engines across two
Kubernetes clusters:

| Engine | HIP | Purpose | Protocol | Port |
|--------|-----|---------|----------|------|
| PostgreSQL | HIP-0029 | Relational data, ACID transactions | PostgreSQL wire | 5432 |
| Valkey | HIP-0028 | Caching, sessions, pub/sub | RESP3 | 6379 |
| DocumentDB | -- | Semi-structured documents | MongoDB wire | 27017 |
| Qdrant | HIP-0042 | Vector similarity search | gRPC/HTTP | 6333/6334 |
| ClickHouse | HIP-0047 | Analytics, timeseries | HTTP/native TCP | 8123/9000 |

Each engine has its own connection string, authentication mechanism, query language,
client library, and operational playbook. A developer building a new Hanzo service
that needs relational storage, caching, and vector search must configure three
separate connections, import three client libraries, handle three sets of errors,
and manage three credential rotations.

This creates four problems:

1. **Cognitive overhead.** New engineers must learn five query languages, five
   connection patterns, and five operational models before they can build a
   full-featured service. Most services only need simple operations on two or
   three engines, yet they carry the full complexity of each.

2. **Credential sprawl.** Each engine requires its own secret in KMS. A service
   touching three engines needs three secret references, three environment
   variables, and three rotation schedules. The blast radius of a leaked
   credential is engine-wide because there is no per-service, per-database
   scoping at the abstraction layer.

3. **No cross-engine queries.** A common pattern -- "find documents similar to
   this vector, then join with the user table to check permissions" -- requires
   two round-trips and application-level joining. The developer writes the
   vector search, receives IDs, queries PostgreSQL with those IDs, and merges
   the results in code. This is boilerplate that every service reimplements.

4. **Inconsistent multi-tenancy.** Each engine enforces tenancy differently:
   PostgreSQL uses row-level security, Qdrant uses payload filters, Valkey uses
   key prefixes, DocumentDB uses collection-per-tenant, and ClickHouse uses
   database-per-tenant. There is no unified tenancy model, which means every
   service implements its own isolation logic.

Hanzo DB solves these by placing a thin routing layer in front of all five engines.

## Design Philosophy

### Why a Unified Abstraction (Not Just Five SDKs)

The strongest objection to Hanzo DB is: "just give developers good SDKs for each
engine and let them compose." This is a reasonable position, and it is the current
state of affairs. Here is why it is insufficient.

The problem is not that individual SDKs are bad. The Hanzo SDKs for PostgreSQL,
Valkey, Qdrant, and ClickHouse are functional. The problem is that *composition*
is left entirely to the application developer. Every service reinvents:

- Connection management across multiple backends
- Credential resolution from KMS for each engine
- Tenant isolation enforcement for each engine
- Error normalization across different wire protocols
- Health checking against multiple endpoints
- Cross-engine query patterns (vector search + relational join)

A unified abstraction eliminates this per-service duplication. The routing layer
handles it once, correctly, and every service inherits the behavior.

**Analogy**: Unix provides `/dev/sda`, `/dev/nvme0n1`, and `/dev/sr0` for direct
block device access. It also provides the VFS layer so that applications can call
`open()`, `read()`, and `write()` without knowing whether the underlying storage
is SSD, spinning disk, or optical media. Both layers exist. Hanzo DB is the VFS.

### Why the Individual Backends Are Still Exposed

Hanzo DB is a convenience layer, not a mandatory gateway. Services that need
direct access to PostgreSQL, Valkey, Qdrant, or ClickHouse can still connect
directly. The reasons:

- **Performance-critical paths.** The routing layer adds ~1ms of latency per
  query. For hot-path operations (rate limiting in Valkey, high-throughput
  analytics inserts to ClickHouse), direct access eliminates this overhead.
- **Engine-specific features.** PostgreSQL advisory locks, Valkey Lua scripting,
  Qdrant recommendation API, ClickHouse materialized views -- these are
  engine-specific capabilities that a generic abstraction cannot expose without
  becoming a leaky abstraction.
- **Incremental adoption.** Existing services do not need to migrate. New services
  can start with Hanzo DB and drop down to direct access for specific operations
  when needed.

### Why SQL as the Lingua Franca

Hanzo DB uses SQL as its primary query language, extended with clauses for vector
similarity and timeseries operations. The alternatives considered:

- **GraphQL**: Expressive for nested data, but requires schema definition upfront
  and does not map naturally to vector search or timeseries aggregation.
- **Custom DSL**: Maximum flexibility, but imposes a learning curve and requires
  custom parser maintenance.
- **REST/gRPC only**: Works for CRUD, but cannot express complex joins, aggregations,
  or cross-engine queries without becoming a bespoke query language anyway.

SQL wins because:

1. Every developer already knows it.
2. It maps directly to PostgreSQL (passed through) and ClickHouse (passed through).
3. KV, document, and vector operations can be expressed as SQL extensions with
   minimal syntactic overhead.
4. Existing SQL tooling (DBeaver, pgAdmin, psql) works over the wire protocol.

## Specification

### Architecture

```
                          ┌──────────────────────────┐
                          │       Hanzo DB           │
                          │    (db.hanzo.svc)        │
                          │                          │
  Clients ───────────────►│  :8058 HTTP/gRPC API     │
  psql/pgAdmin ──────────►│  :5432 SQL wire protocol │
                          │                          │
                          │  ┌────────────────────┐  │
                          │  │   Query Router     │  │
                          │  │                    │  │
                          │  │  Parse → Classify  │  │
                          │  │  → Route → Execute │  │
                          │  │  → Normalize       │  │
                          │  └────────┬───────────┘  │
                          │           │              │
                          └───────────┼──────────────┘
                 ┌────────┬───────────┼───────┬────────────┐
                 │        │           │       │            │
                 ▼        ▼           ▼       ▼            ▼
           ┌─────────┐ ┌─────┐ ┌──────────┐ ┌──────┐ ┌──────────┐
           │PostgreSQL│ │Valkey│ │DocumentDB│ │Qdrant│ │ClickHouse│
           │  :5432   │ │:6379 │ │  :27017  │ │:6333 │ │  :8123   │
           │ HIP-0029 │ │HIP-28│ │          │ │HIP-42│ │ HIP-0047 │
           └─────────┘ └─────┘ └──────────┘ └──────┘ └──────────┘
```

### Query Router

The query router is the core of Hanzo DB. It performs four steps:

1. **Parse**: Tokenize the incoming query or API call.
2. **Classify**: Determine which backend(s) the query targets based on the table
   name prefix, query type, or explicit routing hint.
3. **Route**: Forward the query to the appropriate backend connection pool.
4. **Normalize**: Transform the backend response into a uniform result format.

#### Routing Rules

Queries are routed based on table namespace prefixes:

| Prefix | Backend | Example |
|--------|---------|---------|
| `sql.*` or no prefix | PostgreSQL | `SELECT * FROM sql.users` or `SELECT * FROM users` |
| `kv.*` | Valkey | `SELECT value FROM kv.sessions WHERE key = 'abc'` |
| `doc.*` | DocumentDB | `SELECT * FROM doc.events WHERE data->>'type' = 'click'` |
| `vec.*` | Qdrant | `SELECT * FROM vec.documents ORDER BY embedding <-> $1 LIMIT 10` |
| `ts.*` | ClickHouse | `SELECT count(*) FROM ts.api_calls WHERE timestamp > now() - INTERVAL 1 HOUR` |

When no prefix is given, the router defaults to PostgreSQL. This ensures backward
compatibility: any existing SQL query works unchanged.

#### Explicit Routing

For non-SQL operations or when the prefix convention is insufficient, the HTTP/gRPC
API supports explicit backend targeting:

```json
{
  "backend": "vector",
  "operation": "search",
  "collection": "documents",
  "vector": [0.042, -0.118, "..."],
  "filter": {"org_id": "hanzo"},
  "limit": 10
}
```

This bypasses the SQL parser and dispatches directly to the backend's native API.

### SQL Extensions

#### Vector Similarity

The `<->` operator (cosine distance) and `<=>` operator (inner product) are
supported in `ORDER BY` clauses on `vec.*` tables:

```sql
-- Find 10 most similar documents to a query vector
SELECT id, payload->>'text' AS text, embedding <-> $1 AS distance
FROM vec.documents
WHERE payload->>'org_id' = 'hanzo'
ORDER BY embedding <-> $1
LIMIT 10;
```

This is syntactically identical to pgvector queries. The router detects the `vec.`
prefix and translates the query into a Qdrant search request with payload filtering.

#### Timeseries Aggregation

Standard SQL aggregation functions work on `ts.*` tables. ClickHouse-specific
functions (toStartOfHour, toStartOfDay, quantile) are passed through:

```sql
-- Hourly API call counts for the last 24 hours
SELECT
    toStartOfHour(timestamp) AS hour,
    count(*) AS calls,
    quantile(0.95)(latency_ms) AS p95_latency
FROM ts.api_calls
WHERE org_id = 'hanzo'
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour;
```

#### Key-Value Operations

KV operations are expressed as SQL for consistency, mapped to Valkey commands:

```sql
-- GET: retrieve a value
SELECT value FROM kv.cache WHERE key = 'user:123:session';

-- SET: store a value with TTL
INSERT INTO kv.cache (key, value, ttl)
VALUES ('user:123:session', '{"token":"abc"}', 3600)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- DEL: remove a key
DELETE FROM kv.cache WHERE key = 'user:123:session';

-- SCAN: list keys by pattern
SELECT key FROM kv.cache WHERE key LIKE 'user:123:%';
```

The router translates these into `GET`, `SET`, `DEL`, and `SCAN` commands on
Valkey. The `ttl` column maps to the `EX` argument on `SET`.

#### Cross-Engine Queries

The most powerful feature of Hanzo DB is cross-engine joins. The router
materializes intermediate results and performs the join in-process:

```sql
-- Vector search joined with relational data
SELECT u.name, u.email, d.text, d.distance
FROM (
    SELECT id, payload->>'user_id' AS user_id, payload->>'text' AS text,
           embedding <-> $1 AS distance
    FROM vec.documents
    WHERE payload->>'org_id' = 'hanzo'
    ORDER BY embedding <-> $1
    LIMIT 20
) d
JOIN sql.users u ON u.id = d.user_id::uuid
WHERE u.active = true
ORDER BY d.distance
LIMIT 10;
```

The router executes this in two phases:
1. Send the vector search to Qdrant, receive 20 candidates.
2. Send the relational join to PostgreSQL with the candidate IDs.
3. Merge and return the final result set.

**Limitation**: Cross-engine joins are read-only. Transactions that span multiple
backends are not supported -- this would require distributed transactions (2PC),
which adds latency and complexity disproportionate to the benefit.

### Multi-Tenancy

Hanzo DB enforces per-organization isolation at the routing layer. Every
authenticated request carries an `org_id` derived from the IAM token (HIP-0026).
The router injects tenant isolation into every query:

| Backend | Isolation Mechanism |
|---------|-------------------|
| PostgreSQL | `SET app.current_org = $org_id;` + row-level security policies |
| Valkey | Key prefix injection: `{org_id}:{key}` |
| DocumentDB | Collection routing: `{org_id}_{collection}` |
| Qdrant | Mandatory payload filter: `{"must": [{"key": "org_id", "match": {"value": "$org_id"}}]}` |
| ClickHouse | Database routing: queries target `{org_id}` database |

The application developer never writes tenant isolation code. The router handles
it transparently based on the IAM token.

### Connection Pooling

Hanzo DB maintains persistent connection pools to each backend:

```yaml
pools:
  postgresql:
    min_connections: 10
    max_connections: 100
    idle_timeout: 300s
    max_lifetime: 1800s
  valkey:
    pool_size: 50
    min_idle: 10
  documentdb:
    min_pool_size: 5
    max_pool_size: 50
  qdrant:
    max_connections: 20
  clickhouse:
    max_open_connections: 20
    max_idle_connections: 10
```

Connection pools are shared across all client connections to Hanzo DB. This
eliminates the N-services-times-M-backends connection multiplication problem.
Instead of each of 20 services maintaining 10 connections to PostgreSQL (200
total), all 20 services connect to Hanzo DB, which maintains a single pool
of 100 connections to PostgreSQL.

### Authentication and Authorization

Hanzo DB delegates all authentication to IAM (HIP-0026).

**HTTP/gRPC API**: Requests include a Bearer token obtained from IAM. Hanzo DB
validates the token against the IAM userinfo endpoint, extracts the `org_id`
and `role`, and applies authorization rules:

```
Authorization: Bearer <iam-token>
```

**SQL wire protocol**: The PostgreSQL wire protocol authentication handshake
accepts an IAM token as the password field. The username maps to the IAM
application name:

```bash
psql "postgresql://app-cloud:<iam-token>@db.hanzo.svc:5432/hanzo"
```

#### Role-Based Access Control

IAM roles map to database permissions:

| IAM Role | SQL | KV | Document | Vector | Timeseries |
|----------|-----|----|----------|--------|-----------|
| `admin` | Full DDL + DML | All commands | All operations | All operations | Full DDL + DML |
| `developer` | DML only | GET/SET/DEL | CRUD | Search/Upsert | DML only |
| `readonly` | SELECT only | GET only | Read only | Search only | SELECT only |
| `service` | Per-service ACL | Per-service keys | Per-service collections | Per-service collections | Per-service tables |

The `service` role is the default for machine-to-machine access. Each service's
IAM application is granted access to specific tables, key patterns, collections,
and databases.

### Schema Management

Hanzo DB provides a migrations API for schema changes across backends:

```
POST /v1/migrations/apply
```

```json
{
  "migrations": [
    {
      "backend": "sql",
      "version": "003",
      "description": "Add user preferences table",
      "up": "CREATE TABLE IF NOT EXISTS preferences (user_id UUID REFERENCES users(id), key TEXT, value JSONB, PRIMARY KEY (user_id, key));"
    },
    {
      "backend": "vector",
      "version": "003",
      "description": "Create preferences embedding collection",
      "up": {
        "create_collection": {
          "name": "user-preferences",
          "vectors": {"size": 1536, "distance": "Cosine"}
        }
      }
    },
    {
      "backend": "timeseries",
      "version": "003",
      "description": "Create preference change log",
      "up": "CREATE TABLE IF NOT EXISTS preference_changes (timestamp DateTime64(3), user_id UUID, key String, old_value String, new_value String) ENGINE = MergeTree() ORDER BY (timestamp, user_id);"
    }
  ]
}
```

Migrations are tracked in a `_migrations` table in PostgreSQL (the source of truth
for schema state). Each migration records: version, backend, description, applied_at,
and checksum.

### AI-Powered Index Suggestions

Hanzo DB collects query telemetry (query patterns, execution times, scan counts)
and periodically analyzes it to suggest index improvements:

```
GET /v1/suggestions
```

```json
{
  "suggestions": [
    {
      "backend": "sql",
      "table": "users",
      "type": "btree_index",
      "column": "email",
      "reason": "Sequential scan on users.email detected in 847 queries over 24h. Average scan: 125K rows. A B-tree index would reduce this to an index lookup.",
      "estimated_improvement": "~98% query time reduction for email lookups",
      "ddl": "CREATE INDEX CONCURRENTLY idx_users_email ON users (email);"
    },
    {
      "backend": "vector",
      "collection": "documents",
      "type": "payload_index",
      "field": "category",
      "reason": "Payload filter on 'category' appears in 92% of search queries but is not indexed. Qdrant scans all payloads for this filter.",
      "ddl": "PUT /collections/documents/index {\"field_name\": \"category\", \"field_schema\": \"keyword\"}"
    },
    {
      "backend": "timeseries",
      "table": "api_calls",
      "type": "materialized_view",
      "reason": "Hourly aggregation query runs 340 times/day. A materialized view would precompute the result.",
      "ddl": "CREATE MATERIALIZED VIEW api_calls_hourly ..."
    }
  ]
}
```

The suggestion engine runs as a background goroutine. It analyzes the query log
(stored in ClickHouse) using heuristic rules, not an LLM. The rules are:

1. Sequential scans on columns that appear in WHERE clauses more than 100 times/day
2. Payload filters on vector collections that are not indexed
3. Repeated aggregation queries that could be materialized
4. KV key patterns that would benefit from different data structures (hash vs string)

Suggestions are advisory. They are surfaced through the API and the Hanzo Console
(HIP-0038) dashboard. Application of suggestions requires explicit approval.

## Implementation

### Technology

Hanzo DB is implemented in Go. The reasons:

- **Single binary**: No runtime dependencies, simple container image.
- **PostgreSQL wire protocol**: Go has mature libraries for implementing the
  PostgreSQL wire protocol (`jackc/pgproto3`), enabling psql and pgAdmin
  connectivity.
- **Connection pooling**: Go's goroutine model is ideal for managing hundreds
  of concurrent client connections multiplexed onto backend connection pools.
- **Ecosystem alignment**: The majority of Hanzo infrastructure (IAM, Gateway,
  Node) is Go. Shared tooling, CI patterns, and operational knowledge apply.

### Container Image

```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o hanzo-db ./cmd/db

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/hanzo-db /usr/local/bin/hanzo-db
EXPOSE 8058 5432
ENTRYPOINT ["hanzo-db"]
```

**Image**: `ghcr.io/hanzoai/db:latest`
**Base**: `alpine:3.21` (~5MB)
**Architectures**: `linux/amd64`, `linux/arm64`

### Kubernetes Deployment

Hanzo DB runs as a Deployment (not a StatefulSet) because it is stateless. All
state lives in the backends it routes to.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-db
  template:
    metadata:
      labels:
        app: hanzo-db
    spec:
      containers:
        - name: db
          image: ghcr.io/hanzoai/db:latest
          ports:
            - name: api
              containerPort: 8058
            - name: sql
              containerPort: 5432
          env:
            - name: POSTGRESQL_URL
              valueFrom:
                secretKeyRef:
                  name: db-backends
                  key: postgresql-url
            - name: VALKEY_URL
              valueFrom:
                secretKeyRef:
                  name: db-backends
                  key: valkey-url
            - name: DOCUMENTDB_URL
              valueFrom:
                secretKeyRef:
                  name: db-backends
                  key: documentdb-url
            - name: QDRANT_URL
              valueFrom:
                secretKeyRef:
                  name: db-backends
                  key: qdrant-url
            - name: CLICKHOUSE_URL
              valueFrom:
                secretKeyRef:
                  name: db-backends
                  key: clickhouse-url
            - name: IAM_ENDPOINT
              value: "https://hanzo.id"
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 2000m
              memory: 1Gi
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8058
            initialDelaySeconds: 5
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8058
            initialDelaySeconds: 3
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: db
  namespace: hanzo
spec:
  selector:
    app: hanzo-db
  ports:
    - name: api
      port: 8058
      targetPort: 8058
    - name: sql
      port: 5432
      targetPort: 5432
```

### Health Checks

**`/healthz`** (liveness): Returns 200 if the process is running and not deadlocked.

**`/readyz`** (readiness): Returns 200 only if all backend connection pools have at
least one healthy connection. If any backend is unreachable, readiness fails and
Kubernetes stops routing traffic to that pod. This prevents clients from receiving
errors for backends that are temporarily down.

### Client SDKs

| Language | Package | Install |
|----------|---------|---------|
| Python | [hanzo-db](https://pypi.org/project/hanzo-db) | `pip install hanzo-db` |
| Go | [hanzo/db-go](https://github.com/hanzoai/db-go) | `go get github.com/hanzoai/db-go` |
| Node.js | [@hanzo/db](https://github.com/hanzoai/db-client) | `npm install @hanzo/db` |

The SDKs provide typed interfaces for each backend mode plus a unified `query()`
method that accepts SQL strings.

```python
from hanzo_db import DB

db = DB(
    endpoint="http://db.hanzo.svc:8058",
    token=os.environ["IAM_TOKEN"],
)

# SQL query (routed to PostgreSQL)
users = db.query("SELECT * FROM users WHERE active = true")

# Vector search (routed to Qdrant)
similar = db.query("""
    SELECT id, payload->>'text', embedding <-> %s AS distance
    FROM vec.documents
    ORDER BY embedding <-> %s
    LIMIT 10
""", [query_vector, query_vector])

# KV operation (routed to Valkey)
db.query("INSERT INTO kv.cache (key, value, ttl) VALUES (%s, %s, 3600)",
         ["session:abc", '{"user":"z"}'])

# Cross-engine join
results = db.query("""
    SELECT u.name, d.text, d.distance
    FROM (
        SELECT id, payload->>'user_id' AS uid, payload->>'text' AS text,
               embedding <-> %s AS distance
        FROM vec.documents ORDER BY distance LIMIT 20
    ) d
    JOIN sql.users u ON u.id = d.uid::uuid
    WHERE u.active = true
    LIMIT 5
""", [query_vector])
```

## Security Considerations

### Authentication Chain

```
Client → [IAM token] → Hanzo DB → [validates against IAM] → Backend
```

Hanzo DB never stores credentials for end users. It validates IAM tokens on
every request and uses its own service credentials to connect to backends.
Backend credentials are stored in KMS (HIP-0027) and injected via K8s secrets.

### Tenant Isolation

The routing layer enforces tenant isolation at the query level. Even if a
developer omits a `WHERE org_id = ?` clause, the router injects it. This is
defense-in-depth on top of application-level filtering.

For PostgreSQL, this uses row-level security policies. For other backends, the
router rewrites the query to include the tenant filter before dispatching.

### SQL Injection Prevention

All SQL extensions (KV, vector, document, timeseries) are implemented as
parameterized query rewrites, not string concatenation. The router uses prepared
statements for all backend queries. User-supplied values are never interpolated
into query strings.

### Network Isolation

Hanzo DB is exposed only within the Kubernetes cluster (ClusterIP service). No
external ingress. The SQL wire protocol on port 5432 is accessible only from
within the `hanzo` namespace via NetworkPolicy.

### Audit Logging

Every query is logged with: timestamp, org_id, user_id, backend, query hash,
latency, and result row count. Logs are shipped to ClickHouse (HIP-0047) for
analysis. Full query text is logged only for DDL operations; DML query text is
hashed to avoid logging sensitive data.

## References

1. [HIP-0: Hanzo AI Architecture Framework](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-26: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md)
3. [HIP-28: Key-Value Store Standard](./hip-0028-key-value-store-standard.md)
4. [HIP-29: Relational Database Standard](./hip-0029-relational-database-standard.md)
5. [HIP-42: Vector Search Standard](./hip-0042-vector-search-standard.md)
6. [HIP-47: Analytics Datastore Standard](./hip-0047-analytics-datastore-standard.md)
7. [PostgreSQL Wire Protocol](https://www.postgresql.org/docs/16/protocol.html)
8. [jackc/pgproto3](https://github.com/jackc/pgproto3) -- Go PostgreSQL wire protocol library
9. [CockroachDB SQL Layer](https://www.cockroachlabs.com/docs/stable/architecture/sql-layer.html) -- Prior art for SQL routing

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
