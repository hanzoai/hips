---
hip: 0032
title: Object Storage Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2025-01-15
---

# HIP-32: Object Storage Standard

## Abstract

This proposal defines the object storage standard for the Hanzo platform. All services
that store or retrieve binary objects -- model weights, datasets, user uploads, backups,
container images -- MUST use Hanzo Storage, an S3-compatible object storage layer built
on MinIO.

**Repositories**:
- [github.com/hanzoai/storage](https://github.com/hanzoai/storage) -- Storage server and configuration
- [github.com/hanzoai/storage-console](https://github.com/hanzoai/storage-console) -- Web management UI

**Ports**:
- `9000` -- S3-compatible API
- `9001` -- Storage Console (web UI)

Every Hanzo service that persists blobs MUST go through the S3 API on port 9000. No
service may write directly to local disk for persistent data. This is the single source
of truth for all unstructured data in the Hanzo ecosystem.

## Motivation

AI infrastructure is defined by large, immutable blobs. A single model checkpoint can be
70 GB. A training dataset can be terabytes. Container images for GPU runtimes routinely
exceed 10 GB. These objects share common access patterns:

1. **Write once, read many** -- A model is trained, checkpointed, then served thousands of
   times. Datasets are ingested, then read by every training run.
2. **Streaming reads** -- Inference workers pull weights in chunks, not all at once. Range
   requests and multipart downloads are essential.
3. **Versioning** -- Models go through dozens of versions. Rolling back to a known-good
   checkpoint must be trivial.
4. **Access control** -- A user's uploaded data is private. A published model is public.
   Policies must be per-bucket and per-prefix.

We need ONE standard way to:

- Store and retrieve binary objects of any size
- Control access with fine-grained policies
- Replicate data for durability and availability
- Integrate with every ML framework without custom clients

## Design Philosophy

### Why S3 API Compatibility Matters

The S3 API is the lingua franca of object storage. This is not an opinion -- it is an
empirical observation about the state of the software ecosystem:

- **PyTorch**: `torch.hub`, `torch.save` with S3 backends via `smart_open` or `fsspec`
- **HuggingFace**: `huggingface_hub` supports S3 endpoints natively
- **LangChain**: Document loaders accept S3 URIs
- **DVC** (Data Version Control): S3 is the default remote backend
- **Kubernetes**: Container image registries can use S3 for blob storage
- **Terraform/Pulumi**: State files stored on S3
- **PostgreSQL**: WAL archiving to S3 via `wal-g` or `pgBackRest`
- **aws-cli**: The most widely-installed CLI tool for object storage
- **boto3**: The most widely-used Python library for object storage
- **mc** (MinIO Client): Drop-in alternative to aws-cli

By exposing an S3-compatible API, every tool in the AI/ML ecosystem works with Hanzo
Storage out of the box. No custom SDKs. No vendor lock-in. No integration burden.

The alternative -- inventing a proprietary API -- would mean writing and maintaining
client libraries for every language, patching every framework, and training every
developer on a new interface. The engineering cost is prohibitive and the benefit is zero.

### Why Self-Hosted MinIO over AWS S3

The economics of AI storage make managed cloud storage untenable at scale:

| Scenario | AWS S3 Cost | MinIO on PVC Cost |
|----------|-------------|-------------------|
| Store 10 TB of model weights | $230/mo | ~$100/mo (block storage) |
| Egress 10 TB/mo (model serving) | **$900/mo** | **$0** |
| Egress 100 TB/mo (heavy inference) | **$9,000/mo** | **$0** |
| Store 1 PB training data | $23,000/mo | ~$5,000/mo (block storage) |

The critical line is **egress**. AWS charges $0.09/GB for data transfer out. When a model
serving cluster pulls a 70 GB checkpoint from S3 every time a new pod scales up, the
egress costs dominate. With MinIO running inside the same Kubernetes cluster, data transfer
between storage and compute is free -- it never leaves the network.

Additional benefits of self-hosting:

- **Data locality**: Storage lives in the same cluster as compute. Latency is measured in
  microseconds, not milliseconds.
- **No vendor lock-in**: MinIO is open source (AGPL-3.0). The data format is standard.
  Migration to any other S3-compatible system is trivial.
- **Full control**: We set the retention policies, encryption keys, and access controls.
  No third-party has access to customer data.
- **Compliance**: For customers with data residency requirements, we can guarantee exactly
  where their data is stored, down to the rack.

### Why MinIO over Alternatives

We evaluated three self-hosted object storage systems:

**Ceph (RADOS Gateway)**
- Extremely powerful and flexible (block, file, and object storage in one system)
- Requires minimum 3 nodes for basic operation (MON + OSD + MDS)
- Complex operations: placement groups, CRUSH maps, recovery handling
- Overkill for our current scale; appropriate if we need petabyte-scale unified storage
- Verdict: Too complex for the operational benefit at our current scale

**SeaweedFS**
- Lightweight, fast, good performance characteristics
- Less mature S3 compatibility (some edge cases in multipart upload, lifecycle rules)
- Smaller community, fewer production references at scale
- Verdict: Promising but insufficiently battle-tested for production AI workloads

**MinIO**
- Single binary deployment, trivial to operate
- Best-in-class S3 compatibility (passes the full AWS S3 test suite)
- Horizontal scaling via server pools when we outgrow a single node
- Erasure coding built in (data durability without RAID)
- Active development, large community, extensive documentation
- Used in production by companies running ML workloads at scale
- Verdict: Right tool for our current and near-future needs

The guiding principle is simple: **choose the simplest system that meets the requirements,
and be prepared to migrate when requirements change**. MinIO meets that bar today.

### Storage Console

The MinIO built-in console serves as a general-purpose management UI. Hanzo Storage
Console (`storage-console`) wraps and extends it with:

- Hanzo-branded interface consistent with the rest of the platform
- Integration with Hanzo IAM (HIP-0) for authentication
- Usage dashboards tied to billing (via Commerce)
- Bucket templates for common AI workloads (model registry, dataset catalog)
- Direct links from Cloud UI into storage management

The console is a separate service because it follows a different release cadence than the
storage server, and because it can be disabled in environments where only programmatic
access is needed.

## Specification

### S3 API Compatibility

Hanzo Storage MUST implement the following S3 API operations:

#### Bucket Operations

| Operation | Description | Required |
|-----------|-------------|----------|
| `CreateBucket` | Create a new bucket | YES |
| `DeleteBucket` | Delete an empty bucket | YES |
| `ListBuckets` | List all buckets for the authenticated user | YES |
| `HeadBucket` | Check if a bucket exists | YES |
| `GetBucketLocation` | Return the region of a bucket | YES |
| `GetBucketVersioning` | Get versioning state | YES |
| `PutBucketVersioning` | Enable/suspend versioning | YES |
| `GetBucketPolicy` | Get bucket access policy | YES |
| `PutBucketPolicy` | Set bucket access policy | YES |
| `GetBucketLifecycle` | Get lifecycle configuration | YES |
| `PutBucketLifecycle` | Set lifecycle rules | YES |
| `GetBucketNotification` | Get event notification config | YES |
| `PutBucketNotification` | Set event notification config | YES |

#### Object Operations

| Operation | Description | Required |
|-----------|-------------|----------|
| `PutObject` | Upload an object | YES |
| `GetObject` | Download an object | YES |
| `HeadObject` | Get object metadata | YES |
| `DeleteObject` | Delete an object | YES |
| `DeleteObjects` | Batch delete | YES |
| `ListObjectsV2` | List objects in a bucket | YES |
| `CopyObject` | Copy an object | YES |
| `CreateMultipartUpload` | Start multipart upload | YES |
| `UploadPart` | Upload a part | YES |
| `CompleteMultipartUpload` | Finish multipart upload | YES |
| `AbortMultipartUpload` | Cancel multipart upload | YES |
| `GetObjectTagging` | Get object tags | YES |
| `PutObjectTagging` | Set object tags | YES |
| `SelectObjectContent` | Query object with SQL (CSV/JSON/Parquet) | OPTIONAL |

#### Presigned URLs

| Operation | Description | Required |
|-----------|-------------|----------|
| `PresignedGetObject` | Generate time-limited download URL | YES |
| `PresignedPutObject` | Generate time-limited upload URL | YES |
| `PresignedPostPolicy` | Generate browser upload form | YES |

Presigned URLs are critical for the Hanzo platform. Users upload files through the web
UI, and the browser MUST NOT have direct access to storage credentials. The flow is:

```
Browser  -->  Hanzo API  -->  Generate presigned URL  -->  Browser uploads directly to Storage
```

This keeps storage credentials server-side while allowing direct browser-to-storage
transfers, avoiding the bottleneck of proxying large files through the API server.

### Bucket Structure

All Hanzo deployments MUST use the following bucket layout:

```
hanzo-models/
  |- zen/
  |    |- zen-1b-v1/
  |    |    |- config.json
  |    |    |- model.safetensors
  |    |    |- tokenizer.json
  |    |- zen-8b-v1/
  |    |- zen-72b-v1/
  |- fine-tuned/
  |    |- {org-id}/{model-id}/
  |- checkpoints/
       |- {job-id}/{step}/

hanzo-datasets/
  |- public/
  |    |- {dataset-name}/{version}/
  |- private/
       |- {org-id}/{dataset-name}/{version}/

hanzo-uploads/
  |- {org-id}/{user-id}/{upload-id}

hanzo-backups/
  |- postgres/
  |    |- {date}/
  |- redis/
  |    |- {date}/
  |- iam/
       |- {date}/

hanzo-registry/
  |- docker/
       |- blobs/
       |- manifests/
```

#### Bucket Naming Convention

- All Hanzo-managed buckets MUST be prefixed with `hanzo-`
- Customer-created buckets (via Cloud) MUST be prefixed with `{org-id}-`
- Bucket names MUST be lowercase, alphanumeric, and hyphens only
- Bucket names MUST be between 3 and 63 characters

#### Object Key Convention

- Keys MUST use `/` as a delimiter (S3 standard)
- Keys MUST NOT begin with `/`
- Keys SHOULD be human-readable and hierarchical
- Metadata SHOULD be stored as object tags, not encoded in the key

### Access Control

#### IAM Integration

Storage access keys MUST be managed through Hanzo KMS (HIP-0). No static access keys
may be hardcoded in configuration or source code.

```yaml
# Example: KMS secret sync for storage credentials
apiVersion: secrets.hanzo.ai/v1
kind: KMSSecret
metadata:
  name: storage-credentials
spec:
  secretsManager:
    endpoint: https://kms.hanzo.ai
    path: /storage/root-credentials
  target:
    name: storage-root-secret
    keys:
      - secretKey: MINIO_ROOT_USER
        remoteKey: access-key
      - secretKey: MINIO_ROOT_PASSWORD
        remoteKey: secret-key
```

#### Bucket Policies

Bucket policies follow the AWS IAM policy language. Example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {"AWS": ["arn:aws:iam:::user/cloud-service"]},
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::hanzo-models/zen/*"]
    },
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::hanzo-datasets/public/*"]
    },
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["s3:*"],
      "Resource": ["arn:aws:s3:::hanzo-backups/*"],
      "Condition": {
        "StringNotEquals": {
          "aws:PrincipalArn": "arn:aws:iam:::user/backup-operator"
        }
      }
    }
  ]
}
```

#### Per-Service Access Keys

Each Hanzo service gets its own access key pair with least-privilege policies:

| Service | Access Level | Buckets |
|---------|-------------|---------|
| LLM Gateway | Read-only | `hanzo-models/*` |
| Cloud API | Read-write | `hanzo-models/fine-tuned/*`, `hanzo-datasets/*` |
| Platform | Read-write | `hanzo-uploads/*` |
| Backup Operator | Write-only | `hanzo-backups/*` |
| Registry | Read-write | `hanzo-registry/*` |
| Storage Console | Admin | All (via root credentials) |

### Lifecycle Rules

Buckets MUST have lifecycle rules to prevent unbounded storage growth:

```json
{
  "Rules": [
    {
      "ID": "expire-old-checkpoints",
      "Filter": {"Prefix": "checkpoints/"},
      "Status": "Enabled",
      "Expiration": {"Days": 30}
    },
    {
      "ID": "expire-incomplete-uploads",
      "Filter": {},
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    },
    {
      "ID": "transition-old-datasets",
      "Filter": {"Prefix": "private/"},
      "Status": "Enabled",
      "Transition": {"Days": 90, "StorageClass": "GLACIER"}
    }
  ]
}
```

The `AbortIncompleteMultipartUpload` rule is mandatory for all buckets. Abandoned
multipart uploads are invisible storage leaks -- they consume space but are not visible
in `ListObjects`. Without this rule, storage costs grow silently.

### Event Notifications

Storage MUST emit events for object lifecycle changes. Events are published to a
Kafka/Redis topic for consumption by other services:

```json
{
  "Event": "s3:ObjectCreated:Put",
  "Bucket": "hanzo-models",
  "Key": "zen/zen-8b-v2/model.safetensors",
  "Size": 16106127360,
  "ContentType": "application/octet-stream",
  "UserMetadata": {
    "x-amz-meta-model-format": "safetensors",
    "x-amz-meta-model-family": "zen",
    "x-amz-meta-model-version": "v2"
  },
  "Timestamp": "2025-01-15T10:30:00Z"
}
```

Event types that MUST be supported:

| Event | Trigger |
|-------|---------|
| `s3:ObjectCreated:*` | Any object creation (Put, Post, Copy, MultipartUpload) |
| `s3:ObjectRemoved:*` | Any object deletion |
| `s3:ObjectAccessed:*` | Any object read (Get, Head) |
| `s3:BucketCreated` | Bucket creation |
| `s3:BucketRemoved` | Bucket deletion |

Event consumers include:

- **Model Registry**: Detects new model uploads, triggers validation and indexing
- **Billing**: Tracks storage usage per org for metering
- **Audit**: Logs all access to sensitive buckets
- **CDN Invalidation**: Purges cache when public objects change

### Erasure Coding

MinIO MUST be configured with erasure coding for data durability. The minimum
configuration for production is:

```
EC:4 (4 data shards + 4 parity shards on 8 drives)
```

This means the system can lose up to 4 drives and still reconstruct all data. The
storage overhead is 2x (compared to 3x for simple replication), while providing stronger
durability guarantees.

For single-node development environments, standalone mode (no erasure coding) is
acceptable.

### Encryption

#### In Transit

All S3 API traffic MUST use TLS 1.2 or higher. Plaintext HTTP is only permitted for
localhost development.

#### At Rest (Server-Side Encryption)

Production deployments MUST enable SSE-S3 (server-side encryption with MinIO-managed
keys):

```bash
# Enable auto-encryption for a bucket
mc encrypt set sse-s3 storage/hanzo-uploads
mc encrypt set sse-s3 storage/hanzo-backups
mc encrypt set sse-s3 storage/hanzo-models
```

For buckets containing customer data (`hanzo-uploads`, org-prefixed buckets), encryption
at rest is mandatory. The encryption key MUST be stored in KMS, not on the storage server.

## Implementation

### Production Architecture

```
                          +-----------------+
                          |   Hanzo Cloud   |
                          |   (port 8000)   |
                          +-------+---------+
                                  |
                    presigned URLs | S3 API calls
                                  |
              +-------------------v-------------------+
              |         MinIO (port 9000)             |
              |    hanzo-k8s / storage namespace      |
              |                                       |
              |  +----------+  +----------+           |
              |  | PVC 1    |  | PVC 2    |  ...      |
              |  | (500 GB) |  | (500 GB) |           |
              |  +----------+  +----------+           |
              +-------------------+-------------------+
                                  |
                    event notifications
                                  |
              +-------------------v-------------------+
              |         Redis / Kafka                 |
              |    (event bus for consumers)           |
              +---------------------------------------+
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: storage
  namespace: hanzo
spec:
  serviceName: storage
  replicas: 1  # Scale to 4+ for erasure coding
  selector:
    matchLabels:
      app: storage
  template:
    metadata:
      labels:
        app: storage
    spec:
      containers:
        - name: minio
          image: minio/minio:latest
          args: ["server", "/data", "--console-address", ":9001"]
          ports:
            - containerPort: 9000
              name: s3
            - containerPort: 9001
              name: console
          env:
            - name: MINIO_ROOT_USER
              valueFrom:
                secretKeyRef:
                  name: storage-root-secret
                  key: MINIO_ROOT_USER
            - name: MINIO_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: storage-root-secret
                  key: MINIO_ROOT_PASSWORD
          volumeMounts:
            - name: data
              mountPath: /data
          livenessProbe:
            httpGet:
              path: /minio/health/live
              port: 9000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /minio/health/ready
              port: 9000
            initialDelaySeconds: 10
            periodSeconds: 15
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2"
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: do-block-storage
        resources:
          requests:
            storage: 500Gi
---
apiVersion: v1
kind: Service
metadata:
  name: storage
  namespace: hanzo
spec:
  ports:
    - port: 9000
      targetPort: s3
      name: s3
    - port: 9001
      targetPort: console
      name: console
  selector:
    app: storage
```

### Storage Console Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: storage-console
  namespace: hanzo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: storage-console
  template:
    metadata:
      labels:
        app: storage-console
    spec:
      containers:
        - name: console
          image: ghcr.io/hanzoai/storage-console:latest
          ports:
            - containerPort: 3000
          env:
            - name: STORAGE_ENDPOINT
              value: "http://storage.hanzo.svc:9000"
            - name: IAM_ENDPOINT
              value: "https://hanzo.id"
            - name: IAM_CLIENT_ID
              value: "hanzo-storage-console-client-id"
```

### Client Configuration

#### Python (boto3)

```python
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="https://storage.hanzo.ai",
    aws_access_key_id="YOUR_ACCESS_KEY",
    aws_secret_access_key="YOUR_SECRET_KEY",
    region_name="us-east-1",  # Required by boto3, value is ignored
)

# Upload a model
s3.upload_file("model.safetensors", "hanzo-models", "zen/zen-8b-v2/model.safetensors")

# Download a dataset
s3.download_file("hanzo-datasets", "public/imagenet/train.tar", "train.tar")

# Generate presigned URL (1 hour expiry)
url = s3.generate_presigned_url(
    "get_object",
    Params={"Bucket": "hanzo-models", "Key": "zen/zen-8b-v2/model.safetensors"},
    ExpiresIn=3600,
)
```

#### Go

```go
package main

import (
    "github.com/minio/minio-go/v7"
    "github.com/minio/minio-go/v7/pkg/credentials"
)

func main() {
    client, err := minio.New("storage.hanzo.ai", &minio.Options{
        Creds:  credentials.NewStaticV4("ACCESS_KEY", "SECRET_KEY", ""),
        Secure: true,
    })
    if err != nil {
        log.Fatal(err)
    }

    // Upload
    _, err = client.FPutObject(ctx, "hanzo-models", "zen/zen-8b-v2/config.json",
        "config.json", minio.PutObjectOptions{ContentType: "application/json"})

    // Download
    err = client.FGetObject(ctx, "hanzo-datasets", "public/imagenet/train.tar",
        "train.tar", minio.GetObjectOptions{})
}
```

#### CLI (mc)

```bash
# Configure alias
mc alias set hanzo https://storage.hanzo.ai ACCESS_KEY SECRET_KEY

# List buckets
mc ls hanzo/

# Upload model
mc cp model.safetensors hanzo/hanzo-models/zen/zen-8b-v2/

# Mirror a directory
mc mirror ./dataset/ hanzo/hanzo-datasets/public/my-dataset/v1/

# Watch for changes
mc watch hanzo/hanzo-models/

# Check storage usage
mc du hanzo/hanzo-models/
```

## Monitoring

### Health Checks

MinIO exposes health endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/minio/health/live` | Liveness -- is the process running |
| `/minio/health/ready` | Readiness -- can it serve requests |
| `/minio/health/cluster` | Cluster -- are all nodes healthy (distributed mode) |

### Metrics

MinIO exports Prometheus metrics at `/minio/v2/metrics/cluster`:

| Metric | Description |
|--------|-------------|
| `minio_bucket_usage_total_bytes` | Total bytes per bucket |
| `minio_bucket_objects_count` | Object count per bucket |
| `minio_s3_requests_total` | Request count by API and status |
| `minio_s3_time_ttfb_seconds` | Time to first byte (latency) |
| `minio_s3_traffic_received_bytes` | Ingress traffic |
| `minio_s3_traffic_sent_bytes` | Egress traffic |
| `minio_node_disk_used_bytes` | Disk usage per node |
| `minio_node_disk_free_bytes` | Free disk per node |

### Alerting Rules

```yaml
groups:
  - name: storage
    rules:
      - alert: StorageDiskUsageHigh
        expr: minio_node_disk_used_bytes / (minio_node_disk_used_bytes + minio_node_disk_free_bytes) > 0.85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Storage disk usage above 85%"

      - alert: StorageDiskUsageCritical
        expr: minio_node_disk_used_bytes / (minio_node_disk_used_bytes + minio_node_disk_free_bytes) > 0.95
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Storage disk usage above 95% -- expand PVC immediately"

      - alert: StorageHighLatency
        expr: histogram_quantile(0.99, minio_s3_time_ttfb_seconds_bucket) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Storage P99 latency above 1 second"

      - alert: StorageErrorRate
        expr: rate(minio_s3_requests_total{status=~"5.."}[5m]) / rate(minio_s3_requests_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Storage 5xx error rate above 1%"
```

## Security Considerations

1. **Root credentials**: The MinIO root user/password MUST be stored in KMS and rotated
   quarterly. No human should know the root password in production.

2. **Service accounts**: Each service gets dedicated credentials with least-privilege
   bucket policies. Credential rotation MUST be automated via KMS.

3. **Network policy**: Storage pods MUST only accept traffic from within the cluster.
   External access goes through the API gateway with authentication.

4. **Audit logging**: All access to `hanzo-backups` and `hanzo-uploads` buckets MUST
   be logged to an immutable audit trail.

5. **Encryption keys**: SSE-S3 encryption keys MUST be stored in KMS, not on the
   storage node filesystem.

6. **Presigned URL expiry**: Presigned URLs MUST NOT exceed 24 hours for downloads
   and 1 hour for uploads. The API server MUST validate the requesting user's
   permissions before generating a presigned URL.

## Migration Path

For services currently using local disk or cloud-provider object storage:

1. Deploy MinIO on the target cluster
2. Create bucket structure per this specification
3. Use `mc mirror` to copy existing data
4. Update service configuration to point to `storage.hanzo.svc:9000`
5. Verify reads/writes through the new endpoint
6. Decommission old storage after 30-day parallel-run period

## Future Work

- **Multi-site replication**: MinIO supports active-active replication between clusters.
  When Hanzo expands to multiple regions, storage can replicate across sites without
  application changes.
- **Tiered storage**: Transition infrequently-accessed objects to cheaper storage classes
  (NVMe -> HDD -> cloud archive) using MinIO's ILM (Information Lifecycle Management).
- **Object Lambda**: Transform objects on read (e.g., decompress, transcode) without
  storing multiple copies.
- **S3 Select**: Push filtering into the storage layer for Parquet/CSV datasets, reducing
  data transfer for analytical queries.

## References

1. [HIP-0: Architecture](./hip-0000-hanzo-ai-architecture-framework.md)
2. [HIP-14: Application Deployment Standard](./hip-0014-application-deployment-standard.md)
3. [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
4. [AWS S3 API Reference](https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html)
5. [MinIO Erasure Coding](https://min.io/docs/minio/linux/operations/concepts/erasure-coding.html)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
