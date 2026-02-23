---
hip: 0016
title: Document Processing Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-4
---

# HIP-16: Document Processing Standard

## Abstract

This proposal defines the universal document processing standard for the Hanzo ecosystem. It specifies a format-agnostic parsing pipeline that ingests arbitrary documents (PDF, DOCX, PPTX, XLSX, HTML, Markdown, images, code files, and plain text), extracts structured content with metadata, chunks the output into semantically coherent segments, generates vector embeddings, and stores the results for retrieval-augmented generation (RAG). All document ingestion across Hanzo services MUST conform to this interface.

**Repository**: [github.com/hanzoai/documents](https://github.com/hanzoai/documents)
**Port**: 8016 (API)
**Dependencies**: HIP-4 (LLM Gateway), HIP-29 (Vector Store / pgvector)

## Motivation

Every AI application eventually needs to read documents. Customer support bots ingest knowledge bases. Legal assistants parse contracts. Financial analysts process quarterly reports. Research agents consume academic papers. The quality of document parsing directly determines the quality of downstream AI — bad parsing produces bad retrieval, which produces bad answers.

Without a standard, each service reimplements parsing with different libraries, different chunking strategies, different metadata schemas, and different quality thresholds. This creates:

1. **Duplicated effort**: Three teams writing PDF parsers with incompatible output formats.
2. **Inconsistent quality**: One service uses PyPDF2 (lossy), another uses pdfplumber (better tables), a third uses OCR for everything. Users get different results depending on which service they hit.
3. **No shared infrastructure**: Embeddings computed by one service cannot be reused by another because chunk boundaries differ.
4. **Format gaps**: A service that only handles PDF silently drops information from DOCX, PPTX, and scanned images.

We need ONE standard that defines:

- Which formats are supported and how each is parsed
- How documents are chunked into semantically meaningful segments
- How metadata is extracted and represented
- How embeddings are computed and stored
- How the parsing pipeline handles degraded inputs (scanned PDFs, handwritten notes, corrupted files)
- How parsed content integrates with vector search for RAG

## Design Philosophy

### Why document processing is core infrastructure

Every RAG pipeline starts with document ingestion. If your parsing is wrong, your embeddings are wrong, your retrieval is wrong, and your AI gives wrong answers. Document processing is not a peripheral feature — it is the foundation that determines the ceiling of every downstream application. By standardizing it as shared infrastructure, we ensure that every Hanzo service builds on the same high-quality extraction layer instead of reinventing it poorly.

### Why multi-format support matters

Enterprise customers do not store everything in PDF. A single business process might produce Word documents (contracts), PowerPoint decks (quarterly reviews), Excel spreadsheets (financial models), HTML pages (internal wikis), Markdown files (engineering docs), and scanned images (signed forms). Supporting only PDF means losing information from every other format. Universal parsing eliminates format barriers and lets users ingest their entire document corpus without conversion.

### Why chunking strategy matters

Naive chunking — splitting every N tokens — breaks semantic boundaries. A 512-token chunk might start mid-sentence in one section and end mid-sentence in another, mixing unrelated topics into a single embedding vector. This produces noisy retrieval results where the retrieved chunk contains half-relevant information polluted by irrelevant context.

Our chunking respects document structure:

- **Headers define section boundaries**: A chunk never spans two sections unless both fit within the token limit.
- **Tables are kept intact**: A financial table is never split across two chunks. If a table exceeds the token limit, it is treated as its own chunk with row-level subdivision.
- **Code blocks are never split mid-function**: A function definition stays in one chunk. If a function exceeds the token limit, it is split at logical boundaries (between methods, between top-level statements).
- **Lists are kept with their parent context**: A bulleted list stays attached to the preceding paragraph that introduces it.

This produces semantically coherent chunks where each embedding vector represents a single, self-contained idea. Vector search against these chunks returns precise, relevant context.

### Why OCR + vision model hybrid

Traditional OCR (Tesseract) handles clean printed text well: it is fast, free, and deterministic. But it fails on handwritten text, complex multi-column layouts, tables embedded in images, mixed-media documents (diagrams with annotations), and degraded scans.

Vision models (Zen multimodal) handle these cases with superior accuracy because they understand spatial layout, not just character shapes. But they are slower and more expensive.

Our hybrid strategy uses OCR first (fast, cheap, good for 80% of pages) and falls back to vision models only for low-confidence pages. This keeps cost low for clean documents while maintaining quality for difficult inputs. The confidence threshold is configurable per deployment.

### Why structured output with provenance

Every chunk carries metadata about its source: which page, which section, which table row. This enables:

- **Citation**: AI answers can cite the exact page and section that supports them.
- **Audit**: Compliance teams can trace any AI output back to its source document.
- **Incremental updates**: When a document is revised, only changed sections need re-parsing and re-embedding.
- **Access control**: Chunk-level metadata enables fine-grained permission checks during retrieval.

## Specification

### Supported Formats

| Format | Extensions | Parser | Notes |
|--------|-----------|--------|-------|
| PDF | `.pdf` | pdfplumber + OCR fallback | Handles text-based and scanned PDFs |
| Word | `.docx`, `.doc` | python-docx, antiword | Full style and structure extraction |
| PowerPoint | `.pptx`, `.ppt` | python-pptx | Slide-by-slide with speaker notes |
| Excel | `.xlsx`, `.xls`, `.csv` | openpyxl, pandas | Sheet-by-sheet, formula evaluation |
| HTML | `.html`, `.htm` | BeautifulSoup + readability | Boilerplate removal, main content extraction |
| Markdown | `.md` | markdown-it-py | Header hierarchy preserved |
| Plain Text | `.txt`, `.log` | Built-in | Line-based with paragraph detection |
| Images | `.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`, `.webp` | Tesseract + Zen vision fallback | OCR with layout analysis |
| Code | `.py`, `.js`, `.ts`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.rb` | tree-sitter | AST-aware parsing, function-level chunks |
| Email | `.eml`, `.msg` | email (stdlib), extract-msg | Headers, body, and attachments parsed recursively |

Unsupported or unrecognized formats return HTTP 415 with a descriptive error. New formats can be added by registering a parser plugin (see Extensibility section).

### Parsing Pipeline

The processing pipeline has five stages. Each stage is independently testable and replaceable.

```
Input Document
    │
    ▼
┌──────────────────┐
│  1. Detection     │  Identify format via magic bytes + extension
└──────────────────┘
    │
    ▼
┌──────────────────┐
│  2. Extraction    │  Format-specific parser → raw content + structure
└──────────────────┘
    │
    ▼
┌──────────────────┐
│  3. Chunking      │  Split into semantically coherent segments
└──────────────────┘
    │
    ▼
┌──────────────────┐
│  4. Embedding     │  Compute vector embeddings via LLM Gateway
└──────────────────┘
    │
    ▼
┌──────────────────┐
│  5. Storage       │  Persist chunks + embeddings in pgvector
└──────────────────┘
```

#### Stage 1: Format Detection

Format is determined by file magic bytes (via `python-magic`), NOT by file extension alone. Extension is used as a secondary signal when magic bytes are ambiguous (e.g., distinguishing `.csv` from `.txt`). If format cannot be determined, the pipeline returns an error rather than guessing.

#### Stage 2: Extraction

Each format has a dedicated extractor that produces a common intermediate representation:

```python
@dataclass
class ExtractedDocument:
    """Intermediate representation after format-specific extraction."""
    content: str                           # Full text content
    pages: list[ExtractedPage]             # Page-by-page breakdown (if applicable)
    tables: list[ExtractedTable]           # Extracted tables with row/column data
    images: list[ExtractedImage]           # Embedded images with captions
    metadata: DocumentMetadata             # Title, author, dates, etc.
    structure: list[StructureElement]      # Headers, sections, lists hierarchy

@dataclass
class ExtractedPage:
    page_number: int
    content: str
    tables: list[ExtractedTable]
    images: list[ExtractedImage]
    ocr_confidence: float | None           # None if no OCR was needed

@dataclass
class ExtractedTable:
    headers: list[str]
    rows: list[list[str]]
    page_number: int | None
    caption: str | None

@dataclass
class ExtractedImage:
    data: bytes
    mime_type: str
    caption: str | None
    alt_text: str | None
    page_number: int | None

@dataclass
class DocumentMetadata:
    title: str | None
    author: str | None
    created_date: datetime | None
    modified_date: datetime | None
    page_count: int | None
    word_count: int
    language: str                           # ISO 639-1 code
    headings: list[str]                     # Flat list of all headings
    source_format: str                      # Detected format identifier

@dataclass
class StructureElement:
    type: str                               # "heading", "paragraph", "list", "code", "table", "image"
    level: int | None                       # Heading level (1-6), list nesting depth
    content: str
    children: list["StructureElement"]
    page_number: int | None
```

**PDF extraction** uses pdfplumber for text-based PDFs. For each page, text extraction is attempted first. If the extracted text is empty or the character count is below a configurable threshold (default: 50 characters per page), the page is flagged for OCR. Tesseract runs first; if OCR confidence is below the threshold (default: 0.7), the page is sent to Zen vision model for re-extraction.

**Code file extraction** uses tree-sitter to parse source code into an AST. Functions, classes, and top-level statements are identified as structural elements. Comments and docstrings are preserved as metadata.

#### Stage 3: Chunking

Four chunking strategies are available. The strategy is selected per-document based on format and structure, or can be overridden by the caller.

**Fixed-size chunking**: Splits content at token boundaries. Respects word boundaries (never splits mid-word). Token counting uses tiktoken with the `cl100k_base` encoding. Default chunk size: 512 tokens. Default overlap: 64 tokens.

```python
@dataclass
class ChunkConfig:
    strategy: str = "semantic"              # "fixed", "semantic", "sliding", "recursive"
    max_tokens: int = 512
    overlap_tokens: int = 64
    respect_structure: bool = True          # Never split mid-table or mid-code-block
    include_headings: bool = True           # Prepend section heading to each chunk
```

**Semantic chunking** (default): Uses the document's structural hierarchy to determine chunk boundaries. Each section (defined by a heading) becomes a chunk if it fits within the token limit. If a section exceeds the limit, it is recursively split at sub-heading boundaries, then at paragraph boundaries, then at sentence boundaries. Tables and code blocks are treated as atomic units — they are never split unless they individually exceed the token limit.

**Sliding window chunking**: Fixed-size windows with configurable overlap. Useful for unstructured text without clear section boundaries (e.g., raw logs, transcripts).

**Recursive chunking**: Splits at the highest structural level first (document → sections → paragraphs → sentences → words), recursively subdividing only segments that exceed the token limit. This is the fallback strategy when semantic chunking fails due to missing structure.

Each chunk includes a heading prefix: if the chunk comes from a section titled "Q3 Revenue Analysis", the chunk text is prepended with "## Q3 Revenue Analysis\n\n" to provide context to the embedding model. This significantly improves retrieval relevance.

#### Stage 4: Embedding

Chunks are embedded via the LLM Gateway (HIP-4). The default model is `text-embedding-3-large` (3072 dimensions). Embedding requests are batched (up to 100 chunks per request) to minimize round-trips.

```python
@dataclass
class EmbeddedChunk:
    chunk_id: str                           # UUID
    document_id: str                        # Parent document UUID
    content: str                            # Chunk text
    embedding: list[float]                  # Vector embedding
    token_count: int                        # Exact token count
    metadata: ChunkMetadata

@dataclass
class ChunkMetadata:
    page_numbers: list[int]                 # Pages this chunk spans
    section_heading: str | None             # Nearest parent heading
    chunk_index: int                        # Position in document (0-based)
    total_chunks: int                       # Total chunks for this document
    element_type: str                       # "text", "table", "code", "image_caption"
    source_format: str                      # Original document format
```

#### Stage 5: Storage

Chunks and embeddings are stored in PostgreSQL with the pgvector extension (HIP-29).

```sql
CREATE TABLE document_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    embedding       vector(3072) NOT NULL,
    token_count     INTEGER NOT NULL,
    chunk_index     INTEGER NOT NULL,
    total_chunks    INTEGER NOT NULL,
    page_numbers    INTEGER[],
    section_heading TEXT,
    element_type    TEXT NOT NULL DEFAULT 'text',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_chunks_embedding ON document_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL,
    filename        TEXT NOT NULL,
    source_format   TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    page_count      INTEGER,
    word_count      INTEGER NOT NULL,
    language        TEXT NOT NULL DEFAULT 'en',
    title           TEXT,
    author          TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    parse_duration  INTERVAL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_documents_status ON documents(status);
```

### API Endpoints

All endpoints require authentication via Bearer token (validated against Hanzo IAM). Documents are scoped to projects; a user can only access documents belonging to projects they have permission to view.

#### Upload and Parse

```
POST /api/v1/documents/parse
Content-Type: multipart/form-data

Parameters:
  file:             Required. The document file.
  project_id:       Required. UUID of the target project.
  chunking_strategy: Optional. "semantic" (default), "fixed", "sliding", "recursive".
  max_tokens:       Optional. Max tokens per chunk (default: 512).
  overlap_tokens:   Optional. Overlap between chunks (default: 64).
  ocr_enabled:      Optional. Enable OCR for images/scans (default: true).
  ocr_threshold:    Optional. Confidence threshold for vision model fallback (default: 0.7).
  language:         Optional. ISO 639-1 language hint (default: auto-detect).

Response: 202 Accepted
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "estimated_duration_seconds": 12
}
```

Processing is asynchronous. The client polls the status endpoint or subscribes to a webhook.

#### Check Status

```
GET /api/v1/documents/{document_id}

