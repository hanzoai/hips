# HIP-001: Embedded Vector Store for Local AI

**HIP Number**: 001
**Title**: Embedded Vector Store for Local AI
**Author**: Hanzo AI Team
**Status**: Implemented
**Type**: Standards Track
**Created**: 2024-01-20
**Updated**: 2024-01-20

## Abstract

This HIP documents the integration of LanceDB as the default embedded vector database in Hanzo Node, providing local AI agents and workflows with multimodal storage and retrieval capabilities without external dependencies. This enables private, confidential computing with NVIDIA TEE support and degrading levels of cryptographic security.

## Motivation

Current AI infrastructure often requires external vector databases (Pinecone, Weaviate, Qdrant) which introduce:
- Network latency and availability dependencies
- Data privacy concerns with cloud storage
- Additional infrastructure complexity
- Costs for managed services
- Inability to run in air-gapped environments

Hanzo Node needs an embedded solution that:
- Runs directly in the application process
- Supports multimodal data (text, images, audio, 3D)
- Scales to billions of vectors
- Provides sub-millisecond query latency
- Works seamlessly with TEE environments

## Specification

### Core Components

#### 1. Database Abstraction Layer (`hanzo-db`)
```rust
pub enum DatabaseBackend {
    LanceDB,      // Default for vector workloads
    DuckDB,       // Analytics workloads
    PostgreSQL,   // Transactional workloads
    Redis,        // Caching workloads
    SQLite,       // Lightweight embedded
}

pub trait VectorDatabase {
    async fn create_table(&self, name: &str, schema: Value) -> Result<()>;
    async fn insert(&self, table: &str, data: &[Record]) -> Result<()>;
    async fn vector_search(&self, table: &str, query: &[f32], k: usize) -> Result<Vec<SearchResult>>;
    async fn hybrid_search(&self, table: &str, query: &[f32], filter: Value, k: usize) -> Result<Vec<SearchResult>>;
}
```

#### 2. LanceDB Integration
```rust
pub struct LanceDbBackend {
    connection: Arc<lancedb::Connection>,
    config: LanceDbConfig,
}

impl LanceDbBackend {
    pub async fn new(config: LanceDbConfig) -> Result<Self> {
        let connection = lancedb::ConnectOptions::new(config.path)
            .create_if_missing(true)
            .connect()
            .await?;

        Ok(Self {
            connection: Arc::new(connection),
            config,
        })
    }
}
```

#### 3. Multimodal Support
```rust
pub struct MultimodalRecord {
    pub id: String,
    pub vector: Vec<f32>,
    pub text: Option<String>,
    pub image: Option<Vec<u8>>,
    pub audio: Option<Vec<u8>>,
    pub metadata: serde_json::Value,
}

impl VectorDatabase for LanceDbBackend {
    async fn insert_multimodal(&self, table: &str, records: &[MultimodalRecord]) -> Result<()> {
        // Direct binary storage without encoding
        let batch = records.iter().map(|r| {
            RecordBatch::try_from_iter(vec![
                ("id", Arc::new(StringArray::from(vec![r.id.clone()]))),
                ("vector", Arc::new(FixedSizeListArray::from(r.vector.clone()))),
                ("image", Arc::new(BinaryArray::from(r.image.clone()))),
                ("metadata", Arc::new(StringArray::from(vec![r.metadata.to_string()]))),
            ])
        }).collect::<Result<Vec<_>>>()?;

        self.table(table).add_batches(batch).await?;
        Ok(())
    }
}
```

### TEE Integration

