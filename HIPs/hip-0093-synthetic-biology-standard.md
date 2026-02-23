---
hip: 0093
title: Synthetic Biology & DNA Data Storage Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
---

# HIP-0093: Synthetic Biology & DNA Data Storage Standard

## Abstract

This proposal defines the Synthetic Biology standard for AI-driven genetic circuit design and DNA-based data storage in the Hanzo ecosystem. Hanzo SynBio provides two capabilities that converge in a single system: (1) encoding arbitrary digital data into DNA sequences for ultra-dense, ultra-durable archival storage, and (2) using large language models to design synthetic biological circuits -- gene regulatory networks, protein sequences, and metabolic pathways -- that would be intractable to design by hand.

DNA stores information at 215 petabytes per gram and remains readable after hundreds of thousands of years without energy input. No other storage medium approaches this density or durability. For cold archival of AI training datasets, model checkpoints, and institutional knowledge, DNA is not a novelty -- it is the only technology that can store exabyte-scale data in a shoebox for geological time.

The design space of synthetic biology is astronomically large. A modest genetic circuit of 10 genes, each with 5 possible promoter strengths and 3 possible ribosome binding sites, has 15^10 (approximately 576 billion) configurations. No human can search this space. Language models trained on genomic data can propose circuits, predict their behavior, and iterate toward functional designs in hours rather than years.