Response: 200 OK
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "quarterly-report.pdf",
  "status": "completed",
  "source_format": "pdf",
  "page_count": 42,
  "word_count": 18340,
  "chunk_count": 67,
  "language": "en",
  "title": "Q3 2025 Financial Report",
  "author": "Finance Team",
  "parse_duration": "4.2s",
  "created_at": "2025-01-09T10:30:00Z"
}
```

Status values: `pending`, `processing`, `completed`, `failed`.

#### Get Chunks

```
GET /api/v1/documents/{document_id}/chunks?page=1&per_page=50

Response: 200 OK
{
  "chunks": [
    {
      "id": "chunk-uuid",
      "content": "## Q3 Revenue Analysis\n\nTotal revenue for Q3...",
      "chunk_index": 0,
      "token_count": 487,
      "page_numbers": [3, 4],
      "section_heading": "Q3 Revenue Analysis",
      "element_type": "text"
    }
  ],
  "total": 67,
  "page": 1,
  "per_page": 50
}
```

#### Search (RAG Retrieval)

```
POST /api/v1/documents/search
Content-Type: application/json

{
  "query": "What was the Q3 revenue growth?",
  "project_id": "project-uuid",
  "top_k": 10,
  "threshold": 0.7,
  "filter": {
    "source_format": "pdf",
    "element_type": "text"
  }
}

