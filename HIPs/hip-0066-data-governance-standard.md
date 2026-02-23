---
hip: 0066
title: Data Governance & Lineage Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-02-23
requires: HIP-0017, HIP-0029, HIP-0032, HIP-0057, HIP-0058
---

# HIP-66: Data Governance & Lineage Standard

## Abstract

This proposal defines a data governance framework for the Hanzo ecosystem. Hanzo
Governance provides end-to-end data lineage tracking, a searchable data catalog,
automated PII detection, data classification enforcement, GDPR/CCPA compliance
tooling, and data quality monitoring -- all through a single API and control plane.

Every dataset, model artifact, database table, and object store bucket in the Hanzo
infrastructure MUST be registered in the governance catalog. Every transformation --
from raw data ingestion through preprocessing, training, fine-tuning, and inference --
MUST emit lineage events that the governance service records. This creates an unbroken
chain from any model prediction back through the model version, the training run, the
training dataset, and the original data sources.

**Repository**: [github.com/hanzoai/governance](https://github.com/hanzoai/governance)
**Port**: 8066 (HTTP/gRPC API)
**Binary**: `hanzo-governance`
**Container**: `ghcr.io/hanzoai/governance:latest`
**License**: Apache-2.0

## Motivation

AI companies sit on top of data. The data is the product. When the data is ungoverned,
five concrete problems emerge.

### 1. Garbage In, Garbage Out at Scale

A language model is a compressed representation of its training data. If the training
data contains duplicated records, mislabeled examples, toxic content, or copyrighted
material, the model inherits those flaws. The standard response -- "just clean the
data" -- assumes someone knows what the data contains. At the scale Hanzo operates
(terabytes of training corpora, millions of user records across multiple services,
thousands of model artifacts), nobody has a complete picture of what data exists,
where it lives, or what state it is in.

Without a catalog, data cleaning is guesswork. Without lineage, you cannot trace a
model's problematic output back to the training example that caused it. Without
quality monitoring, data degradation is invisible until a model regresses in
production.

### 2. Regulatory Compliance Is Not Optional

The EU AI Act (effective August 2026) requires that providers of high-risk AI systems
document their training data: what data was used, where it came from, how it was
preprocessed, what biases were identified and mitigated. Article 10 is explicit --
training datasets must be subject to "appropriate data governance and management
practices." Failure to comply carries fines up to 35 million EUR or 7% of global
turnover.

GDPR requires the ability to delete a user's personal data upon request (Article 17,
Right to Erasure). If a user's data was used to fine-tune a model, and you cannot
identify which data came from that user, you cannot comply. CCPA adds the right to
know what personal information has been collected and the right to opt out of its sale.

These are not theoretical risks. They are legal obligations with enforcement dates.
Compliance requires infrastructure -- not policies written in documents, but systems
that track data provenance automatically.

### 3. Manual Governance Does Not Scale

A company with 50 datasets and 10 models can manage governance in spreadsheets. A
company with 5,000 datasets, 200 models, 50 fine-tuned variants, and data flowing
across a dozen services cannot. Manual data inventories go stale the day they are
created. Manual PII audits miss data stores that were provisioned after the audit.
Manual classification relies on developers self-reporting sensitivity levels, which
they forget to do.

Governance must be automated: continuous scanning, automatic classification, real-time
lineage capture, and policy enforcement at the infrastructure level. If a developer
can create a database table without registering it in the catalog, they will. The
system must make ungoverned data the exception, not the default.

### 4. Reproducibility Requires Provenance

When a model produces an unexpected result in production, the debugging process is:
What version of the model is serving? What training run produced it? What dataset was
used? What preprocessing was applied? What was the raw data before preprocessing?

Without lineage, each of these questions requires manual investigation -- checking
deployment manifests, searching experiment tracking logs, grepping Object Storage for
matching timestamps. With lineage, the answer is a single query: "Show me the full
provenance chain for model zen-72b-finance v3."

Reproducibility also matters for scientific claims. When Hanzo publishes evaluation
benchmarks for Zen models, the community expects to reproduce those results. That
requires knowing exactly what data was used, down to the version and preprocessing
steps. Lineage makes this verifiable.

### 5. Data Access Is Unaudited