**Repository**: [github.com/hanzoai/synbio](https://github.com/hanzoai/synbio)
**Port**: 8093 (API)
**Binary**: `hanzo-synbio`
**Container**: `hanzoai/synbio:latest`

## Motivation

Hanzo manages petabytes of data: training corpora, model weights, conversation logs, embeddings, and audit trails. Current storage tiers -- SSD, HDD, tape -- degrade. Magnetic tape loses data after 15-30 years. Hard drives fail after 5-10 years. Even optical media degrades within decades. Organizations that need data for longer than a human career have no good option today.

Meanwhile, Hanzo's AI infrastructure already processes biological sequences. The Zen model family understands protein structure, genomic syntax, and molecular interactions. This capability is underutilized if it only serves bioinformatics queries. It can be directed toward *designing* biology -- creating synthetic organisms that produce valuable compounds, detect environmental toxins, or compute biological functions.

These two problems -- durable storage and biological design -- share infrastructure:

1. **DNA synthesis** is required for both writing data-storage DNA and building synthetic gene circuits.
2. **DNA sequencing** is required for both reading stored data and verifying that synthetic constructs were assembled correctly.
3. **Sequence design algorithms** are required for both optimizing data-encoding sequences (error correction, GC balance, no homopolymers) and optimizing gene expression (codon usage, mRNA secondary structure, promoter strength).
4. **AI models** are required for both predicting how encoded DNA will behave during synthesis/sequencing and predicting how synthetic circuits will behave in living cells.

Building one system that serves both use cases is cheaper and more coherent than building two.

### Why Hanzo Cares

Three strategic reasons:

**Cold archival for AI training data.** Training a frontier model requires 10-50 TB of curated data. Retraining requires access to the same data years later. Regulatory and reproducibility requirements may demand that training data be preserved for decades. DNA archival provides a write-once, read-occasionally tier that costs nothing to maintain after initial synthesis and can survive without power, cooling, or institutional continuity.

**Biocomputing as post-silicon compute.** Moore's Law is ending. Transistor density improvements have slowed from 2x every 18 months to 2x every 5-7 years. Biological systems compute at room temperature, self-replicate, and operate at molecular scale. DNA-based logic gates, genetic neural networks, and enzymatic computation are not science fiction -- they are published, peer-reviewed systems. They are slow today (hours, not nanoseconds), but for certain problems (molecular sensing, in-vivo diagnostics, environmental monitoring) they are the only viable compute substrate.

**AI-designed biology is the next industrial revolution.** The ability to design organisms that produce fuel, food, medicine, and materials from simple feedstocks will reshape every industry. Hanzo's AI models, trained on genomic and proteomic data, are positioned to be the design tool for this revolution. The SynBio standard makes this capability accessible through a standard API rather than locked in a research lab.

## Background: Molecular Biology for Engineers

This section explains the minimum biology required to understand the rest of this document. If you know what a codon is, skip ahead.

### DNA: The Data Structure

DNA (deoxyribonucleic acid) is a polymer -- a long chain of repeating units. Each unit is a **nucleotide**, and each nucleotide contains one of four **bases**: adenine (A), thymine (T), guanine (G), and cytosine (C). A DNA molecule is a sequence of these bases, written as a string: `ATGCGATTACG...`.

Two DNA strands bind together in antiparallel orientation, with A always pairing with T, and G always pairing with C. This is **base pairing**, and it is why DNA forms the famous double helix. The pairing is driven by hydrogen bonds: A-T has two hydrogen bonds, G-C has three (making G-C pairs slightly stronger).

For data storage purposes, DNA is a quaternary (base-4) storage medium. Each nucleotide encodes 2 bits of information (log2(4) = 2). A single strand of 100 nucleotides encodes 200 bits, or 25 bytes. The theoretical maximum information density is 455 exabytes per gram of single-stranded DNA. Practical systems achieve about 215 petabytes per gram after accounting for redundancy and error correction.

For comparison:

| Medium | Density | Durability | Energy to Maintain |
|--------|---------|------------|--------------------|
| SSD | ~2 TB per kg | 5-10 years | Continuous power |
| HDD | ~5 TB per kg | 5-10 years | Continuous power |
| LTO Tape | ~20 TB per kg | 15-30 years | Climate control |
| Optical Disc | ~50 GB per disc | 50-100 years | None |
| DNA | ~215 PB per gram | 500,000+ years | None (if dry, cool, dark) |

DNA recovered from permafrost has been sequenced after 700,000 years. Room-temperature DNA in silica encapsulation remains readable after thousands of years. No electronic storage medium will exist in its current form in 100 years, let alone 100,000.

### From DNA to Protein: The Central Dogma

In living cells, DNA serves as a blueprint. The process of reading that blueprint has two steps:

1. **Transcription**: An enzyme called RNA polymerase reads a DNA sequence and produces a complementary RNA copy (messenger RNA, or mRNA). RNA uses uracil (U) instead of thymine (T), but is otherwise similar to DNA.

2. **Translation**: A molecular machine called the **ribosome** reads the mRNA three bases at a time. Each triplet of bases is a **codon**, and each codon specifies one of 20 amino acids (or a stop signal). The ribosome assembles amino acids into a chain, which folds into a functional **protein**.

The genetic code -- the mapping from codons to amino acids -- is nearly universal across all life. There are 64 possible codons (4^3) but only 20 amino acids plus the stop signal, so the code is **degenerate**: multiple codons encode the same amino acid. For example, GCU, GCC, GCA, and GCG all encode alanine.

This degeneracy matters for synthetic biology. An engineer can choose which synonym codon to use for each amino acid, optimizing for the expression machinery of the target organism. This is **codon optimization**, and it is one of the key tasks that AI excels at.

### Gene Regulation: The Control Flow

A **gene** is a stretch of DNA that encodes a protein (or functional RNA). But genes are not always active. Cells regulate which genes are expressed, when, and how strongly. The key regulatory elements are:

- **Promoter**: A DNA sequence upstream of a gene where RNA polymerase binds to begin transcription. Strong promoters produce lots of mRNA; weak promoters produce little. Promoters can be **constitutive** (always on) or **inducible** (activated by a specific signal).

- **Ribosome Binding Site (RBS)**: A sequence on the mRNA that the ribosome recognizes. The strength of the RBS determines how efficiently the mRNA is translated into protein. A strong RBS means more protein per mRNA molecule.

- **Terminator**: A sequence that signals RNA polymerase to stop transcription. Without it, transcription runs into the next gene.

- **Operator**: A sequence where a **repressor** protein binds to block transcription. This is how genes are turned off.

- **Transcription Factor Binding Site**: A sequence where an **activator** protein binds to enhance transcription. This is how genes are turned on in response to signals.

A **genetic circuit** is an arrangement of genes and regulatory elements that performs a logical function. For example, a genetic AND gate: Gene C is expressed only when both Protein A and Protein B are present, because Gene C's promoter requires both transcription factors. Researchers have built genetic oscillators, toggle switches, counters, and even simple neural networks from these parts.

### SBOL: The Schematic Language

Just as electronic engineers use schematic diagrams and netlists, synthetic biologists use **SBOL** (Synthetic Biology Open Language) to describe genetic designs. SBOL is an open standard (sbolstandard.org) that provides:

- **Visual symbols**: Standardized glyphs for promoters, coding sequences, terminators, ribosome binding sites, and other genetic parts. A promoter is a right-angled arrow; a coding sequence is a wide arrow; a terminator is a T-shape.

- **Data model**: An RDF-based data format for machine-readable descriptions of genetic designs. Each part has a type, sequence, role, and can be composed into hierarchical designs.

- **Part libraries**: Repositories of characterized genetic parts (like the iGEM Registry of Standard Biological Parts) that publish SBOL descriptions.

Hanzo SynBio uses SBOL 3 as its native design interchange format. Every genetic design produced by the system is exportable as SBOL, and every SBOL design can be imported for simulation or optimization.

## Design Philosophy

### DNA Storage: Write Rarely, Read Rarely, Keep Forever

DNA storage is not a replacement for SSDs or even tape. It is a tier below tape -- the coldest possible storage, for data that must survive but is accessed infrequently. The access pattern is:

- **Write**: Encode data, synthesize DNA, store in tube. Cost: $1,000-$10,000 per GB today, projected $1-$10 per GB by 2030.
- **Store**: Place sealed tube on shelf. Cost: essentially zero. No power, no cooling, no hardware refresh, no migration.
- **Read**: Sequence DNA, decode data. Cost: $100-$1,000 per GB today, falling with sequencing improvements.

The economics make sense when the alternative is maintaining storage infrastructure for decades. A data center that stores 1 PB on tape for 50 years spends millions on tape replacements, climate control, power, and migration to new formats. DNA storage of the same data costs more upfront but nothing thereafter.

The target use cases for Hanzo:
- Regulatory archives (training data provenance, audit logs)
- Model checkpoint cold archival (store every major checkpoint permanently)
- Cultural preservation (institutional knowledge, research data)
- Cryptographic key escrow (private keys stored in DNA, sealed in multiple geographic locations)

### AI for Genetic Design: Explore the Impossible Space

The combinatorial explosion of genetic circuit design is well beyond human capacity. Consider designing a biosensor -- a cell that glows green when it detects arsenic in water:

1. Choose a promoter that responds to arsenic. There are ~50 known arsenic-responsive promoters with varying sensitivities.
2. Choose an RBS to tune expression level. There are ~10,000 characterized RBS sequences with different translation initiation rates.
3. Choose a reporter gene (GFP variant). There are ~200 fluorescent proteins with different brightness, maturation time, and spectral properties.
4. Choose a terminator. There are ~500 characterized terminators with different efficiency.
5. Decide whether to add a signal amplification cascade. If yes, repeat steps 1-4 for each additional gene.

Even this simple design has 50 x 10,000 x 200 x 500 = 50 billion single-gene configurations. Adding a two-gene amplification cascade squares the space. No human designer can evaluate these options. They pick familiar parts, guided by intuition and literature precedent, and test a handful of constructs in the lab.

An AI model can:
- Predict promoter-RBS-gene interactions from sequence alone.
- Score candidate designs by predicted expression level, metabolic burden, and genetic stability.
- Propose novel regulatory architectures that a human would not consider.
- Iterate on failed designs by analyzing why they failed (e.g., mRNA secondary structure occluding the RBS).

The Zen model family, when fine-tuned on genomic and synthetic biology datasets (GenBank, iGEM Registry, AddGene, UniProt), produces genetic circuit designs that outperform human-designed circuits in simulation benchmarks. This is the same pattern as AI-generated code outperforming human-written code: the design space is too large for intuition, and AI excels at search.

### Biosecurity: The Dual-Use Imperative

Synthetic biology has dual-use potential. The same tools that design a biosensor for arsenic can, in principle, design a pathogen. This is not hypothetical -- it is the central concern of the biosecurity community, and Hanzo takes it seriously.

Every sequence designed or processed by Hanzo SynBio is screened against:

1. **Controlled pathogen databases**: BSAT (Biological Select Agents and Toxins), Australia Group list, CWC Schedules.
2. **Virulence factor databases**: VFDB, PATRIC.
3. **Toxin sequences**: Known protein toxin families.
4. **Regulated sequences**: Export-controlled genetic elements.

Screening is mandatory and cannot be bypassed by API callers. Sequences that match controlled organisms or virulence factors above a configurable similarity threshold (default: 80% nucleotide identity over 200bp) are rejected with a `403 BIOSECURITY_REVIEW_REQUIRED` response. Flagged requests are logged to an immutable audit trail (HIP-0030) and can be escalated for human review.

The screening pipeline runs locally -- sequences are never sent to external services for screening. The pathogen database is updated monthly from public sources and stored in Hanzo Object Storage (HIP-0032).

This approach follows the IGSC (International Gene Synthesis Consortium) Harmonized Screening Protocol, which is the industry standard for DNA synthesis providers.

## Specification

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Hanzo SynBio Service                        │
│                        Port 8093                                │
├─────────────────┬──────────────────┬────────────────────────────┤
│   DNA Storage   │  Circuit Design  │   Biosecurity Screening    │
│   Engine        │  Engine          │   Engine                   │
├─────────────────┼──────────────────┼────────────────────────────┤
│  Encode/Decode  │  LLM-based       │  BLAST against             │
│  Synthesize     │  design          │  pathogen DBs              │
│  Sequence       │  Simulation      │  Virulence factor          │
│  Error correct  │  Optimization    │  detection                 │
│                 │  SBOL export     │  Audit logging             │
├─────────────────┴──────────────────┴────────────────────────────┤
│              Shared Infrastructure                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ HIP-0029 │  │ HIP-0032 │  │ HIP-0030 │  │ HIP-0039     │    │
│  │ Postgres │  │ Object   │  │ Event    │  │ Zen Models   │    │
│  │ Metadata │  │ Storage  │  │ Stream   │  │ Inference    │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
   ┌────────────┐  ┌────────────┐  ┌────────────────────┐
   │ HIP-0091   │  │ HIP-0070   │  │ External Services  │
   │ Genomics   │  │ Quantum    │  │ DNA Synthesis      │
   │ Sequencing │  │ Molecular  │  │ DNA Sequencing     │
   │ Pipeline   │  │ Simulation │  │ Lab Automation     │
   └────────────┘  └────────────┘  └────────────────────┘
```

### DNA Data Storage

#### Encoding Pipeline

The encoding pipeline converts arbitrary binary data into synthesizable DNA sequences. The pipeline has five stages:

**Stage 1: Chunking.** Input data is split into fixed-size blocks (default: 32 bytes). Each block will become one DNA oligo (short DNA strand). Smaller blocks mean shorter oligos (easier and cheaper to synthesize) but more oligos per file (higher overhead). The default of 32 bytes produces ~150-nucleotide oligos after encoding and error correction, which is within the reliable synthesis length for current technology.

**Stage 2: Error-Correcting Code.** Each block is encoded with Reed-Solomon error correction. The default configuration uses RS(255, 223) -- 223 data bytes padded/interleaved from the 32-byte blocks, with 32 parity bytes, correcting up to 16 symbol errors per codeword. This handles the dominant error modes in DNA storage: single-nucleotide substitutions (from synthesis errors), deletions (from sequencing errors), and oligo dropout (from uneven PCR amplification).

**Stage 3: Binary-to-Quaternary Encoding.** The error-corrected binary data is converted to a quaternary (base-4) sequence using one of the supported encoding schemes:

| Scheme | Bits/nt | Constraints | Use Case |
|--------|---------|-------------|----------|
| **Goldman** | 1.58 | No homopolymer runs >1 | Maximum synthesis reliability |
| **DNA Fountain** | 1.98 | Luby Transform + screening | Maximum density, random access |
| **Church** | 1.0 | Simple binary mapping | Reference implementation |
| **Hanzo Balanced** | 1.85 | GC 40-60%, no runs >3 | Default, balanced tradeoff |

The **Hanzo Balanced** encoding is the default. It uses a rotating base mapping (inspired by Goldman coding) combined with a constrained channel code that guarantees:
- GC content between 40% and 60% (prevents synthesis bias)
- No homopolymer runs longer than 3 (prevents sequencing errors)
- No exact matches to common restriction enzyme sites (prevents accidental cleavage)
- Unique 20-nt address prefix per oligo (enables random access via PCR)

**Stage 4: Oligo Assembly.** Each encoded sequence is flanked with:
- A 20-nucleotide **address/index** prefix (unique per oligo, enables random access)
- A 20-nucleotide **primer binding site** on each end (enables PCR amplification for retrieval)
- A 4-nucleotide **orientation marker** (distinguishes forward from reverse complement)

The complete oligo structure:

```
[FWD_PRIMER:20nt][ADDR:20nt][ORIENT:4nt][PAYLOAD:~100nt][REV_PRIMER:20nt]
```

**Stage 5: Redundancy and Fountain Coding.** To protect against oligo dropout (some oligos fail to synthesize or are lost during storage), the complete set of oligos is expanded using a Luby Transform fountain code. The default redundancy factor is 2x -- twice as many oligos as strictly necessary are synthesized, so the data can be recovered even if half the oligos are lost. This is configurable: higher redundancy for more critical data, lower for cost optimization.

#### Decoding Pipeline

Decoding reverses the encoding process:

1. **Sequence**: DNA is sequenced using nanopore (Oxford Nanopore) or short-read (Illumina) sequencing. The system accepts FASTQ files as input.
2. **Cluster**: Reads are clustered by address prefix. Each cluster corresponds to one original oligo. Consensus sequences are computed per cluster to correct sequencing errors.
3. **Decode**: Consensus sequences are decoded from quaternary back to binary.
4. **Error Correct**: Reed-Solomon decoding corrects any remaining errors and detects uncorrectable corruption.
5. **Reassemble**: Decoded blocks are reassembled in order using address indices to produce the original file.

The decoding pipeline integrates with HIP-0091 (Genomics) for sequencing data input and basecalling.

#### Storage API

```
POST   /v1/dna/encode          # Encode data to DNA sequences
POST   /v1/dna/decode          # Decode DNA sequences to data
GET    /v1/dna/jobs/{id}       # Check encoding/decoding job status
POST   /v1/dna/synthesize      # Submit sequences for DNA synthesis
POST   /v1/dna/sequence        # Submit DNA sample for sequencing
GET    /v1/dna/archives        # List DNA archives
GET    /v1/dna/archives/{id}   # Get archive metadata
DELETE /v1/dna/archives/{id}   # Mark archive for destruction
```

Encode request:

```json
{
  "source": "s3://hanzo-data/training-corpus-v3.tar.zst",
  "encoding": "hanzo_balanced",
  "redundancy": 2.0,
  "error_correction": "reed_solomon_255_223",
  "metadata": {
    "description": "Training corpus v3, compressed with zstd",
    "retention_years": 1000,
    "classification": "internal"
  }
}
```

Encode response:

```json
{
  "job_id": "dna-enc-20260223-001",
  "status": "encoding",
  "input_size_bytes": 52428800000,
  "estimated_oligos": 1200000000,
  "estimated_dna_grams": 0.00024,
  "estimated_cost_usd": 12500.00,
  "encoding": "hanzo_balanced",
  "bits_per_nucleotide": 1.85,
  "physical_density": "215 PB/g"
}
```

#### Integration with HIP-0032 (Object Storage)

DNA storage appears as a storage tier within the Hanzo Object Storage system. Objects can be assigned a lifecycle policy that migrates them to DNA archival after a configurable period:

```yaml
lifecycle:
  rules:
    - id: dna-archive-after-5-years
      filter:
        prefix: "checkpoints/"
      transitions:
        - days: 1825
          storage_class: DNA_ARCHIVAL
      expiration:
        days: 36500  # 100 years minimum retention
```

The `DNA_ARCHIVAL` storage class triggers the encoding pipeline, submits sequences for synthesis, and records the physical location of the DNA tube in metadata. Retrieval from DNA tier requires an explicit restore request (similar to S3 Glacier), with an estimated retrieval time of 24-72 hours depending on sequencing turnaround.

### Genetic Circuit Design

#### LLM-Based Design Pipeline

The circuit design engine uses Zen models fine-tuned on synthetic biology data to generate, evaluate, and optimize genetic circuit designs. The pipeline has four phases:

**Phase 1: Specification.** The user provides a natural-language description of the desired circuit behavior, along with optional constraints:

```json
{
  "description": "A genetic toggle switch in E. coli that switches between two stable states (high GFP / low RFP, or low GFP / high RFP) in response to IPTG and aTc inducers.",
  "organism": "escherichia_coli_k12",
  "constraints": {
    "max_genes": 6,
    "max_plasmid_size_bp": 10000,
    "antibiotic_resistance": "ampicillin",
    "growth_temperature_c": 37,
    "part_registry": "igem"
  }
}
```

**Phase 2: Design Generation.** The Zen model generates candidate circuit architectures. Each candidate includes:
- Gene arrangement and regulatory topology
- Specific genetic parts (promoters, RBS, CDSs, terminators) selected from the specified part registry
- Predicted expression levels for each gene under each input condition
- DNA sequence for the complete construct

The model generates 10-50 candidates per specification, ranked by predicted performance.

**Phase 3: Simulation.** Each candidate is simulated using ordinary differential equation (ODE) models of gene expression. The simulation predicts:
- Steady-state protein concentrations under each input condition
- Dynamic response (switching time, oscillation period)
- Metabolic burden on the host cell
- Genetic stability (probability of mutation disrupting function over N generations)

Simulation uses the SBML (Systems Biology Markup Language) standard internally. For computationally expensive simulations (large circuits, stochastic models), the system can offload to HIP-0070 (Quantum) for quantum-enhanced molecular dynamics.

**Phase 4: Optimization.** The top candidates from simulation are refined through an iterative loop:

1. Analyze failure modes (why did some candidates score poorly?)
2. Propose sequence-level modifications (stronger RBS, different codon usage, insulator sequences)
3. Re-simulate modified candidates
4. Repeat until convergence or iteration budget is exhausted

The output is a ranked list of optimized designs, each with a complete DNA sequence, SBOL description, predicted performance metrics, and a confidence score.

#### Codon Optimization

Codon optimization is a sub-problem that deserves special attention. Given a protein sequence (amino acids), there are astronomically many DNA sequences that encode it (due to codon degeneracy). The choice of codons affects:

- **Translation efficiency**: Codons that match abundant tRNAs in the host organism are translated faster.
- **mRNA stability**: Some codon sequences create secondary structures that stall the ribosome.
- **Expression level**: Codon usage correlates with protein expression level in ways that are partially understood.
- **Synthesis feasibility**: Some codon choices create GC-rich regions or homopolymers that are difficult to synthesize.

The Zen model performs multi-objective codon optimization that balances all four concerns simultaneously. It outperforms traditional CAI (Codon Adaptation Index) optimization because it considers mRNA secondary structure and synthesis constraints, which CAI ignores.

```
POST /v1/design/codon-optimize
```

```json
{
  "protein_sequence": "MSKGEELFTGVVPILVELDGDVNGHKFSVRGEGEGDATIGKLTLKFI",
  "organism": "escherichia_coli_k12",
  "objectives": {
    "expression_level": 0.4,
    "synthesis_feasibility": 0.3,
    "mrna_stability": 0.2,
    "genetic_stability": 0.1
  }
}
```

#### SBOL Compliance

All genetic designs are natively represented in SBOL 3 (Synthetic Biology Open Language). The system:

- Imports SBOL 3 designs from any compliant tool (Benchling, SnapGene, SBOL Designer)
- Exports every design as SBOL 3 with full annotation
- Maintains a local SBOL part library synchronized with the iGEM Registry and AddGene
- Validates designs against SBOL 3 schema before export
- Preserves SBOL provenance metadata through the design-simulate-optimize pipeline

```
POST   /v1/design/import/sbol     # Import SBOL design
GET    /v1/design/{id}/sbol       # Export design as SBOL
GET    /v1/parts                   # Browse part library
GET    /v1/parts/{id}              # Get part details and sequence
POST   /v1/parts/search            # Search parts by function/organism
```

#### Design API

```
POST   /v1/design/circuit          # Design a genetic circuit from spec
POST   /v1/design/codon-optimize   # Optimize codons for expression
POST   /v1/design/protein          # Design protein with target function
POST   /v1/design/pathway          # Design metabolic pathway
POST   /v1/design/simulate         # Simulate circuit behavior
GET    /v1/design/jobs/{id}        # Check design job status
GET    /v1/design/jobs/{id}/result # Get design results
POST   /v1/design/validate         # Validate design for synthesis
```

### Biosecurity Screening

#### Screening Pipeline

Every sequence that enters the system -- whether uploaded by a user, generated by the design engine, or imported from SBOL -- passes through the biosecurity screening pipeline before any further processing.

```
Input Sequence
      │
      ▼
┌─────────────┐    ┌──────────────────────┐
│  BLAST      │───▶│ Controlled Pathogen  │──▶ MATCH ──▶ REJECT + AUDIT
│  Screening  │    │ Database (BSAT,      │
│             │    │ Australia Group)      │
└─────────────┘    └──────────────────────┘
      │ NO MATCH
      ▼
┌─────────────┐    ┌──────────────────────┐
│  HMM        │───▶│ Virulence Factor     │──▶ MATCH ──▶ REJECT + AUDIT
│  Screening  │    │ Database (VFDB,      │
│             │    │ PATRIC)              │
└─────────────┘    └──────────────────────┘
      │ NO MATCH
      ▼
┌─────────────┐    ┌──────────────────────┐
│  Toxin      │───▶│ Known Toxin Protein  │──▶ MATCH ──▶ REJECT + AUDIT
│  Detection  │    │ Families             │
└─────────────┘    └──────────────────────┘
      │ NO MATCH
      ▼
   APPROVED ──▶ Proceed with processing
```

Screening parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `nucleotide_identity_threshold` | 0.80 | Minimum BLAST identity to flag |
| `alignment_length_threshold` | 200 | Minimum alignment length (bp) to flag |
| `hmm_evalue_threshold` | 1e-10 | Maximum HMM E-value to flag |
| `toxin_similarity_threshold` | 0.70 | Minimum protein similarity to flag |
| `screening_mode` | `strict` | `strict` rejects on any flag; `review` flags for human review |

#### Audit Trail

All screening events are published to HIP-0030 (Event Stream) on the `synbio.biosecurity` topic:

```json
{
  "event_type": "biosecurity_screen",
  "timestamp": "2026-02-23T14:30:00Z",
  "sequence_hash": "sha256:abc123...",
  "sequence_length_bp": 5000,
  "source": "design_engine",
  "result": "approved",
  "screens_passed": ["blast_pathogen", "hmm_virulence", "toxin_detection"],
  "processing_time_ms": 1250,
  "user_id": "user_xyz",
  "request_id": "req_abc"
}
```

Rejected sequences include additional detail:

```json
{
  "result": "rejected",
  "rejection_reason": "blast_pathogen_match",
  "matched_organism": "Bacillus anthracis",
  "match_identity": 0.94,
  "match_alignment_length": 1200,
  "matched_region": "protective antigen gene (pagA)",
  "regulation": "BSAT Select Agent, 42 CFR Part 73"
}
```

### Cross-HIP Integration

#### HIP-0032 (Object Storage)

- DNA archives are tracked as objects in the `dna-archives` bucket
- Lifecycle policies can transition objects to `DNA_ARCHIVAL` class
- Archive metadata includes physical tube location, encoding parameters, and synthesis provider
- Retrieval triggers sequencing and decoding pipeline

#### HIP-0091 (Genomics)

- Sequencing data from DNA archives flows through the Genomics pipeline for basecalling and quality filtering
- Genomic reference databases used in circuit design are managed by the Genomics service
- Shared sequence analysis utilities (BLAST, alignment) run on the Genomics compute cluster

#### HIP-0070 (Quantum Computing)

- Protein folding prediction for designed proteins can be offloaded to quantum molecular simulation
- Molecular dynamics simulation of DNA-protein interactions benefits from quantum speedup
- Quantum random number generation for fountain code seed selection (provably random encoding)

#### HIP-0039 (Zen Models)

- Circuit design uses Zen models fine-tuned on synthetic biology corpora
- Protein design uses Zen models fine-tuned on UniProt and PDB structural data
- Codon optimization uses Zen sequence models trained on organism-specific expression data

## Cost Analysis and Trajectory

DNA storage is expensive today but on a steep cost curve.

### DNA Synthesis Cost

| Year | Cost per Base | Cost per GB (encoded) | Notes |
|------|---------------|----------------------|-------|
| 2010 | $0.30 | $1,200,000,000 | Manual oligo synthesis |
| 2015 | $0.10 | $400,000,000 | Column-based synthesis |
| 2020 | $0.05 | $200,000,000 | Enzymatic synthesis emerging |
| 2025 | $0.01 | $40,000,000 | Enzymatic and array-based |
| 2026 | $0.005 | $20,000,000 | Current state |
| 2030 | $0.0001 | $400,000 | Projected (enzymatic at scale) |
| 2035 | $0.00001 | $40,000 | Projected (molecular assembly) |

### DNA Sequencing Cost

| Year | Cost per GB (raw reads) | Notes |
|------|------------------------|-------|
| 2010 | $10,000 | Illumina HiSeq |
| 2015 | $1,000 | Illumina NextSeq |
| 2020 | $100 | Nanopore, Illumina NovaSeq |
| 2025 | $10 | Nanopore at scale |
| 2026 | $5 | Current state |
| 2030 | $0.50 | Projected |

### Break-Even Analysis

DNA storage becomes cost-competitive with tape for data that must be retained for more than N years:

```
DNA upfront cost + DNA retrieval cost < Tape annual cost x N years

At 2026 prices:  N > 200 years (not yet competitive for most use cases)
At 2030 prices:  N > 20 years (competitive for regulatory archives)
At 2035 prices:  N > 3 years (competitive for cold storage generally)
```

Hanzo invests now because:
1. The technology requires years of engineering integration to be production-ready.
2. Early encoding standards that gain adoption become the de facto standard.
3. Some Hanzo customers (governments, research institutions) already have 100+ year retention requirements.

## Configuration

### Service Configuration

```yaml
# synbio.yaml
service:
  port: 8093
  host: 0.0.0.0
  workers: 4

database:
  url: "${DATABASE_URL}"  # HIP-0029 PostgreSQL

storage:
  backend: "hip-0032"
  bucket: "synbio-data"

inference:
  endpoint: "http://localhost:8043"  # HIP-0043 Inference Engine
  model: "zen-72b-synbio"           # Fine-tuned for synbio

biosecurity:
  screening_mode: "strict"
  pathogen_db_path: "s3://synbio-data/databases/pathogen/"
  virulence_db_path: "s3://synbio-data/databases/virulence/"
  toxin_db_path: "s3://synbio-data/databases/toxin/"
  update_schedule: "0 0 1 * *"  # Monthly update

dna_storage:
  default_encoding: "hanzo_balanced"
  default_redundancy: 2.0
  default_error_correction: "reed_solomon_255_223"
  max_oligo_length_nt: 200
  min_gc_content: 0.40
  max_gc_content: 0.60
  max_homopolymer_length: 3

circuit_design:
  max_candidates: 50
  max_optimization_iterations: 100
  simulation_timeout_seconds: 300
  sbol_version: "3.1.0"
  default_part_registry: "igem"
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SYNBIO_STORAGE_BUCKET` | Yes | Object storage bucket for data |
| `SYNBIO_INFERENCE_ENDPOINT` | Yes | Zen model inference endpoint |
| `SYNBIO_INFERENCE_MODEL` | No | Model name (default: zen-72b-synbio) |
| `SYNBIO_SCREENING_MODE` | No | `strict` or `review` (default: strict) |
| `SYNBIO_PORT` | No | API port (default: 8093) |

## Security Considerations

1. **Biosecurity screening is not optional.** The API does not expose a bypass flag. Screening runs in the critical path for all sequence operations. An operator cannot disable it through configuration -- the screening engine must be running and the pathogen database must be loaded for the service to start.

2. **Sequence data is sensitive.** Genetic designs may represent proprietary intellectual property or pre-publication research. All sequences are encrypted at rest (AES-256) and in transit (TLS 1.3). Access is governed by Hanzo IAM (hanzo.id) with per-project granularity.

3. **Audit trail is immutable.** Biosecurity screening events are written to an append-only event stream (HIP-0030). Events cannot be deleted or modified. The audit trail satisfies IGSC reporting requirements and can be exported for regulatory inspection.

4. **Physical DNA security.** DNA tubes containing archived data should be stored in access-controlled facilities. The system tracks tube locations in metadata but does not enforce physical security -- that is an operational concern outside software scope. Metadata includes recommended storage conditions (temperature, humidity, light exposure).

5. **Synthesis provider vetting.** The system integrates with DNA synthesis providers (Twist Bioscience, IDT, GenScript) via API. Only providers that comply with IGSC screening protocols are supported. The system verifies provider compliance before submitting synthesis orders.

## Testing

### Unit Tests

```bash
# Run all tests
go test -v ./...

# DNA encoding/decoding round-trip
go test -v ./pkg/encoding/ -run TestRoundTrip

# Biosecurity screening
go test -v ./pkg/screening/ -run TestPathogenDetection

# SBOL import/export
go test -v ./pkg/sbol/ -run TestSBOLRoundTrip
```

### Integration Tests

```bash
# Requires running PostgreSQL and Object Storage
go test -v ./integration/ -tags=integration

# DNA storage end-to-end (encode → store → retrieve → decode)
go test -v ./integration/ -run TestDNAStorageE2E -tags=integration

# Circuit design end-to-end (spec → design → simulate → export)
go test -v ./integration/ -run TestCircuitDesignE2E -tags=integration
```

### Biosecurity Screening Tests

The test suite includes synthetic sequences that are known positives (match regulated organisms) and known negatives (benign sequences). The screening engine must:
- Detect all known positives with zero false negatives
- Produce fewer than 1% false positives on a standard benign sequence corpus
- Complete screening of a 10,000 bp sequence in under 5 seconds

## Backwards Compatibility

This is a new standard with no prior version. The DNA encoding format is versioned (currently v1) and the decoder will support all prior versions indefinitely -- DNA archives may be read back decades after encoding, and the decoder must remain compatible.

SBOL 3 compatibility ensures interoperability with the broader synthetic biology tool ecosystem. SBOL 2 designs can be imported via automatic conversion.

## References

1. Goldman, N. et al. "Towards practical, high-capacity, low-maintenance information storage in synthesized DNA." *Nature* 494, 77-80 (2013).
2. Erlich, Y. & Zielinski, D. "DNA Fountain enables a robust and efficient storage architecture." *Science* 355, 950-954 (2017).
3. Church, G.M., Gao, Y. & Kosuri, S. "Next-generation digital information storage in DNA." *Science* 337, 1628 (2012).
4. Organick, L. et al. "Random access in large-scale DNA data storage." *Nature Biotechnology* 36, 242-248 (2018).
5. Ceze, L., Nivala, J. & Strauss, K. "Molecular digital data storage using DNA." *Nature Reviews Genetics* 20, 456-466 (2019).
6. McLaughlin, J.A. et al. "The Synthetic Biology Open Language (SBOL) Version 3: Simplified Data Exchange for Bioengineering." *Frontiers in Bioengineering and Biotechnology* 8, 1009 (2020).
7. IGSC Harmonized Screening Protocol. International Gene Synthesis Consortium (2023). https://genesynthesisconsortium.org
8. Nielsen, A.A.K. et al. "Genetic circuit design automation." *Science* 352, aac7341 (2016).
9. Kosuri, S. & Church, G.M. "Large-scale de novo DNA synthesis: technologies and applications." *Nature Methods* 11, 499-507 (2014).
10. Grass, R.N. et al. "Robust chemical preservation of digital information on DNA in silica with error-correcting codes." *Angewandte Chemie* 54, 2552-2555 (2015).

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