Response: 200 OK
{
  "results": [
    {
      "chunk_id": "chunk-uuid",
      "document_id": "doc-uuid",
      "content": "## Q3 Revenue Analysis\n\nTotal revenue grew 23% YoY...",
      "score": 0.92,
      "page_numbers": [3],
      "section_heading": "Q3 Revenue Analysis",
      "filename": "quarterly-report.pdf"
    }
  ]
}
```

The search endpoint computes the query embedding via LLM Gateway, then performs a cosine similarity search against pgvector. Results are filtered by project permissions, optional format/type filters, and the similarity threshold.

#### Delete Document

```
DELETE /api/v1/documents/{document_id}

Response: 204 No Content
```

Deletes the document record and all associated chunks (cascading).

#### Batch Upload

```
POST /api/v1/documents/batch
Content-Type: multipart/form-data

Parameters:
  files[]:          Required. Up to 50 files per batch.
  project_id:       Required. UUID of the target project.
  (same optional params as single upload)

Response: 202 Accepted
{
  "batch_id": "batch-uuid",
  "document_ids": ["doc-uuid-1", "doc-uuid-2", ...],
  "status": "processing"
}
```

### Output Format

The canonical output format for a parsed document is structured JSON:

```json
{
  "document_id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "quarterly-report.pdf",
  "source_format": "pdf",
  "metadata": {
    "title": "Q3 2025 Financial Report",
    "author": "Finance Team",
    "created_date": "2025-10-01T00:00:00Z",
    "page_count": 42,
    "word_count": 18340,
    "language": "en",
    "headings": [
      "Executive Summary",
      "Q3 Revenue Analysis",
      "Operating Expenses",
      "Net Income",
      "Outlook"
    ]
  },
  "chunks": [
    {
      "id": "chunk-uuid",
      "index": 0,
      "content": "## Executive Summary\n\nThis report covers...",
      "token_count": 498,
      "page_numbers": [1, 2],
      "section_heading": "Executive Summary",
      "element_type": "text",
      "embedding": [0.0123, -0.0456, ...]
    }
  ],
  "tables": [
    {
      "id": "table-uuid",
      "headers": ["Quarter", "Revenue ($M)", "Growth (%)"],
      "rows": [
        ["Q1 2025", "142.3", "18%"],
        ["Q2 2025", "156.7", "21%"],
        ["Q3 2025", "178.2", "23%"]
      ],
      "page_number": 5,
      "caption": "Table 1: Quarterly Revenue Summary"
    }
  ]
}
```

## Implementation

### Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| API server | FastAPI (Python) | Async I/O, auto-generated OpenAPI docs |
| Format detection | python-magic | Reliable magic byte detection |
| PDF parsing | pdfplumber | Superior table extraction vs. PyPDF2 |
| OCR | Tesseract (pytesseract) | Fast, free, handles clean print |
| Vision fallback | Zen multimodal via LLM Gateway | Handles complex layouts, handwriting |
| DOCX/PPTX/XLSX | python-docx, python-pptx, openpyxl | Native Office format support |
| HTML parsing | BeautifulSoup + readability-lxml | Boilerplate removal |
| Code parsing | tree-sitter | AST-aware, language-agnostic |
| Token counting | tiktoken | Exact counts matching OpenAI tokenizers |
| Embeddings | text-embedding-3-large via LLM Gateway (HIP-4) | High-quality 3072-dim vectors |
| Vector storage | PostgreSQL + pgvector (HIP-29) | Integrated with existing infra |
| Task queue | Redis + Celery | Async document processing |
| Object storage | MinIO / S3 | Raw file storage |

### Project Structure

```
documents/
├── src/
│   ├── api/
│   │   ├── routes.py              # FastAPI route definitions
│   │   ├── models.py              # Pydantic request/response models
│   │   └── dependencies.py        # Auth, DB session injection
│   ├── extractors/
│   │   ├── base.py                # Abstract extractor interface
│   │   ├── pdf.py                 # PDF extractor (pdfplumber + OCR)
│   │   ├── docx.py                # Word document extractor
│   │   ├── pptx.py                # PowerPoint extractor
│   │   ├── xlsx.py                # Excel/CSV extractor
│   │   ├── html.py                # HTML extractor
│   │   ├── markdown.py            # Markdown extractor
│   │   ├── code.py                # Code file extractor (tree-sitter)
│   │   ├── image.py               # Image extractor (OCR + vision)
│   │   └── registry.py            # Format → extractor mapping
│   ├── chunking/
│   │   ├── base.py                # Abstract chunker interface
│   │   ├── fixed.py               # Fixed-size token chunking
│   │   ├── semantic.py            # Structure-aware semantic chunking
│   │   ├── sliding.py             # Sliding window chunking
│   │   └── recursive.py           # Recursive structural chunking
│   ├── embedding/
│   │   ├── client.py              # LLM Gateway embedding client
│   │   └── batch.py               # Batch embedding with retry
│   ├── storage/
│   │   ├── postgres.py            # Chunk + document persistence
│   │   └── object_store.py        # Raw file storage (MinIO/S3)
│   ├── security/
│   │   ├── sanitize.py            # Macro/script stripping
│   │   ├── pii.py                 # PII detection and redaction
│   │   └── access.py              # Permission checks
│   ├── tasks/
│   │   └── process.py             # Celery task definitions
│   ├── config.py                  # Configuration from env vars
│   └── main.py                    # FastAPI app entrypoint
├── tests/
│   ├── test_extractors/           # Per-format extractor tests
│   ├── test_chunking/             # Chunking strategy tests
│   ├── test_api/                  # API integration tests
│   └── fixtures/                  # Sample documents for testing
├── pyproject.toml                 # uv/pip dependencies
├── Makefile                       # Build, test, dev commands
├── Dockerfile                     # Production container
└── compose.yml                    # Local development services
```

### Processing Flow (Detailed)

```python
# Simplified processing pipeline