The Analytics layer (HIP-0017) tracks user interactions with Hanzo products. It does
not track internal data access -- which engineer queried the production user database,
which training job read the PII-containing dataset, which service exported customer
records to Object Storage. Without data access auditing, a data breach investigation
starts with "we do not know who accessed what."

## Design Philosophy

### Why a Dedicated Governance Service (Not Embedded in Each Backend)

The simplest approach to governance would be: add lineage tracking to PostgreSQL
(HIP-0029), add PII scanning to Object Storage (HIP-0032), add data classification
to Hanzo DB (HIP-0058), and let each backend manage its own governance metadata.

This fails for three reasons.

**Cross-backend lineage is impossible.** A training dataset starts as rows in
PostgreSQL, gets exported to Parquet files in Object Storage, gets preprocessed by
the ML Pipeline (HIP-0057), and produces a model artifact stored back in Object
Storage. The lineage chain crosses three systems. No single backend can track the
full chain. A centralized governance service can.

**Policy enforcement is inconsistent.** If each backend enforces its own data
classification rules, the rules diverge. PostgreSQL might enforce "no PII in
unencrypted columns" while Object Storage does not check whether uploaded Parquet
files contain PII. A centralized policy engine applies the same rules everywhere.

**Auditing requires a single timeline.** Access audit events from five different
backends in five different formats with five different timestamps cannot be correlated
without a normalizing layer. The governance service provides that layer -- a single
audit log with a unified schema and monotonic ordering.

**Trade-off**: A dedicated service adds a dependency. Every data operation that
emits lineage or checks policy adds a network hop. We mitigate this with async
lineage collection (events are fire-and-forget to a message queue) and local policy
caching (classification rules are cached at each backend with a 60-second TTL).

### Why Lineage Matters More Than Cataloging

Data catalogs are fashionable. Every "modern data stack" vendor sells one. Catalogs
answer the question "what data do we have?" Lineage answers the harder question:
"where did this data come from and where did it go?"

For AI systems, lineage is more valuable than cataloging because:

1. **Debugging requires causality, not inventory.** When a model misbehaves, knowing
   that "we have a dataset called finance-corpus-v3" is useless. Knowing that
   "model zen-72b-finance v3 was trained on finance-corpus-v3, which was derived
   from finance-corpus-v2 by applying PII masking and deduplication, which was
   sourced from the transactions table in the commerce database" is actionable.

2. **Compliance requires chain-of-custody.** GDPR deletion requires knowing every
   place a user's data propagated to. If user data entered through the API, was
   stored in PostgreSQL, was exported to a training dataset, and was used to
   fine-tune a model, the deletion request must propagate through the entire chain.
   Lineage makes this traversal possible.

3. **Reproducibility requires exact provenance.** "We used finance data" is not
   reproducible. "We used dataset `ds-a1b2c3`, version 7, stored at
   `s3://hanzo-ml/datasets/finance-corpus/7/`, with SHA-256
   `e3b0c44298fc1c14...`" is reproducible.

The catalog is the index. Lineage is the graph. Both are necessary, but lineage is
the capability that existing Hanzo infrastructure lacks entirely.

### Why Automated PII Detection (Not Manual Classification)

The alternative to automated scanning is to require developers to tag data with PII
labels when they create tables or upload files. This does not work in practice because:

- Developers do not know whether data contains PII until they inspect it. A "notes"
  column in a user table might contain email addresses, phone numbers, or nothing
  sensitive -- it depends on what users typed.
- Schema changes introduce PII without anyone noticing. Adding a `shipping_address`
  column to an orders table is a routine migration. Nobody files a governance ticket.
- Third-party data sources send PII without warning. An API integration that
  previously sent anonymized data might start including names after a provider update.

Automated scanning eliminates this gap. The governance service scans every registered
data source on a configurable schedule, using pattern matching (regex for SSNs, credit
card numbers, email addresses), named entity recognition (NER models for names,
addresses, organizations), and statistical analysis (high-cardinality string columns
that correlate with user IDs). Scan results update the catalog automatically.

### Data Classification: Five Levels

Data classification assigns a sensitivity level to every registered data asset. The
levels are:

| Level | Label | Description | Examples | Access Control |
|-------|-------|-------------|----------|----------------|
| L0 | **Public** | Data intended for public consumption | Marketing copy, public API docs, open-source model cards | No restriction |
| L1 | **Internal** | Non-sensitive operational data | System logs (scrubbed), aggregated metrics, feature flags | Authenticated Hanzo employees |
| L2 | **Confidential** | Business-sensitive data | Revenue figures, customer counts, unreleased product plans | Role-based, need-to-know |
| L3 | **Restricted** | PII and sensitive personal data | User emails, payment info, session recordings, IP addresses | Explicit approval, encrypted at rest and in transit |
| L4 | **Regulated** | Data subject to legal/regulatory requirements | Health records (HIPAA), financial records (SOX), EU citizen PII (GDPR) | Regulatory controls, audit required for every access |

Classification is assigned automatically by PII scanning and can be overridden
manually by data owners. The highest classification found in any column or field
determines the classification of the entire asset. A table with 50 innocuous columns
and one column containing email addresses is classified L3.

## Specification

### Architecture

```
                     ┌────────────────────────────────────────────────┐
                     │         Hanzo Governance API (8066)            │
                     │                                                │
                     │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
                     │  │ Catalog  │ │ Lineage  │ │  Compliance  │   │
                     │  │ Service  │ │ Service  │ │   Engine     │   │
                     │  └────┬─────┘ └────┬─────┘ └──────┬───────┘   │
                     │       │            │              │           │
                     │  ┌────┴────────────┴──────────────┴────────┐  │
                     │  │            Policy Engine                 │  │
                     │  └────┬────────────┬──────────────┬────────┘  │
                     │       │            │              │           │
                     │  ┌────┴─────┐ ┌────┴─────┐ ┌─────┴────────┐  │
                     │  │   PII    │ │ Quality  │ │  Retention   │  │
                     │  │ Scanner  │ │ Monitor  │ │  Manager     │  │
                     │  └──────────┘ └──────────┘ └──────────────┘  │
                     └───────────┬────────────────────┬──────────────┘
                                 │                    │
            ┌────────────────────┼────────────────────┼───────────────┐
            │                    │                    │               │
            ▼                    ▼                    ▼               ▼
     ┌────────────┐    ┌──────────────┐    ┌──────────────┐   ┌──────────┐
     │ PostgreSQL │    │    Object    │    │   Hanzo DB   │   │   ML     │
     │  HIP-0029  │    │   Storage   │    │   HIP-0058   │   │ Pipeline │
     │            │    │  HIP-0032   │    │              │   │ HIP-0057 │
     └────────────┘    └──────────────┘    └──────────────┘   └──────────┘
```

The governance service is a stateless Go binary. Its own metadata -- the catalog,
lineage graph, audit log, scan results -- is stored in PostgreSQL (HIP-0029). The
service connects to all governed backends as a read-only observer for scanning, and
receives lineage events asynchronously through the event stream (HIP-0030).

### Data Catalog

The catalog is a searchable inventory of every data asset in the Hanzo ecosystem.

#### Asset Registration

Every data asset MUST be registered in the catalog. Registration happens through:

1. **Automatic discovery.** The governance service connects to each backend on a
   schedule and discovers new tables, buckets, collections, and indices. For
   PostgreSQL, it queries `information_schema.tables`. For Object Storage, it lists
   buckets and top-level prefixes. For Hanzo DB, it queries the routing metadata.

2. **Explicit registration.** Services register assets through the governance API
   when they create new data stores programmatically.

3. **ML Pipeline integration.** When the ML Pipeline (HIP-0057) creates a new
   dataset version, it registers the dataset in the governance catalog automatically.

#### Catalog Schema

```yaml
CatalogEntry:
  id: string                        # UUID
  name: string                      # Human-readable name
  type: enum                        # table | bucket | collection | dataset | model | index
  backend: enum                     # postgresql | object_storage | documentdb | qdrant | clickhouse
  location: string                  # Connection-specific path (schema.table, s3://bucket/prefix, etc.)
  organization: string              # Owning org in Hanzo IAM
  owner: string                     # IAM user ID of the data owner
  classification: enum              # L0_PUBLIC | L1_INTERNAL | L2_CONFIDENTIAL | L3_RESTRICTED | L4_REGULATED
  classification_source: enum       # AUTO_SCAN | MANUAL_OVERRIDE | INHERITED
  description: string               # Human-written description (optional)
  tags: string[]                    # Searchable tags
  schema_info:                      # Structural metadata (backend-specific)
    columns:                        # For tabular data
      - name: string
        type: string
        nullable: boolean
        pii_detected: boolean
        pii_type: string            # email | phone | ssn | name | address | ip | credit_card | ...
    record_count: integer
    size_bytes: integer
  created_at: timestamp
  updated_at: timestamp
  last_scanned_at: timestamp
  retention_policy: string          # Reference to a retention policy ID
  lineage_node_id: string           # Reference to the lineage graph node
```