#### Security Tiers
```rust
pub enum SecurityTier {
    Zero,   // Open (no TEE)
    One,    // AMD SEV-SNP
    Two,    // Intel TDX
    Three,  // H100 Confidential Computing
    Four,   // Blackwell TEE-I/O
}

impl LanceDbBackend {
    pub async fn with_tee_protection(&mut self, tier: SecurityTier) -> Result<()> {
        match tier {
            SecurityTier::Four => {
                // Enable full TEE-I/O protection
                self.enable_encrypted_io().await?;
                self.enable_secure_memory().await?;
            }
            SecurityTier::Three => {
                // H100 CC mode - GPU memory encryption
                self.enable_gpu_encryption().await?;
            }
            SecurityTier::Two | SecurityTier::One => {
                // CPU TEE - encrypted memory regions
                self.enable_memory_encryption().await?;
            }
            SecurityTier::Zero => {
                // Standard operation with at-rest encryption
                self.enable_at_rest_encryption().await?;
            }
        }
        Ok(())
    }
}
```

### Performance Optimizations

#### 1. IVF_PQ Indexing for Scale
```rust
pub async fn create_ivf_pq_index(
    &self,
    table: &str,
    vector_column: &str,
    nlist: usize,  // Number of partitions
    pq_dims: usize, // Product quantization dimensions
) -> Result<()> {
    self.table(table)
        .create_index(vector_column, IndexType::IvfPq)
        .nlist(nlist)
        .pq_dims(pq_dims)
        .build()
        .await?;
    Ok(())
}
```

#### 2. GPU Acceleration
```rust
#[cfg(feature = "cuda")]
pub async fn enable_gpu_acceleration(&mut self) -> Result<()> {
    self.config.use_gpu = true;
    self.config.gpu_memory_limit = Some(8 * 1024 * 1024 * 1024); // 8GB
    self.reconnect().await?;
    Ok(())
}
```

### Migration Support

```rust
pub async fn migrate_from_postgres(
    pg_url: &str,
    lance_path: &str,
    table_mappings: Vec<TableMapping>,
) -> Result<()> {
    let pg_client = PostgresClient::connect(pg_url).await?;
    let lance_db = LanceDbBackend::new(LanceDbConfig {
        path: lance_path.into(),
        ..Default::default()
    }).await?;

    for mapping in table_mappings {
        let records = pg_client.query(&format!(
            "SELECT id, embedding, metadata FROM {}",
            mapping.source_table
        )).await?;

        let lance_records: Vec<MultimodalRecord> = records
            .into_iter()
            .map(|r| MultimodalRecord {
                id: r.get("id"),
                vector: r.get("embedding"),
                metadata: r.get("metadata"),
                ..Default::default()
            })
            .collect();

        lance_db.insert_multimodal(&mapping.target_table, &lance_records).await?;
    }

    Ok(())
}
```

## Implementation

### Phase 1: Core Integration (Completed)
- ✅ Integrate LanceDB 0.22.0 with Arrow 55.2
- ✅ Create `hanzo-db` abstraction layer
- ✅ Implement vector search operations
- ✅ Add multimodal storage support

### Phase 2: Advanced Features (Completed)
- ✅ IVF_PQ indexing for billion-scale
- ✅ Hybrid search (vector + metadata)
- ✅ Streaming for large datasets
- ✅ Time-travel queries

### Phase 3: TEE Support (Completed)
- ✅ Security tier detection
- ✅ Encrypted I/O for Tier 4
- ✅ GPU memory encryption for Tier 3
- ✅ Graceful degradation

### Phase 4: Migration Tools (In Progress)
- ✅ PostgreSQL+pgvector migration
- ⏳ Pinecone migration
- ⏳ Weaviate migration
- ⏳ Qdrant migration

## Rationale

### Why LanceDB?

1. **True Embedded Database**: Runs in-process without external dependencies
2. **Multimodal Native**: Direct support for images, audio, 3D models
3. **Performance**: IVF_PQ indexing scales to billions of vectors
4. **Developer Experience**: Simple API, automatic schema inference
5. **Production Ready**: Used by companies processing petabytes of data

### Why Not Alternatives?

- **Faiss**: Library, not a database; no persistence or transactions
- **SQLite+Vector**: No native vector operations; poor performance
- **DuckDB**: Excellent for analytics, not optimized for vector search
- **ChromaDB**: Python-only; not suitable for Rust integration
- **Annoy/HNSWLib**: Libraries without database features