async def process_document(document_id: str, file_path: str, config: ChunkConfig):
    # 1. Detect format
    detected_format = detect_format(file_path)

    # 2. Sanitize (strip macros, scripts, malicious content)
    sanitized_path = sanitize_document(file_path, detected_format)

    # 3. Extract content
    extractor = ExtractorRegistry.get(detected_format)
    extracted = await extractor.extract(sanitized_path)

    # 4. Detect and redact PII (if enabled)
    if config.pii_redaction:
        extracted = redact_pii(extracted)

    # 5. Chunk
    chunker = ChunkerRegistry.get(config.strategy)
    chunks = chunker.chunk(extracted, config)

    # 6. Embed (batched)
    embedded_chunks = await embed_chunks(chunks, batch_size=100)

    # 7. Store
    await store_chunks(document_id, embedded_chunks)
    await update_document_status(document_id, "completed")
```

### Configuration

All configuration is via environment variables:

```bash
# Core
DOCUMENT_API_PORT=8016
DOCUMENT_WORKERS=4

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/documents

# LLM Gateway (HIP-4)
LLM_GATEWAY_URL=http://localhost:4000
LLM_GATEWAY_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-large

# Object Storage
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=documents

# OCR
OCR_ENABLED=true
OCR_CONFIDENCE_THRESHOLD=0.7
VISION_MODEL=zen-vision-72b