#### Catalog API

```
GET    /v1/catalog                       # List assets (paginated, filterable)
GET    /v1/catalog/:id                   # Get asset by ID
POST   /v1/catalog                       # Register asset
PUT    /v1/catalog/:id                   # Update asset metadata
DELETE /v1/catalog/:id                   # Deregister asset
GET    /v1/catalog/search?q=<query>      # Full-text search across names, descriptions, tags
GET    /v1/catalog/classify/:id          # Get classification details for an asset
PUT    /v1/catalog/classify/:id          # Override classification manually
```

### Data Lineage

Lineage is a directed acyclic graph (DAG) where nodes are data assets and edges are
transformations. Every time data flows from one asset to another -- an ETL job reads
a table and writes a Parquet file, a training run reads a dataset and produces a
model, a preprocessing step reads raw data and writes cleaned data -- an edge is
added to the lineage graph.

#### Lineage Event Schema

```yaml
LineageEvent:
  id: string                        # UUID
  timestamp: timestamp              # When the transformation occurred
  source_ids: string[]              # Catalog IDs of input assets
  target_ids: string[]              # Catalog IDs of output assets
  operation: string                 # Human-readable operation name
  operation_type: enum              # COPY | TRANSFORM | TRAIN | FINE_TUNE | EXPORT | DELETE | AGGREGATE
  actor: string                     # IAM user ID or service account that performed the operation
  job_id: string                    # Reference to ML Pipeline job, ETL job, etc.
  parameters: object                # Operation-specific parameters (preprocessing config, hyperparams, etc.)
  metadata: object                  # Arbitrary key-value pairs
```

#### Lineage Collection

Lineage events are collected through three mechanisms:

1. **SDK instrumentation.** The Hanzo Governance SDK (Go and Python) provides a
   `lineage.emit()` function that sends events to the governance service. ML Pipeline
   jobs, ETL scripts, and data processing services call this at each transformation
   step.

2. **Infrastructure hooks.** The governance service installs hooks in Hanzo DB
   (HIP-0058) and Object Storage (HIP-0032) to detect cross-backend data movement
   automatically. When a `CREATE TABLE AS SELECT` crosses backends in Hanzo DB, a
   lineage event is emitted. When a new object is written to a known dataset prefix
   in Object Storage, a lineage event is emitted.

3. **ML Pipeline integration.** The ML Pipeline (HIP-0057) emits lineage events at
   each stage: dataset loaded, preprocessing applied, training started, checkpoint
   saved, model registered. This provides automatic training provenance without
   requiring researchers to instrument their training scripts.

All collection paths are asynchronous. Events are published to the event stream
(HIP-0030, topic `governance.lineage`) and consumed by the governance service. No
data operation blocks on lineage recording.

#### Lineage Query API

```
GET  /v1/lineage/:asset_id                      # Get lineage for an asset
GET  /v1/lineage/:asset_id/upstream?depth=N      # Trace upstream N levels
GET  /v1/lineage/:asset_id/downstream?depth=N    # Trace downstream N levels
GET  /v1/lineage/:asset_id/full                  # Full provenance chain (root to leaves)
GET  /v1/lineage/path?from=:id&to=:id            # Shortest path between two assets
POST /v1/lineage/events                          # Record a lineage event
GET  /v1/lineage/events?job_id=:id               # Get all events for a job
```

#### Example: Model Provenance Query

