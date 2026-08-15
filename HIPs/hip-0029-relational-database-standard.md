---
hip: 0029
title: Relational Database Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2025-01-15
requires: HIP-0, HIP-14
---


# HIP-0029: Relational Database Standard

## Abstract

This proposal defines the relational database standard for all Hanzo services.
Hanzo SQL provides relational data storage via SQL, deployed as in-cluster
StatefulSets on each Kubernetes Kubernetes cluster. Every Hanzo service that requires
persistent relational storage MUST connect to the cluster-local SQL instance
following this specification.

**Repository**: [github.com/hanzoai/postgres](https://github.com/hanzoai/postgres)
**Image**: `ghcr.io/hanzoai/sql:latest`

dev      # Development
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

The Hanzo SQL image is built from the official SQL 16 image with
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
                    pg_dump -h localhost -U hanzo \
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
pg_restore -h localhost -U hanzo \
  -d iam --clean --if-exists --no-owner \
  ./iam.dump
```

### Monitoring

SQL metrics are exposed via `postgres_exporter` sidecar to Prometheus:

| Metric | Alert Threshold | Description |
|--------|----------------|-------------|
| `pg_stat_activity_count` | > 150 | Active connection count |
| `pg_database_size_bytes` | > 40GB | Database size |
| `pg_stat_bgwriter_buffers_backend` | Increasing | Shared buffer pressure |
| `pg_replication_lag_seconds` | > 60s | Replication lag (when enabled) |
| `pg_up` | 0 | SQL is down |

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
host    all       all        127.0.0.1/8     md5
host    all       all        0.0.0.0/0      reject
```

- Local socket connections (within the pod): trusted
- Pod network (127.0.0.1/8): password authentication
- Everything else: rejected

### Credential Management

All database passwords are managed by Hanzo KMS (kms.hanzo.ai):

1. KMS stores `DATABASE_URL` for each service
2. `KMSSecret` CRDs sync secrets into Kubernetes
3. Pods mount secrets as environment variables
4. Password rotation: update in KMS, restart affected pods

```yaml
# KMSSecret resource for IAM database credentials
apiVersion: secrets.lux.network/v1alpha1
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
  at the CNI level on Kubernetes). If cross-cluster replication is ever added,
  TLS MUST be enabled on the replication connection.
- **At rest**: DigitalOcean block storage volumes are encrypted at the
  infrastructure level. PVC data inherits this encryption.

## Compatibility

### IAM Dual-Engine Support

Hanzo IAM supports both MySQL and SQL. For local
development convenience, MySQL is available:

```bash
# Local dev with MySQL
docker compose -f compose.mysql.yml up -d
cp conf/app.mysql.conf conf/app.conf

# Staging/Production MUST use SQL
cp conf/app.dev.conf conf/app.conf  # SQL config
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
      value: localhost
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

### Phase 3: Logical Replication for Cross-Cluster Sync

If the cluster and lux-k8s need shared data (e.g., unified user directory):

```
the cluster postgres → Logical Replication → lux-k8s postgres
    (publisher)                              (subscriber)
```

## References

1. [HIP-0: Architecture](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-14: Application Deployment Standard](./hip-0014-application-deployment-standard.md)
3. [PostgreSQL 16 Documentation](https://www.postgresql.org/docs/16/)
4. [pgvector](https://github.com/pgvector/pgvector)
5. [Infisical KMS](https://infisical.com/docs)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