# Processing
DEFAULT_CHUNK_STRATEGY=semantic
DEFAULT_MAX_TOKENS=512
DEFAULT_OVERLAP_TOKENS=64
MAX_FILE_SIZE_MB=100
MAX_BATCH_SIZE=50

# Security
PII_REDACTION_ENABLED=false
SANITIZE_MACROS=true

# Task Queue
REDIS_URL=redis://localhost:6379/0
CELERY_CONCURRENCY=4
```

## Security

### Document Sanitization

All uploaded documents are sanitized before parsing:

- **Office documents**: Macros (VBA) are stripped. External references and OLE objects are removed. Embedded scripts are neutralized.
- **HTML**: Script tags, event handlers, iframes, and external resource references are removed. Only safe HTML elements and attributes are preserved.
- **PDF**: JavaScript actions, launch actions, and embedded executables are stripped.
- **Images**: EXIF metadata is stripped (may contain GPS coordinates, device info). Steganographic payloads are not detected but are rendered harmless by re-encoding.

Sanitization happens BEFORE extraction to prevent parser exploits.

### PII Detection and Redaction

When enabled (`PII_REDACTION_ENABLED=true`), parsed content is scanned for personally identifiable information:

- **Patterns detected**: SSN, credit card numbers, email addresses, phone numbers, physical addresses, dates of birth, passport numbers, driver's license numbers.
- **Detection method**: Regex patterns for structured PII, plus NER (Named Entity Recognition) for names and organizations.
- **Redaction**: Detected PII is replaced with typed placeholders (`[SSN_REDACTED]`, `[EMAIL_REDACTED]`, `[NAME_REDACTED]`). The original content is never stored; only the redacted version persists.
- **Audit log**: Each redaction is logged with the PII type and character position (but not the redacted value) for compliance auditing.

### Access Control

Documents inherit the permissions of their parent project:

- **Read**: Users with project read access can search and retrieve chunks.
- **Write**: Users with project write access can upload and delete documents.
- **Admin**: Project admins can configure processing settings and view audit logs.

All API requests are authenticated via Bearer token validated against Hanzo IAM (hanzo.id). Project membership is checked on every request.

### Encryption

- **In transit**: All API traffic over HTTPS (TLS 1.3).
- **At rest**: Document files in object storage are encrypted with AES-256. Chunk content in PostgreSQL is encrypted at the tablespace level.
- **Embedding vectors**: Stored in plaintext (encrypted at tablespace level). Vectors alone do not reconstruct source text but may leak semantic information; access control is the primary protection.

### Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /parse` | 100 requests | per minute per project |
| `POST /batch` | 10 requests | per minute per project |
| `POST /search` | 1000 requests | per minute per project |
| `GET /chunks` | 500 requests | per minute per project |