```
GET /v1/lineage/model-zen-72b-finance-v3/full

Response:
{
  "asset": "model-zen-72b-finance-v3",
  "chain": [
    {
      "asset": "commerce.transactions (PostgreSQL)",
      "classification": "L3_RESTRICTED",
      "operation": "EXPORT",
      "target": "s3://hanzo-ml/raw/commerce-txns-2026-01/"
    },
    {
      "asset": "s3://hanzo-ml/raw/commerce-txns-2026-01/",
      "classification": "L3_RESTRICTED",
      "operation": "TRANSFORM (PII masking, dedup, tokenization)",
      "target": "dataset:finance-corpus-v3"
    },
    {
      "asset": "dataset:finance-corpus-v3",
      "classification": "L1_INTERNAL",
      "operation": "TRAIN (LoRA fine-tune, run ml-run-a1b2c3)",
      "target": "model-zen-72b-finance-v3"
    }
  ]
}
```

This chain shows that the model's training data originated from the commerce
transactions table (L3_RESTRICTED because it contains payment info), was transformed
with PII masking that reduced the classification to L1_INTERNAL, and was used in a
LoRA fine-tuning run. If a GDPR deletion request comes in for a user whose
transactions were in that export, the lineage chain tells us exactly which datasets
and models are affected.

### PII Detection

The PII scanner operates in two modes: scheduled scans and on-demand scans.

#### Scheduled Scans

Every registered catalog asset is scanned on a configurable schedule (default: daily
for L3/L4 assets, weekly for L1/L2, monthly for L0). The scanner:

1. **Connects to the backend** using read-only credentials.
2. **Samples data.** For large tables (>1M rows), it samples 10,000 random rows. For
   Object Storage, it reads the first 10MB of each file. Sampling is configurable.
3. **Applies detection rules.** Three detection layers run in parallel:
   - **Pattern matching**: Regex for structured PII (SSN: `\d{3}-\d{2}-\d{4}`,
     credit card: Luhn-valid 13-19 digit sequences, email: RFC 5322 pattern, phone:
     E.164 and regional formats, IP address: IPv4 and IPv6).
   - **NER model**: A lightweight named entity recognition model (distilled from
     Zen-1.5b) identifies names, addresses, organizations, and dates of birth in
     free-text fields.
   - **Statistical analysis**: High-cardinality string columns that correlate with
     unique user IDs are flagged as potential quasi-identifiers (zip code + birth
     date + gender can uniquely identify individuals even without names).
4. **Updates the catalog** with detected PII types per column/field.
5. **Emits alerts** if newly detected PII raises an asset's classification above its
   current level.

#### Detection Types

```yaml
PII Types:
  DIRECT_IDENTIFIERS:
    - EMAIL                  # RFC 5322 email addresses
    - PHONE                  # E.164 and regional phone formats
    - SSN                    # Social Security Numbers (US)
    - NATIONAL_ID            # Government-issued IDs (multi-country)
    - PASSPORT               # Passport numbers
    - CREDIT_CARD            # Luhn-valid card numbers
    - DRIVERS_LICENSE        # State/country-specific formats

  INDIRECT_IDENTIFIERS:
    - FULL_NAME              # First + last name combinations
    - DATE_OF_BIRTH          # Birth dates
    - ADDRESS                # Physical addresses
    - IP_ADDRESS             # IPv4 and IPv6
    - DEVICE_ID              # Mobile device identifiers
    - GEOLOCATION            # Lat/lng coordinates with sufficient precision

  QUASI_IDENTIFIERS:
    - ZIP_CODE               # Postal codes (k-anonymity risk when combined)
    - GENDER                 # Gender/sex fields
    - ETHNICITY              # Ethnic/racial categories
    - AGE_RANGE              # Age brackets
```

### GDPR/CCPA Compliance Engine

The compliance engine handles data subject requests (DSRs) -- the operational
implementation of privacy rights.

#### Supported Request Types

| Request Type | GDPR Article | CCPA Section | Action |
|-------------|--------------|--------------|--------|
| Right to Access | Art. 15 | 1798.100 | Export all data associated with the subject |
| Right to Erasure | Art. 17 | 1798.105 | Delete all data associated with the subject |
| Right to Portability | Art. 20 | 1798.100 | Export in machine-readable format |
| Right to Rectification | Art. 16 | 1798.106 | Update incorrect personal data |
| Right to Opt-Out | -- | 1798.120 | Stop processing for sale/sharing |

#### Deletion Propagation

When a deletion request arrives, the compliance engine:

1. **Identifies all assets** containing the subject's data by querying the catalog
   for assets with PII and cross-referencing with the lineage graph.
