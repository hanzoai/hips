---
hip: 0091
title: Genomics & Bioinformatics Pipeline Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0032, HIP-0057, HIP-0062
---

# HIP-91: Genomics & Bioinformatics Pipeline Standard

## Abstract

This proposal defines the Genomics & Bioinformatics Pipeline standard for end-to-end genomic data processing with AI-enhanced analysis in the Hanzo ecosystem. The pipeline ingests raw sequencing data (FASTQ), performs quality control, aligns reads to a reference genome, calls genetic variants, annotates them with biological context, and -- critically -- uses large language models and transformer architectures to interpret what those variants mean for the individual. It supports whole genome sequencing (WGS), whole exome sequencing (WES), RNA-seq, single-cell RNA-seq (scRNA-seq), and long-read technologies (Oxford Nanopore, PacBio).

The system integrates with Hanzo Object Storage (HIP-0032) for the large binary files that genomics produces (a single human genome generates 300GB+ of raw data), the ML Pipeline (HIP-0057) for training genomics-specific models, and the Scheduler (HIP-0062) for orchestrating batch pipeline execution across GPU and CPU clusters. It enforces HIPAA and GDPR compliance for clinical genomic data at every stage.

**Repository**: [github.com/hanzoai/genomics](https://github.com/hanzoai/genomics)
**Port**: 8091 (API)
**Binary**: `hanzo-genomics`
**Container**: `hanzoai/genomics:latest`

## Motivation

### The Sequencing Bottleneck Has Moved

In 2001, sequencing a single human genome cost $100 million and took 13 years. In 2026, it costs under $200 and takes 24 hours. The cost of generating genomic data has fallen faster than Moore's Law -- roughly 10x every two years since next-generation sequencing arrived in 2007. The world now produces over 40 exabytes of genomic data per year.

The bottleneck is no longer sequencing. It is interpretation.

A typical whole genome contains 4-5 million genetic variants compared to the reference genome. Of these, roughly 20,000 fall in protein-coding regions. Perhaps 100-500 are predicted to alter protein function. Of those, a handful may be clinically relevant -- causing disease, affecting drug response, or increasing risk for a condition. Identifying which variants matter, in which biological context, for which patient, is an interpretation problem that scales with the number of genomes sequenced but not with the number of sequencers purchased.

This is an AI problem. Variant interpretation requires integrating information across multiple scales: the biochemical effect of an amino acid substitution, the evolutionary conservation of the affected residue, the regulatory context of the genomic region, the patient's phenotype, the published literature, and population frequency data. Human geneticists do this manually for a few hundred variants per case. LLMs can do it for millions.

### Why Hanzo Cares About Genomics

Hanzo builds personalized AI. Personalized AI requires biological context. A health assistant that does not understand the user's genome is making recommendations based on population averages -- the medical equivalent of "one size fits all." Pharmacogenomics alone (predicting drug response from genetics) affects prescribing decisions for 90%+ of medications. Integrating genomic data into Hanzo's AI infrastructure makes every downstream model more precise.

The genomics pipeline is the bridge between raw biological data and the structured knowledge that Hanzo's AI models consume.

## Biology for Engineers

This section explains the biological concepts that the pipeline operates on. If you have worked with genomics before, skip to Design Philosophy.

### DNA, Genes, and the Genome

DNA is a string over a 4-character alphabet: A, C, G, T (adenine, cytosine, guanine, thymine). These are nucleotides, commonly called bases. The human genome is approximately 3.2 billion bases long -- about 3.2GB if stored as ASCII, though compression reduces this substantially because most of the genome is shared across all humans.

DNA is double-stranded. Each base pairs with a complement: A pairs with T, C pairs with G. The two strands run in opposite directions (5' to 3' and 3' to 5'). This complementarity is what makes DNA replication and sequencing possible.

A **gene** is a region of DNA that encodes a protein (or a functional RNA molecule). Humans have roughly 20,000 protein-coding genes, which occupy about 1.5% of the genome. The remaining 98.5% includes regulatory regions (which control when and where genes are active), structural elements, transposable elements, and regions of unknown function.

The **genome** is the complete set of DNA in an organism. Humans have 23 pairs of chromosomes (46 total) -- one set from each parent. When we say "sequencing a genome," we mean reading the nucleotide sequence of all 46 chromosomes.

### Sequencing: Reading DNA

Modern sequencing works by fragmenting DNA into short pieces, reading each piece in parallel, and computationally reconstructing the original sequence.

**Short-read sequencing** (Illumina) produces reads of 100-300 bases. A single sequencing run generates hundreds of millions of reads. To ensure every position in the genome is covered, each genome is sequenced to 30-60x "coverage" -- meaning each base is read, on average, 30-60 times by independent reads. This redundancy is essential for distinguishing true genetic variants from sequencing errors (which occur at approximately 0.1-1% per base).

**Long-read sequencing** (Oxford Nanopore Technology, or ONT, and Pacific Biosciences, or PacBio) produces reads of 10,000-1,000,000+ bases. These longer reads span repetitive regions and structural variants that short reads cannot resolve. The tradeoff is higher per-base error rates (5-15% for ONT, 1-2% for PacBio HiFi), compensated by consensus and correction algorithms.

The raw output of a sequencer is a **FASTQ file**: each read is stored as a sequence of bases plus a per-base quality score (Phred scale, where Q30 means a 1-in-1000 chance of error). A 30x whole genome generates approximately 100GB of compressed FASTQ data.

### Alignment: Placing Reads on the Reference

Raw reads are just fragments. To know what part of the genome they came from, each read must be **aligned** (mapped) to a **reference genome** -- a canonical representation of the human genome assembled from multiple individuals (currently GRCh38/hg38, with the newer T2T-CHM13 telomere-to-telomere assembly gaining adoption).

Alignment is a string matching problem at scale: match each of hundreds of millions of 150-base reads against a 3.2-billion-base reference, allowing for mismatches (variants) and gaps (insertions and deletions). Algorithms like BWA-MEM2 use FM-index data structures (a compressed suffix array) to do this in O(n) time per read. Minimap2 handles long reads using minimizer-based seeding and chained alignment.

The output is a **BAM file** (Binary Alignment/Map) or its compressed successor **CRAM**. A 30x WGS BAM file is approximately 80-120GB. BAM files store each read's position on the reference, its alignment quality (MAPQ score), and the original base qualities.

### Variant Calling: Finding Differences

Once reads are aligned, the next step is identifying positions where the individual's DNA differs from the reference. These differences are **variants**.

Types of variants:
- **SNV** (Single Nucleotide Variant): A single base change. Example: position chr17:7577120, reference G, individual A. Most common type -- a typical genome has ~4.5 million SNVs.
- **Indel** (Insertion/Deletion): Small insertions or deletions of 1-50 bases. A typical genome has ~500,000 indels.
- **SV** (Structural Variant): Large rearrangements -- deletions, duplications, inversions, translocations -- affecting 50+ bases. A typical genome has ~20,000 SVs.
- **CNV** (Copy Number Variant): Deletions or duplications of large genomic segments, changing the number of copies of a region. A subset of SVs.

Variant callers use statistical models to distinguish true variants from sequencing errors. **GATK HaplotypeCaller** performs local de novo assembly of reads in active regions and evaluates variant hypotheses using a pair-HMM likelihood model. **DeepVariant** (Google) treats variant calling as an image classification problem: it converts pileup data (reads stacked at a genomic position) into a tensor and classifies each site as homozygous reference, heterozygous variant, or homozygous variant using a convolutional neural network.

The output is a **VCF file** (Variant Call Format): a tab-delimited text file listing each variant with its genomic position, reference and alternate alleles, genotype, and quality metrics. A whole genome VCF is typically 1-5GB uncompressed.

### Annotation and Interpretation

A raw VCF tells you *what* changed. Annotation tells you *what it means*.

Annotation databases include:
- **ClinVar**: Curated clinical significance of variants (pathogenic, likely pathogenic, uncertain significance, likely benign, benign).
- **gnomAD**: Population allele frequencies across >800,000 individuals. A variant found in 5% of the population is almost certainly benign; a variant never seen before is more likely to be significant.
- **dbSNP**: Catalog of known variants with identifiers (rsIDs).
- **OMIM**: Mendelian disease-gene associations.
- **PharmGKB**: Pharmacogenomic variant-drug-outcome relationships.

Annotation is where the pipeline transitions from bioinformatics (computational processing of biological data) to biological interpretation (understanding what the data means). This transition is where AI has the most impact.

### RNA-seq and Gene Expression

DNA is the blueprint; RNA is the working copy. When a gene is active ("expressed"), the cell copies its DNA sequence into messenger RNA (mRNA), which is then translated into protein by ribosomes.

**RNA-seq** measures which genes are active and how active they are by sequencing the mRNA in a sample. The pipeline aligns RNA reads to the genome (or transcriptome), counts how many reads map to each gene, and produces a gene expression matrix: rows are genes, columns are samples, values are expression levels (typically in TPM -- transcripts per million).

**Single-cell RNA-seq (scRNA-seq)** performs RNA-seq on individual cells rather than bulk tissue. This reveals cell-type-specific expression patterns -- critical for understanding tumors (which are heterogeneous mixtures of cell types) and immune responses. scRNA-seq produces sparse matrices (most genes are not expressed in any given cell) with thousands to millions of cells.

## Design Philosophy

### Why a Custom Pipeline over Galaxy/Nextflow Alone

Galaxy and Nextflow are the two dominant platforms for bioinformatics workflows.

**Galaxy** is a web-based platform that provides a graphical interface for building bioinformatics workflows. It is excellent for researchers who need reproducible analyses without writing code. However, Galaxy is designed for interactive, single-user workflows. It does not natively support GPU acceleration for AI-enhanced analysis, it has no concept of ML model serving for variant interpretation, and scaling it to hundreds of concurrent genomes requires significant infrastructure engineering that Galaxy was not designed for.

**Nextflow** is a workflow language for data-driven computational pipelines. nf-core provides community-maintained Nextflow pipelines (sarek for variant calling, rnaseq for expression analysis) that represent the state of the art in traditional bioinformatics. Nextflow excels at orchestrating CPU-bound bioinformatics tools across clusters.

Hanzo Genomics does not replace these tools. It wraps them. The traditional bioinformatics stages (alignment, variant calling, annotation) use BWA-MEM2, GATK, DeepVariant, and standard annotation tools -- the same tools that nf-core/sarek uses. What Hanzo adds is the AI interpretation layer that runs after annotation, the GPU-accelerated stages that traditional pipelines lack, the integration with Hanzo's ML and storage infrastructure, and the compliance framework for clinical data.

The architecture is: Nextflow orchestrates the bioinformatics stages, Hanzo Genomics orchestrates the full pipeline including AI stages, and the Scheduler (HIP-0062) manages the compute resources for both.

### Why GPU Acceleration Matters for Genomics

Traditional bioinformatics is CPU-bound. BWA-MEM2, GATK, and samtools are all CPU programs. But three areas benefit enormously from GPU acceleration:

1. **DeepVariant** is a CNN-based variant caller that runs 10-50x faster on GPU than CPU. For a 30x WGS, DeepVariant on 8 CPU cores takes ~12 hours; on a single A100 GPU, it takes ~20 minutes.
2. **AI variant interpretation** uses transformer models that require GPU for practical inference times when processing thousands of variants per genome.
3. **Protein structure prediction** (ESMFold, AlphaFold) is fundamentally GPU-bound -- predicting the structure of a single protein takes seconds on GPU versus hours on CPU.

The pipeline schedules CPU-bound stages (alignment, sorting) on CPU nodes and GPU-bound stages (DeepVariant, AI interpretation, structure prediction) on GPU nodes, using the Scheduler (HIP-0062) to manage the heterogeneous resources.

## Specification

### Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Hanzo Genomics API (8091)                           │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Pipeline │ │ Sample   │ │ Variant   │ │ AI       │ │ Report   │ │
│  │ Manager  │ │ Registry │ │ Store     │ │ Interp.  │ │ Generator│ │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │            │             │             │            │       │
│  ┌────┴────────────┴─────────────┴─────────────┴────────────┴────┐  │
│  │                    Pipeline Orchestrator                       │  │
│  └──┬──────────┬──────────┬──────────┬──────────┬──────────┬────┘  │
└─────┼──────────┼──────────┼──────────┼──────────┼──────────┼───────┘
      │          │          │          │          │          │
 ┌────┴───┐ ┌───┴────┐ ┌───┴────┐ ┌───┴────┐ ┌───┴────┐ ┌──┴─────┐
 │Ingest/ │ │  QC    │ │ Align  │ │Variant │ │Annotate│ │  AI    │
 │  QC    │ │ Filter │ │(BWA/   │ │Calling │ │(VEP/   │ │Interp. │
 │(FastQC)│ │(fastp) │ │minimap)│ │(GATK/  │ │SnpEff) │ │(LLM/   │
 │        │ │        │ │        │ │DeepVar)│ │        │ │ESMFold)│
 └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
     │          │          │          │          │          │
     └──────────┴──────────┴──────────┴──────────┴──────────┘
                            │
              ┌─────────────┴──────────────┐
              │  Hanzo Object Storage (9000)│
              │  FASTQ / BAM / VCF / Reports│
              └────────────────────────────┘
```

### Pipeline Stages

Each stage is a containerized job scheduled by the Pipeline Orchestrator. Stages can be CPU-only or GPU-accelerated. The pipeline supports streaming (stage N+1 begins as stage N produces output) for alignment and sorting, and batch mode for variant calling and interpretation.

#### Stage 1: Ingestion and Quality Control

**Input**: Raw FASTQ files (paired-end or single-end, short or long reads).

**Operations**:
- **FastQC**: Generates quality metrics -- per-base quality distribution, GC content, adapter contamination, sequence duplication levels.
- **fastp**: Trims adapter sequences, filters low-quality reads (Q < 20), removes reads shorter than a minimum length. For paired-end data, ensures read pairs remain synchronized.
- **Contamination screening**: Aligns a subset of reads against common contaminants (PhiX, mycoplasma, human for non-human samples) using Kraken2.

**Output**: Trimmed FASTQ files, QC report (JSON + HTML).

**Resources**: CPU-only, 4-8 cores, ~16GB RAM per sample. Runtime: 30-60 minutes per 30x WGS.

```yaml
Stage 1 Configuration:
  tool: fastp
  params:
    qualified_quality_phred: 20
    length_required: 50
    adapter_detection: auto        # Auto-detect adapter sequences
    correction: true               # Overlap-based error correction for PE reads
    dedup: false                   # Dedup at alignment stage instead
    threads: 8
  contamination_screen:
    enabled: true
    database: "s3://hanzo-genomics/references/kraken2-standard/"
    threshold: 0.05                # Flag if >5% reads are contaminant
```

#### Stage 2: Alignment

**Input**: Trimmed FASTQ files + reference genome index.

**Operations**:
- **BWA-MEM2** (short reads): Aligns 150bp paired-end reads to GRCh38. BWA-MEM2 is the AVX-512 optimized successor to BWA-MEM, 2-3x faster on modern CPUs.
- **minimap2** (long reads): Aligns ONT or PacBio reads using minimizer seeding. Handles reads >100kb with structural variant-aware alignment.
- **Post-alignment processing**: Sort by coordinate (samtools sort), mark duplicate reads (samtools markdup or GATK MarkDuplicates), index (samtools index).

**Output**: Coordinate-sorted, duplicate-marked BAM/CRAM file + index (.bai/.crai).

**Resources**: CPU-intensive, 16-32 cores, ~64GB RAM. Runtime: 2-6 hours per 30x WGS.

```yaml
Stage 2 Configuration:
  short_read_aligner: bwa-mem2
  long_read_aligner: minimap2
  reference: "s3://hanzo-genomics/references/GRCh38/GRCh38_full_analysis_set.fa"
  params:
    bwa_mem2:
      threads: 32
      sort_threads: 8
      mark_duplicates: true
    minimap2:
      preset: map-ont             # ONT reads; use map-hifi for PacBio HiFi
      threads: 32
  output_format: cram              # CRAM is 30-50% smaller than BAM
  base_quality_recalibration:
    enabled: true                  # GATK BQSR for short reads
    known_sites:
      - "s3://hanzo-genomics/references/known-sites/dbsnp_146.hg38.vcf.gz"
      - "s3://hanzo-genomics/references/known-sites/Mills_and_1000G.hg38.vcf.gz"
```

#### Stage 3: Variant Calling

**Input**: Sorted, duplicate-marked BAM/CRAM file.

**Operations**:
- **SNV/Indel calling**: GATK HaplotypeCaller (CPU) or DeepVariant (GPU). DeepVariant is preferred for WGS due to higher accuracy on indels and its ability to leverage GPU acceleration.
- **Structural variant calling**: Manta (short reads) or Sniffles2 (long reads) for SVs >50bp.
- **Joint genotyping**: For cohort studies, individual gVCFs are combined via GATK GenomicsDBImport + GenotypeGVCFs.

**Output**: VCF file (SNVs/indels) + SV VCF (structural variants).

**Resources**: DeepVariant requires 1 GPU (A100 preferred) + 16 cores + 64GB RAM. Runtime: 20-40 minutes per 30x WGS on GPU; 8-12 hours on CPU only.

```yaml
Stage 3 Configuration:
  snv_caller: deepvariant          # deepvariant | gatk_haplotypecaller
  deepvariant:
    model: "WGS"                   # WGS | WES | PACBIO | ONT_R10
    gpu: true
    num_shards: 16                 # Parallelize across genomic regions
  sv_caller: manta                 # manta (short reads) | sniffles2 (long reads)
  joint_genotyping:
    enabled: false                 # Enable for cohort analysis
    cohort_size_threshold: 5       # Require at least 5 samples
  quality_filters:
    min_gq: 20                     # Minimum genotype quality
    min_dp: 10                     # Minimum read depth
    max_dp: 500                    # Maximum read depth (flag regions with pileups)
```

#### Stage 4: Annotation

**Input**: VCF file.

**Operations**:
- **Functional annotation**: VEP (Variant Effect Predictor) or SnpEff classifies each variant's effect on genes -- synonymous, missense, nonsense, frameshift, splice site, regulatory, intergenic.
- **Population frequency**: gnomAD allele frequencies (exome + genome, global + per-population).
- **Clinical databases**: ClinVar significance, OMIM disease associations.
- **Pathogenicity prediction**: CADD (Combined Annotation Dependent Depletion) scores, REVEL scores for missense variants, SpliceAI scores for splice variants.
- **Pharmacogenomics**: PharmGKB and CPIC (Clinical Pharmacogenetics Implementation Consortium) annotations for drug-gene interactions.

**Output**: Annotated VCF with INFO fields for each annotation source, plus a structured JSON report.

```yaml
Stage 4 Configuration:
  annotator: vep                   # vep | snpeff
  vep:
    assembly: GRCh38
    cache: "s3://hanzo-genomics/references/vep-cache/113/"
    plugins:
      - CADD
      - SpliceAI
      - REVEL
      - gnomAD
      - ClinVar
      - PharmGKB
    output_format: json            # JSON for downstream AI processing
  frequency_filter:
    max_af: 0.01                   # Filter out variants with AF > 1% for rare disease
    population: "gnomAD_AF"
```

#### Stage 5: AI-Enhanced Interpretation

This is where the pipeline diverges from traditional bioinformatics. Traditional pipelines stop at annotation. Hanzo Genomics adds an AI interpretation layer that synthesizes annotations into clinical-grade variant assessments.

**Input**: Annotated variants (JSON), patient phenotype (HPO terms), optional family data.

**Operations**:

**5a. LLM-Based Variant Interpretation.**

A fine-tuned Zen model evaluates each candidate variant against the ACMG/AMP (American College of Medical Genetics) 28-criteria framework for variant classification. The model ingests the variant's annotations (consequence, frequency, conservation, pathogenicity scores) along with the patient's phenotype, and produces a structured classification with evidence codes.

```yaml
AI Variant Interpretation:
  model: "zen-72b-genomics"        # Fine-tuned on ClinVar + literature
  input:
    variant:
      gene: "BRCA1"
      hgvs_c: "c.5266dupC"
      hgvs_p: "p.Gln1756ProfsTer74"
      consequence: "frameshift_variant"
      gnomad_af: 0.0001
      clinvar: "Pathogenic"
      cadd_phred: 35.0
      conservation_phylop: 7.2
    phenotype:
      hpo_terms: ["HP:0003002", "HP:0012125"]  # Breast cancer, Ovarian cancer
      sex: "female"
      age: 42
      family_history: "Mother diagnosed with breast cancer at 48"
  output:
    classification: "Pathogenic"
    evidence_codes: ["PVS1", "PM2", "PP5"]
    confidence: 0.97
    explanation: "Frameshift variant in BRCA1 causes premature termination..."
    recommended_actions:
      - "Refer to genetic counseling"
      - "Consider enhanced breast cancer screening (MRI)"
      - "Discuss risk-reducing surgical options"
    pharmacogenomics:
      - drug: "Olaparib"
        recommendation: "BRCA1 pathogenic variant confers sensitivity to PARP inhibitors"
        evidence_level: "1A"
```

The model is fine-tuned using the ML Pipeline (HIP-0057) on a curated dataset of expert-classified variants from ClinVar, LOVD, and published case reports. Training data is structured as (variant_annotations, phenotype, classification, evidence_codes) tuples.

**5b. Protein Structure Prediction.**

For missense variants (amino acid substitutions), ESMFold predicts the 3D structure of both the wild-type and mutant protein. Structural differences -- particularly in active sites, protein-protein interaction interfaces, and stability-critical residues -- inform pathogenicity assessment.

```yaml
Protein Structure Prediction:
  model: esmfold                   # ESMFold via Hanzo inference
  trigger: missense_variants       # Only for amino acid changes
  output:
    wild_type_pdb: "s3://hanzo-genomics/structures/{gene}_wt.pdb"
    mutant_pdb: "s3://hanzo-genomics/structures/{gene}_{mutation}.pdb"
    rmsd: 2.4                      # Root mean square deviation (Angstroms)
    ddg: 3.1                       # Predicted change in folding free energy (kcal/mol)
    affected_domain: "BRCT_domain"
    structural_impact: "moderate"  # minimal | moderate | severe
  resources:
    gpu: true                      # ESMFold requires GPU
    memory: "32Gi"
    runtime: "30s per protein"     # ~30s for average-length human protein
```

**5c. Gene Expression Analysis with Transformers.**

For RNA-seq data, transformer models trained on gene expression atlases identify aberrant expression patterns, predict cell-type composition from bulk RNA-seq (deconvolution), and classify tumors by molecular subtype.

```yaml
Expression Analysis:
  bulk_rna_seq:
    normalization: TPM             # Transcripts per million
    differential_expression:
      method: DESeq2               # Standard statistical method
      ai_enhancement:
        model: "zen-7b-expression"
        task: "pathway_enrichment"  # AI identifies affected pathways
    tumor_classification:
      model: "zen-7b-oncology"
      output: molecular_subtype    # e.g., Luminal A, Basal-like for breast cancer

  single_cell:
    preprocessing:
      tool: scanpy
      min_genes: 200
      min_cells: 3
      max_mito_pct: 20            # Filter dead cells (high mitochondrial %)
    clustering:
      method: leiden
      resolution: 1.0
    cell_type_annotation:
      model: "zen-7b-celltype"    # Trained on Human Cell Atlas
      reference: "s3://hanzo-genomics/references/hca-reference/"
```

### Supported Sequencing Types

| Type | Abbreviation | Input | Typical Size | Use Case |
|------|-------------|-------|-------------|----------|
| Whole Genome Sequencing | WGS | FASTQ (PE 150bp) | 100-300GB | Comprehensive variant detection |
| Whole Exome Sequencing | WES | FASTQ (PE 150bp) | 10-30GB | Protein-coding variants only (cost-effective) |
| RNA Sequencing | RNA-seq | FASTQ (PE/SE) | 5-20GB | Gene expression, fusion detection |
| Single-Cell RNA-seq | scRNA-seq | FASTQ (10x Chromium) | 20-100GB | Cell-type-specific expression |
| ONT Long Read | ONT-WGS | FASTQ/FAST5/POD5 | 50-200GB | Structural variants, methylation |
| PacBio HiFi | PB-WGS | FASTQ/BAM (HiFi) | 50-150GB | High-accuracy long reads |

### File Formats

The pipeline produces and consumes standard bioinformatics formats:

```yaml
Formats:
  FASTQ:
    description: "Raw sequencing reads with quality scores"
    extensions: [.fastq, .fq, .fastq.gz, .fq.gz]
    compression: gzip (standard), zstd (supported)
    typical_size: "50-150GB per 30x WGS (compressed)"

  BAM:
    description: "Binary Alignment/Map -- aligned reads"
    extensions: [.bam]
    index: ".bai"
    typical_size: "80-120GB per 30x WGS"

  CRAM:
    description: "Compressed alignment -- reference-based compression of BAM"
    extensions: [.cram]
    index: ".crai"
    typical_size: "30-60GB per 30x WGS (50-70% smaller than BAM)"
    requires: reference FASTA for decompression

  VCF:
    description: "Variant Call Format -- genetic variants"
    extensions: [.vcf, .vcf.gz]
    index: ".tbi (tabix)"
    typical_size: "100MB-5GB per WGS (compressed)"

  FASTA:
    description: "Reference genome sequences"
    extensions: [.fa, .fasta, .fa.gz]
    index: [".fai (samtools)", ".bwt (BWA index)", ".mmi (minimap2 index)"]

  PDB:
    description: "Protein Data Bank -- 3D protein structures"
    extensions: [.pdb]
    generated_by: "ESMFold structure prediction"

  H5AD:
    description: "Annotated Data -- single-cell expression matrices (AnnData)"
    extensions: [.h5ad]
    typical_size: "1-50GB per scRNA-seq experiment"
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Pipelines** | | |
| `/v1/pipelines` | POST | Submit a new pipeline run |
| `/v1/pipelines/{id}` | GET | Get pipeline status and stage progress |
| `/v1/pipelines/{id}/cancel` | POST | Cancel a running pipeline |
| `/v1/pipelines/{id}/logs` | GET | Stream pipeline logs (SSE) |
| `/v1/pipelines/{id}/report` | GET | Get final interpretation report |
| **Samples** | | |
| `/v1/samples` | GET | List registered samples |
| `/v1/samples` | POST | Register a new sample with metadata |
| `/v1/samples/{id}` | GET | Get sample details and associated runs |
| `/v1/samples/{id}/variants` | GET | Query variants for a sample (paginated) |
| `/v1/samples/{id}/expression` | GET | Get gene expression data (RNA-seq) |
| **Variants** | | |
| `/v1/variants/query` | POST | Query variants across samples (region, gene, consequence) |
| `/v1/variants/{id}/interpret` | POST | Request AI interpretation of a specific variant |
| `/v1/variants/batch-interpret` | POST | Batch AI interpretation |
| **Pharmacogenomics** | | |
| `/v1/pharmgx/{sample_id}` | GET | Get pharmacogenomic profile for a sample |
| `/v1/pharmgx/{sample_id}/drug/{drug}` | GET | Get predicted response for a specific drug |
| **References** | | |
| `/v1/references` | GET | List available reference genomes and annotation databases |
| `/v1/references/sync` | POST | Sync latest annotation databases (ClinVar, gnomAD) |
| **Admin** | | |
| `/v1/health` | GET | Health check |
| `/v1/metrics` | GET | Prometheus metrics |

### Pipeline Submission

```yaml
Pipeline Submission:
  sample:
    id: "SAMPLE-2026-0042"
    name: "Patient A"
    organism: "Homo sapiens"
    sequencing_type: "WGS"
    platform: "Illumina NovaSeq X"
    read_length: 150
    paired_end: true
  input:
    fastq_r1: "s3://hanzo-genomics/incoming/SAMPLE-0042_R1.fastq.gz"
    fastq_r2: "s3://hanzo-genomics/incoming/SAMPLE-0042_R2.fastq.gz"
  reference: "GRCh38"
  pipeline:
    stages: [qc, align, variant_call, annotate, ai_interpret]
    variant_caller: deepvariant
    ai_interpretation:
      enabled: true
      model: "zen-72b-genomics"
      phenotype:
        hpo_terms: ["HP:0003002"]
        sex: "female"
        age: 42
      pharmacogenomics: true
      structure_prediction: true
  compliance:
    hipaa: true
    data_residency: "us-east"
    encryption: "aes-256-gcm"
    audit_log: true
  priority: normal                 # low | normal | high | urgent
  callback_url: "https://app.hanzo.ai/webhooks/genomics"
```

### Integration with Hanzo Ecosystem

**Object Storage (HIP-0032).** Genomic files are large and access patterns are write-once-read-many. FASTQ files are written during ingestion and read once during alignment. BAM/CRAM files are written during alignment and read during variant calling. VCF files are small enough for random access. The pipeline uses lifecycle policies to tier data: active pipeline data on SSD-backed storage, completed BAM/CRAM files moved to archive tier after 30 days, FASTQ files deleted after successful pipeline completion (they can be regenerated from the original sequencer output).

```yaml
Storage Lifecycle:
  fastq:
    hot: 7 days                    # SSD during pipeline execution
    delete: after pipeline completion  # Raw data not retained
  bam_cram:
    hot: 30 days                   # Frequently accessed during analysis
    warm: 365 days                 # Infrequent access
    archive: indefinite            # Glacier-equivalent for compliance
  vcf:
    hot: indefinite                # Small, always accessible
  reports:
    hot: indefinite                # Clinical reports never archived
```

**ML Pipeline (HIP-0057).** The genomics-specific AI models (zen-72b-genomics, zen-7b-expression, zen-7b-celltype) are trained and versioned using the ML Pipeline. Training datasets include ClinVar (>2 million variant classifications), GTEx (gene expression across 54 human tissues), and the Human Cell Atlas (>50 million single-cell profiles). Model updates flow through the standard ML Pipeline stages: training, evaluation, registry, promotion.

**Scheduler (HIP-0062).** A single WGS pipeline run requires heterogeneous resources: CPU nodes for alignment (32 cores, 64GB RAM, 4-6 hours), GPU nodes for DeepVariant and AI interpretation (1x A100, 20-40 minutes each), and minimal resources for QC and annotation. The Scheduler allocates resources per-stage, releasing them as each stage completes. For batch processing (processing 100 genomes), the Scheduler optimizes throughput by running multiple pipelines concurrently with fair-share resource allocation.

### Pharmacogenomics

Pharmacogenomics (PGx) translates genetic variants into drug response predictions. The pipeline reports PGx results using CPIC (Clinical Pharmacogenetics Implementation Consortium) guidelines.

```yaml
Pharmacogenomics Report:
  sample_id: "SAMPLE-2026-0042"
  star_alleles:                    # Standard PGx nomenclature
    CYP2D6: "*1/*4"               # One normal allele, one non-functional
    CYP2C19: "*1/*17"             # One normal, one ultra-rapid metabolizer
    DPYD: "*1/*1"                  # Normal (no DPD deficiency)
    SLCO1B1: "*1a/*5"             # Reduced transporter function

  drug_recommendations:
    - drug: "Codeine"
      gene: "CYP2D6"
      metabolizer_status: "Intermediate Metabolizer"
      recommendation: "Use with caution; reduced conversion to morphine"
      cpic_level: "A"              # Strongest evidence
      alternative: "Consider morphine or non-opioid analgesic"

    - drug: "Clopidogrel"
      gene: "CYP2C19"
      metabolizer_status: "Ultra-rapid Metabolizer"
      recommendation: "Standard dosing appropriate; enhanced activation expected"
      cpic_level: "A"

    - drug: "Simvastatin"
      gene: "SLCO1B1"
      metabolizer_status: "Decreased Function"
      recommendation: "Prescribe <=20mg or use alternative statin (rosuvastatin)"
      cpic_level: "A"
      risk: "Increased myopathy risk at higher doses"

    - drug: "5-Fluorouracil"
      gene: "DPYD"
      metabolizer_status: "Normal Metabolizer"
      recommendation: "Standard dosing appropriate"
      cpic_level: "A"

  ai_enhanced_predictions:
    model: "zen-72b-genomics"
    novel_interactions:
      - variant: "chr10:96541616 G>A (CYP2C19 novel)"
        predicted_effect: "Likely reduced enzyme activity based on active site proximity"
        confidence: 0.82
        note: "Novel variant not in CPIC; AI prediction based on structural analysis"
```

## Security Considerations

### HIPAA Compliance

Genomic data is Protected Health Information (PHI) under HIPAA when linked to an identifiable individual. The pipeline enforces:

- **Encryption at rest**: AES-256-GCM for all stored files (FASTQ, BAM, VCF, reports). Encryption keys managed by KMS (HIP-0027).
- **Encryption in transit**: TLS 1.3 for all API communication and inter-stage data transfer.
- **Access control**: Hanzo IAM authentication on all endpoints. Role-based access: clinicians see interpretation reports; bioinformaticians see pipeline details; researchers see de-identified aggregate data.
- **Audit logging**: Every data access (file read, variant query, report download) is logged with caller identity, timestamp, and resource accessed. Logs are immutable and retained for 7 years.
- **Data residency**: Pipeline execution and data storage respect geographic constraints. A US patient's data never leaves US-based infrastructure.
- **Minimum necessary**: API responses return only the data required for the caller's role. A pharmacist querying PGx results does not receive the full VCF.
- **De-identification**: For research use, the pipeline can strip PHI (name, DOB, MRN) from VCF headers and reports, retaining only a study-specific pseudonym.

### GDPR Compliance

For EU subjects, the pipeline additionally enforces:

- **Right to erasure**: A deletion request removes all pipeline artifacts (FASTQ, BAM, VCF, reports, AI interpretations) within 30 days. Audit logs are retained (legal basis: legitimate interest for security).
- **Data portability**: Patients can export their VCF, interpretation report, and PGx profile in standard formats via API.
- **Purpose limitation**: Genomic data processed for clinical interpretation cannot be reused for research without explicit re-consent, enforced by separate IAM scopes.
- **Data Protection Impact Assessment**: The pipeline includes a DPIA template documenting risks, mitigations, and the legal basis for processing genetic data (explicit consent under Article 9(2)(a) or healthcare provision under Article 9(2)(h)).

### Genomic Data Specific Risks

Genomic data has properties that make it uniquely sensitive:

- **Immutability**: Unlike a password, a genome cannot be changed. A breach exposes information for the individual's lifetime.
- **Familial implications**: An individual's genome reveals information about their biological relatives, who did not consent to the data being generated.
- **Re-identification risk**: Even "anonymized" genomic data can be re-identified by cross-referencing with public genealogy databases. The pipeline enforces strict access controls on raw variant data and prohibits export of full VCFs through research-scoped API tokens.

## Implementation

### Configuration

```yaml
# /etc/hanzo-genomics/config.yaml

server:
  host: 0.0.0.0
  port: 8091
  workers: 4

database:
  url: "postgresql://hanzo:password@postgres:5432/hanzo_genomics"

storage:
  endpoint: "http://minio:9000"
  access_key: "${HANZO_STORAGE_ACCESS_KEY}"
  secret_key: "${HANZO_STORAGE_SECRET_KEY}"
  buckets:
    incoming: "hanzo-genomics-incoming"
    pipeline: "hanzo-genomics-pipeline"
    results: "hanzo-genomics-results"
    references: "hanzo-genomics-references"

ai:
  llm_gateway: "http://llm.hanzo.svc:4000"
  variant_model: "zen-72b-genomics"
  expression_model: "zen-7b-expression"
  celltype_model: "zen-7b-celltype"
  esmfold_endpoint: "http://esmfold.hanzo.svc:8080"

scheduler:
  endpoint: "http://scheduler.hanzo.svc:8062"
  namespace: "hanzo-genomics"
  cpu_node_pool: "genomics-cpu"
  gpu_node_pool: "genomics-gpu"

compliance:
  hipaa_mode: true
  encryption_key_id: "${KMS_GENOMICS_KEY_ID}"
  audit_stream: "hanzo.genomics.audit"
  data_retention_days: 2555       # 7 years

references:
  genome: "GRCh38"
  vep_cache_version: 113
  clinvar_update_interval: "weekly"
  gnomad_version: "4.1"

auth:
  iam_url: "https://hanzo.id"
  verify_tokens: true

metrics:
  enabled: true
  port: 9090
  path: /metrics
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-genomics
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-genomics
  template:
    metadata:
      labels:
        app: hanzo-genomics
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: hanzo-genomics
      containers:
        - name: hanzo-genomics
          image: hanzoai/genomics:latest
          ports:
            - containerPort: 8091
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: HANZO_GENOMICS_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: hanzo-genomics-secrets
                  key: database-url
          readinessProbe:
            httpGet:
              path: /v1/health
              port: 8091
          livenessProbe:
            httpGet:
              path: /v1/health
              port: 8091
---
apiVersion: v1
kind: Service
metadata:
  name: hanzo-genomics
  namespace: hanzo
spec:
  selector:
    app: hanzo-genomics
  ports:
    - name: api
      port: 8091
    - name: metrics
      port: 9090
```

### Health and Metrics

```yaml
Metrics (Prometheus):
  Counters:
    hanzo_genomics_pipelines_total{type, status, org}        # Total pipeline runs
    hanzo_genomics_variants_called_total{caller, type}       # Variants identified
    hanzo_genomics_ai_interpretations_total{model, classification}
    hanzo_genomics_samples_registered_total{org}

  Histograms:
    hanzo_genomics_pipeline_duration_seconds{type}           # End-to-end pipeline time
    hanzo_genomics_stage_duration_seconds{stage}             # Per-stage timing
    hanzo_genomics_ai_interpretation_latency_seconds{model}

  Gauges:
    hanzo_genomics_pipelines_running{type, org}              # Active pipelines
    hanzo_genomics_storage_bytes{bucket}                     # Storage usage per bucket
    hanzo_genomics_reference_db_age_days{database}           # Days since last DB update
```

### Implementation Roadmap

**Phase 1: Core Pipeline (Q2 2026)**
- FASTQ ingestion, QC, alignment (BWA-MEM2), variant calling (DeepVariant)
- BAM/CRAM/VCF support with Object Storage integration
- Pipeline orchestration with stage-level scheduling
- Sample registry and basic variant query API
- HIPAA encryption and audit logging

**Phase 2: Annotation and PGx (Q3 2026)**
- VEP/SnpEff annotation pipeline
- ClinVar, gnomAD, PharmGKB integration
- Pharmacogenomics reporting (CPIC guidelines)
- Automated annotation database updates

**Phase 3: AI Interpretation (Q4 2026)**
- LLM-based variant interpretation (zen-72b-genomics fine-tune)
- ESMFold protein structure prediction integration
- ACMG/AMP automated classification
- Clinical report generation

**Phase 4: Expression and Advanced Analysis (Q1 2027)**
- RNA-seq pipeline (bulk + single-cell)
- Transformer-based expression analysis models
- Long-read sequencing support (ONT, PacBio)
- Tumor molecular subtyping
- Multi-sample cohort analysis and joint genotyping

## References

1. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
2. [HIP-0032: Object Storage Standard](./hip-0032-object-storage-standard.md)
3. [HIP-0057: ML Pipeline & Training Standard](./hip-0057-ml-pipeline-standard.md)
4. [HIP-0062: Scheduler Standard](./hip-0062-scheduler-standard.md)
5. [BWA-MEM2: Fast and accurate short read alignment](https://github.com/bwa-mem2/bwa-mem2)
6. [minimap2: Pairwise alignment for nucleotide sequences](https://doi.org/10.1093/bioinformatics/bty191)
7. [DeepVariant: Highly accurate genomes with deep neural networks](https://doi.org/10.1038/nbt.4235)
8. [GATK Best Practices for Germline Short Variant Discovery](https://gatk.broadinstitute.org/hc/en-us/articles/360035535932)
9. [VEP: Variant Effect Predictor](https://doi.org/10.1186/s13059-016-0974-4)
10. [CADD: Combined Annotation Dependent Depletion](https://doi.org/10.1038/ng.2892)
11. [ESMFold: Language models enable zero-shot protein structure prediction](https://doi.org/10.1126/science.ade2574)
12. [ClinVar: Public archive of variant interpretations](https://www.ncbi.nlm.nih.gov/clinvar/)
13. [gnomAD: Genome Aggregation Database](https://gnomad.broadinstitute.org/)
14. [CPIC: Clinical Pharmacogenetics Implementation Consortium](https://cpicpgx.org/)
15. [ACMG/AMP Standards for Variant Interpretation](https://doi.org/10.1038/gim.2015.30)
16. [10x Genomics Chromium Single Cell](https://www.10xgenomics.com/)
17. [Human Cell Atlas](https://www.humancellatlas.org/)
18. [HIPAA Privacy Rule and Genetic Information](https://www.hhs.gov/hipaa/for-professionals/privacy/index.html)
19. [GDPR Article 9: Processing of Special Categories of Personal Data](https://gdpr-info.eu/art-9-gdpr/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