Rate limits are enforced at the API gateway level. Exceeding limits returns HTTP 429 with a `Retry-After` header.

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "UNSUPPORTED_FORMAT",
    "message": "File format 'application/x-dosexec' is not supported",
    "details": {
      "detected_format": "application/x-dosexec",
      "supported_formats": ["pdf", "docx", "pptx", "xlsx", "html", "md", "txt", "png", "jpg"]
    }
  }
}
```

Error codes:

| Code | HTTP Status | Description |
|------|------------|-------------|
| `UNSUPPORTED_FORMAT` | 415 | File format not recognized or not supported |
| `FILE_TOO_LARGE` | 413 | File exceeds `MAX_FILE_SIZE_MB` |
| `EXTRACTION_FAILED` | 422 | Parser could not extract content (corrupted file) |
| `OCR_FAILED` | 422 | OCR failed and no text could be extracted |
| `EMBEDDING_FAILED` | 502 | LLM Gateway returned an error during embedding |
| `DOCUMENT_NOT_FOUND` | 404 | Document ID does not exist or is not accessible |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `BATCH_TOO_LARGE` | 400 | Batch upload exceeds `MAX_BATCH_SIZE` |

Failed documents remain in `failed` status with the error message stored in `documents.error_message`. They can be retried by re-uploading.

## Extensibility

### Custom Extractors

New format support is added by implementing the extractor interface and registering it:

```python
from src.extractors.base import BaseExtractor, ExtractedDocument