2. **Generates a deletion plan** listing every backend, table, and record to delete.
3. **Requires approval** from a data protection officer (DPO) before execution.
4. **Executes deletions** across all backends, using backend-specific mechanisms
   (SQL DELETE for PostgreSQL, object deletion for S3, etc.).
5. **Records the deletion** in an immutable audit log (the audit log itself never
   contains the deleted data, only the fact that a deletion occurred).
6. **Flags affected models.** If the deleted data was used to train a model (per
   lineage), the model is flagged for review. Full model retraining may be required
   to truly remove the influence of deleted training data -- this is noted in the
   audit record.

```
POST /v1/compliance/dsr
{
  "type": "ERASURE",
  "subject_id": "user-abc123",
  "subject_email": "user@example.com",
  "regulation": "GDPR",
  "requested_at": "2026-02-23T10:00:00Z"
}

Response:
{
  "dsr_id": "dsr-xyz789",
  "status": "PENDING_APPROVAL",
  "affected_assets": [
    { "id": "cat-001", "name": "iam.users", "backend": "postgresql", "records": 1 },
    { "id": "cat-002", "name": "commerce.orders", "backend": "postgresql", "records": 47 },
    { "id": "cat-003", "name": "s3://hanzo-ml/datasets/finance-corpus/v3/", "backend": "object_storage", "records": 12 }
  ],
  "affected_models": [
    { "id": "model-zen-72b-finance-v3", "training_data_overlap": true, "action": "FLAG_FOR_REVIEW" }
  ]
}
```

### Data Quality Monitoring

Data quality monitoring ensures that governed data assets remain healthy over time.

#### Quality Checks

| Check | Description | Frequency |
|-------|-------------|-----------|
| **Schema validation** | Columns match expected types and constraints | On every write (via hooks) |
| **Freshness** | Data was updated within the expected window | Configurable (hourly default) |
| **Volume** | Record count is within expected bounds (no sudden drops/spikes) | Daily |
| **Null rate** | Null percentage per column stays within threshold | Daily |
| **Uniqueness** | Primary key and unique columns have no duplicates | Daily |
| **Distribution drift** | Statistical distribution of numeric columns has not shifted | Weekly |
| **Referential integrity** | Foreign key references resolve to existing records | Daily |
| **Custom rules** | User-defined SQL assertions | Configurable |

#### Quality Rule Schema

```yaml
QualityRule:
  id: string
  asset_id: string                  # Catalog asset this rule applies to
  check_type: enum                  # FRESHNESS | VOLUME | NULL_RATE | UNIQUENESS | DRIFT | CUSTOM
  parameters:
    freshness_max_age: duration     # e.g., "6h" -- data must be updated within 6 hours
    volume_min: integer             # Minimum expected record count
    volume_max: integer             # Maximum expected record count
    null_rate_max: float            # Maximum null percentage (0.0 to 1.0)
    drift_threshold: float          # KL divergence threshold for distribution drift
    custom_sql: string              # SQL query that must return 0 rows (violations)
  severity: enum                    # INFO | WARNING | CRITICAL
  schedule: cron                    # When to run the check
  notification_channel: string      # Slack channel, email, or webhook for alerts
```

#### Quality API

```
GET    /v1/quality/rules                  # List all quality rules
POST   /v1/quality/rules                  # Create a quality rule
GET    /v1/quality/rules/:id              # Get rule details
PUT    /v1/quality/rules/:id              # Update a rule
DELETE /v1/quality/rules/:id              # Delete a rule
POST   /v1/quality/rules/:id/run          # Run a rule immediately
GET    /v1/quality/results?asset_id=:id   # Get quality results for an asset
GET    /v1/quality/dashboard              # Aggregate quality scores across all assets
```

### Retention Policies

Retention policies automate data lifecycle management. Every catalog asset SHOULD
have an assigned retention policy. Assets without a policy inherit the organization
default.

#### Retention Policy Schema