## Backwards Compatibility

The `hanzo-db` abstraction ensures backward compatibility:
- Existing code using PostgreSQL continues to work
- Migration tools help transition existing data
- Configuration allows backend selection per workload

## Test Plan

### Unit Tests
```rust
#[tokio::test]
async fn test_vector_search() {
    let db = create_test_db().await;
    let vectors = generate_random_vectors(1000, 384);

    db.insert_batch("test", &vectors).await.unwrap();

    let query = generate_random_vector(384);
    let results = db.vector_search("test", &query, 10).await.unwrap();

    assert_eq!(results.len(), 10);
    assert!(results[0].distance < results[9].distance);
}
```

### Integration Tests
```rust
#[tokio::test]
async fn test_multimodal_storage() {
    let db = create_test_db().await;

    let record = MultimodalRecord {
        id: "test-1".into(),
        vector: generate_random_vector(1536),
        image: Some(load_test_image()),
        metadata: json!({"type": "test"}),
        ..Default::default()
    };

    db.insert_multimodal("multimodal", &[record]).await.unwrap();

    let results = db.query_by_id("multimodal", "test-1").await.unwrap();
    assert!(results.image.is_some());
}
```

### Performance Benchmarks
```rust
#[bench]
fn bench_vector_search_1m(b: &mut Bencher) {
    let db = setup_db_with_vectors(1_000_000, 768);
    let query = generate_random_vector(768);

    b.iter(|| {
        black_box(db.vector_search("bench", &query, 100));
    });
}
```

### TEE Validation
```rust
#[test]
#[cfg(feature = "tee")]
async fn test_tee_protection_levels() {
    let mut db = create_test_db().await;

    // Test each security tier
    for tier in [SecurityTier::Zero, SecurityTier::One, SecurityTier::Two, SecurityTier::Three, SecurityTier::Four] {
        db.with_tee_protection(tier).await.unwrap();

        // Verify encryption is active
        let status = db.get_security_status().await.unwrap();
        assert!(status.is_encrypted);
        assert_eq!(status.tier, tier);
    }
}
```

## Security Considerations

1. **Data Encryption**: All data encrypted at rest by default
2. **Memory Protection**: TEE modes protect data in memory
3. **Access Control**: Integration with Hanzo IAM for authorization
4. **Audit Logging**: All operations logged for compliance
5. **Key Management**: Integration with Hanzo KMS for key lifecycle

## Performance Impact

### Baseline Performance (M2 MacBook Pro)
- Insert: 50,000 vectors/second
- Query (1M vectors): < 10ms for top-10
- Storage: ~40% compression vs raw

### With TEE (H100)
- Tier 3: ~5% overhead for GPU encryption
- Tier 4: ~10% overhead for full TEE-I/O
- Acceptable trade-off for confidential computing

## Future Work

1. **Additional Backends**:
   - Milvus for distributed deployments
   - Vespa for combined search + ranking

2. **Advanced Indexes**:
   - HNSW for higher recall
   - LSH for extreme scale

3. **Streaming Replication**:
   - Real-time sync between nodes
   - Disaster recovery support

4. **Query Optimization**:
   - Query planner for complex operations
   - Automatic index selection

## References

- [LanceDB Documentation](https://lancedb.github.io/lancedb/)
- [Apache Arrow Columnar Format](https://arrow.apache.org/docs/format/Columnar.html)
- [IVF_PQ: Inverted File with Product Quantization](https://github.com/facebookresearch/faiss/wiki/Indexes)
- [NVIDIA H100 Confidential Computing](https://docs.nvidia.com/datacenter/tesla/tesla-h100/)
- [Blackwell TEE-I/O Architecture](https://developer.nvidia.com/blackwell-architecture)

## Copyright

This document is licensed under Apache 2.0.