class CustomExtractor(BaseExtractor):
    """Extractor for a custom format."""

    supported_mimetypes = ["application/x-custom"]
    supported_extensions = [".custom"]

    async def extract(self, file_path: str) -> ExtractedDocument:
        # Format-specific extraction logic
        ...

# Register in src/extractors/registry.py
ExtractorRegistry.register(CustomExtractor)
```

### Custom Chunking Strategies

Similarly, custom chunking strategies implement the chunker interface:

```python
from src.chunking.base import BaseChunker

class CustomChunker(BaseChunker):
    name = "custom"

    def chunk(self, document: ExtractedDocument, config: ChunkConfig) -> list[Chunk]:
        # Custom chunking logic
        ...
```

## Testing

### Test Matrix

| Test Category | Count | Framework | Fixtures |
|--------------|-------|-----------|----------|
| Extractor unit tests | ~60 | pytest | Sample docs per format |
| Chunking unit tests | ~40 | pytest | Synthetic documents |
| API integration tests | ~30 | pytest + httpx | Full pipeline |
| OCR accuracy tests | ~20 | pytest | Scanned document samples |
| Security tests | ~15 | pytest | Malicious document samples |

### Running Tests

```bash
# All tests
make test

# Specific category
uv run pytest tests/test_extractors/ -v
uv run pytest tests/test_chunking/ -v
uv run pytest tests/test_api/ -v