```yaml
RetentionPolicy:
  id: string
  name: string                      # e.g., "user-data-3y", "logs-90d", "model-artifacts-indefinite"
  description: string
  rules:
    - classification: L3_RESTRICTED
      max_age: "1095d"              # 3 years
      action: DELETE                # DELETE | ARCHIVE | ANONYMIZE
      archive_target: string        # For ARCHIVE: s3://hanzo-archive/...
    - classification: L1_INTERNAL
      max_age: "365d"
      action: ARCHIVE
    - classification: L0_PUBLIC
      max_age: null                 # No expiration
      action: RETAIN
  grace_period: "30d"               # Notification before action executes
  legal_hold: boolean               # If true, retention actions are suspended
```

The retention manager runs daily. For each asset with an expired retention window:

1. **Check legal hold.** If the asset or its organization is under legal hold, skip.
2. **Notify the data owner** that the retention action will execute after the grace
   period.
3. **After grace period**, execute the action (delete, archive to cold storage, or
   anonymize by replacing PII fields with hashed values).
4. **Record the action** in the audit log with lineage event.

### Data Access Auditing

Every data access through governed pathways is logged. The audit log records:

```yaml
AuditEntry:
  id: string
  timestamp: timestamp
  actor: string                     # IAM user ID or service account
  action: enum                      # READ | WRITE | DELETE | EXPORT | SCHEMA_CHANGE
  asset_id: string                  # Catalog asset accessed
  backend: string                   # Which backend was accessed
  query_hash: string                # SHA-256 of the query (not the query itself, to avoid logging data)
  rows_affected: integer
  classification_at_access: enum    # Classification level at time of access
  source_ip: string
  user_agent: string
```

Audit entries are written to ClickHouse (HIP-0047 via Hanzo DB) for high-throughput
ingestion and fast analytical queries. The Analytics layer (HIP-0017) can correlate
data access patterns with product usage patterns for security analysis.

## Integration

### Integration with Hanzo DB (HIP-0058)

Hanzo DB is the primary interface through which services access governed data. The
integration is bidirectional:

- **Metadata extraction**: The governance service connects to Hanzo DB's routing
  metadata to discover all registered backends, tables, and collections. When a new
  table is created through Hanzo DB, the governance service is notified via event
  stream and auto-registers it in the catalog.

- **Query interception**: Hanzo DB can optionally route queries through the governance
  policy engine before execution. If a query accesses an L4_REGULATED asset, the
  policy engine verifies that the requesting service account has the required
  classification clearance. This is opt-in per backend to avoid latency on hot paths.

- **Column masking**: For L3/L4 assets, Hanzo DB can apply column-level masking
  (replacing PII with redacted values) based on the requester's clearance level. A
  service with L1 clearance querying a table with L3 columns sees `[REDACTED]`
  instead of actual values.

### Integration with Object Storage (HIP-0032)

Object Storage holds the bulk of unstructured data: model weights, training datasets,
user uploads, backups.

- **Bucket registration**: All buckets are auto-registered in the catalog. New bucket
  creation triggers catalog registration.
- **Object scanning**: The PII scanner can read and scan objects in supported formats
  (Parquet, CSV, JSONL, text). Binary formats (model weights, images) are classified
  based on their lineage rather than content scanning.
- **Access logging**: Object Storage access logs are forwarded to the governance
  audit log for unified access tracking.

### Integration with ML Pipeline (HIP-0057)

The ML Pipeline is the primary producer of lineage events in the Hanzo ecosystem.

- **Dataset registration**: When the ML Pipeline creates a dataset version, it
  registers the dataset in the governance catalog with full schema information.
- **Training lineage**: Every training run emits lineage events linking input datasets
  to output model artifacts. The governance service records the full training
  configuration (hyperparameters, preprocessing steps, data splits) as lineage
  metadata.
- **PII in training data**: The governance service flags training datasets that
  contain PII (detected by scanning). The ML Pipeline can enforce a policy: "do not
  start a training run if any input dataset is classified above L2 unless PII masking
  preprocessing has been applied."

### Integration with SBOM (HIP-0074)

Software Bill of Materials tracks software dependencies. Data governance extends this
concept to data dependencies.

- **Data-as-dependency**: When a model is registered in the SBOM, its training data
  lineage is included as a "data dependency." This allows downstream consumers to
  understand not just what software built the model, but what data trained it.
- **License propagation**: If training data carries a restrictive license (e.g.,
  non-commercial use only), that license constraint propagates through lineage to
  any model trained on it. The SBOM integration surfaces these constraints.