# With coverage
uv run pytest --cov=src --cov-report=html
```

### Quality Metrics

- **Extraction accuracy**: Measured against ground-truth annotated documents. Target: >95% character accuracy for text-based documents, >85% for scanned documents.
- **Chunking quality**: Measured by semantic coherence score (embedding similarity within chunks vs. across chunks). Target: intra-chunk similarity >0.8, inter-chunk similarity <0.4.
- **Retrieval relevance**: Measured by MRR@10 (Mean Reciprocal Rank) on a curated Q&A benchmark. Target: MRR@10 >0.7.

## Integration with Hanzo Ecosystem

### LLM Gateway (HIP-4)

Document processing uses the LLM Gateway for two operations:

1. **Embedding**: All chunk embeddings are computed via `POST /v1/embeddings` on the gateway. This ensures consistent model selection and API key management across the ecosystem.
2. **Vision model fallback**: Low-confidence OCR pages are sent to the gateway's vision endpoint for re-extraction.

### Vector Store (HIP-29)

Chunk embeddings are stored in pgvector. The search endpoint performs cosine similarity queries against this store. Index tuning (IVFFlat list count, HNSW parameters) follows HIP-29 guidelines.

### Hanzo Chat / Agent

Chat and agent services call the search endpoint to retrieve relevant document chunks as context for RAG. The standard chunk format ensures that any Hanzo service can consume document context without format conversion.

### Hanzo Cloud

Document processing runs as a managed service on Hanzo Cloud. Projects can enable document ingestion in their Cloud dashboard, which provisions the processing pipeline and vector storage automatically.

## Migration and Versioning

### API Versioning

The API is versioned via URL path (`/api/v1/`). Breaking changes increment the version. Non-breaking additions (new optional fields, new endpoints) do not.

### Schema Migrations

Database schema changes are managed via Alembic. Each migration is reversible. The `embedding` column dimension is fixed at 3072 for v1; changing the embedding model requires a v2 migration that re-embeds all existing chunks.

## Reference Implementation

**Repository**: [hanzoai/documents](https://github.com/hanzoai/documents)

**Quick Start**:
```bash
git clone https://github.com/hanzoai/documents
cd documents
make setup    # Install dependencies, start Postgres + Redis + MinIO
make dev      # Start API server on port 8016
```

**Key Commands**:
```bash
make test     # Run all tests
make lint     # Ruff linting
make format   # Ruff formatting
make migrate  # Run database migrations
make docker   # Build production Docker image
```

## References

1. [HIP-4: LLM Gateway](./hip-0004-llm-gateway.md) - Unified LLM proxy for embeddings and vision models
2. [HIP-29: Vector Store Standard](./hip-0029-vector-store-standard.md) - pgvector storage and retrieval
3. [unstructured.io](https://unstructured.io/) - Inspiration for format-agnostic extraction
4. [pdfplumber](https://github.com/jsvine/pdfplumber) - PDF text and table extraction
5. [tree-sitter](https://tree-sitter.github.io/) - AST-based code parsing
6. [tiktoken](https://github.com/openai/tiktoken) - Token counting for OpenAI models

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