### Integration with Analytics (HIP-0017)

- **Access pattern analysis**: Data access audit events are available in the Analytics
  layer for anomaly detection. Unusual access patterns (a service account suddenly
  reading 100x more records than normal, or accessing L4 data it has never touched)
  trigger alerts.
- **Governance dashboards**: Pre-built dashboards in Hanzo Insights show data
  classification distribution, PII scan results over time, DSR completion rates,
  and data quality trends.

## Configuration

```yaml
# hanzo-governance.yaml
server:
  port: 8066
  grpc_port: 8067

catalog:
  auto_discovery:
    enabled: true
    schedule: "0 */6 * * *"         # Every 6 hours
    backends:
      - type: postgresql
        connection: "${DATABASE_URL}"
      - type: object_storage
        endpoint: "s3.hanzo.svc:9000"
      - type: hanzo_db
        endpoint: "db.hanzo.svc:8058"

scanner:
  pii:
    enabled: true
    schedule:
      L3_RESTRICTED: "0 2 * * *"    # Daily at 2 AM
      L2_CONFIDENTIAL: "0 2 * * 1"  # Weekly on Monday
      L1_INTERNAL: "0 2 1 * *"      # Monthly on 1st
    sample_size: 10000
    ner_model: "hanzo-governance-ner-v1"

quality:
  default_schedule: "0 4 * * *"     # Daily at 4 AM
  alert_channels:
    critical: "slack:#data-quality-critical"
    warning: "slack:#data-quality"

retention:
  enforcement_schedule: "0 0 * * *" # Daily at midnight
  default_grace_period: "30d"

compliance:
  gdpr_enabled: true
  ccpa_enabled: true
  dsr_approval_required: true
  dpo_email: "dpo@hanzo.ai"

lineage:
  collection:
    event_topic: "governance.lineage"
    stream: "hanzo-stream:9092"     # HIP-0030
  async: true                       # Fire-and-forget lineage events

audit:
  storage: clickhouse               # HIP-0047 via Hanzo DB
  retention: "2y"                   # Audit logs retained for 2 years
```

## Deployment

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-governance
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-governance
  template:
    metadata:
      labels:
        app: hanzo-governance
    spec:
      containers:
        - name: governance
          image: ghcr.io/hanzoai/governance:latest
          ports:
            - containerPort: 8066
              name: http
            - containerPort: 8067
              name: grpc
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: governance-db
                  key: url
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "2Gi"
---
apiVersion: v1
kind: Service
metadata:
  name: governance
  namespace: hanzo
spec:
  selector:
    app: hanzo-governance
  ports:
    - port: 8066
      targetPort: 8066
      name: http
    - port: 8067
      targetPort: 8067
      name: grpc
```

### Local Development

```bash
# Start dependencies
docker compose -f compose.dev.yml up -d

# Build and run
go build -o hanzo-governance .
./hanzo-governance --config hanzo-governance.yaml

# Or via Make
make dev
```

## Security Considerations

1. **The governance service has read access to all backends.** Its credentials are
   the most sensitive in the system. They MUST be stored in KMS and rotated on a
   30-day schedule.

2. **Audit logs are append-only.** No API endpoint allows deletion or modification
   of audit entries. This prevents tampering with the compliance record.

3. **PII scan results are themselves sensitive.** The catalog contains metadata about
   where PII exists. Access to the governance API requires L2_CONFIDENTIAL clearance
   at minimum.

4. **DSR execution is irreversible.** Deletion requests require DPO approval and
   produce an immutable audit record. There is no "undo deletion" capability by design.

5. **Lineage events cannot be retroactively removed.** Even if the underlying data is
   deleted (per DSR), the lineage record that the data existed and was used persists.
   This is necessary for compliance audit trails.

## Backward Compatibility

Existing services that do not emit lineage events will have incomplete lineage graphs.
The governance service handles this gracefully:

- Assets discovered by auto-discovery but with no lineage events are marked
  `lineage: UNKNOWN`.
- Partial lineage (some edges known, others missing) is displayed with explicit gaps.
- Services can backfill lineage by submitting historical events through the API.

No existing service is required to change its behavior for the governance service to
provide value. Auto-discovery and PII scanning work on day one without any integration
code. Lineage coverage improves incrementally as services adopt the SDK.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
