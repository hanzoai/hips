---
hip: 0092
title: Drug Discovery AI Pipeline Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0032, HIP-0057, HIP-0070
---

# HIP-92: Drug Discovery AI Pipeline Standard

## Abstract

This proposal defines an end-to-end AI-powered drug discovery pipeline for the Hanzo ecosystem, covering target identification, molecular generation, protein structure prediction, molecular docking, ADMET profiling, and virtual screening. The pipeline unifies tools that are currently fragmented across dozens of academic codebases, proprietary platforms, and incompatible file formats into a single API-driven service.

The system integrates with Hanzo ML (HIP-0057) for model training on molecular datasets, Hanzo Object Storage (HIP-0032) for chemical library management (ZINC, ChEMBL, PubChem), and the Quantum Computing standard (HIP-0070) for quantum chemistry calculations (DFT, molecular dynamics). It exposes a REST API, a Python SDK, and a CLI for computational chemists and ML engineers alike.

**Repository**: [github.com/hanzoai/pharma](https://github.com/hanzoai/pharma)
**Port**: 8092 (API)
**Binary**: `hanzo-pharma`
**Container**: `hanzoai/pharma:latest`

## Motivation

### The Drug Discovery Problem

Bringing a new drug to market takes an average of 10-15 years and costs $2.6 billion (Tufts CSDD, 2020). The failure rate is staggering: for every drug that reaches patients, roughly 5,000-10,000 candidate molecules were screened, 250 entered preclinical testing, and 5 entered human clinical trials. The preclinical phase alone -- identifying a target protein, finding molecules that bind to it, and optimizing those molecules for safety -- consumes 3-6 years and hundreds of millions of dollars.

AI can compress the preclinical phase by 40-60%. This is not speculation. Insilico Medicine advanced a novel drug candidate from target identification to Phase I clinical trials in 18 months using AI (versus the typical 4.5 years). Recursion Pharmaceuticals screens 2 million compounds per week using automated biology and ML. Isomorphic Labs (a DeepMind spinoff) uses AlphaFold-derived structural biology to identify drug targets that were previously inaccessible.

The bottleneck is not algorithms -- it is infrastructure. The models exist (diffusion models for molecular generation, ESMFold for protein structure, graph neural networks for property prediction). The data exists (ChEMBL has 2.4 million bioactive compounds, PubChem has 110 million). What does not exist is a unified pipeline that connects these components without months of integration work.

### Why Current Tools Are Insufficient

1. **Fragmentation.** A typical computational chemistry workflow uses RDKit for cheminformatics (Python), AutoDock Vina for docking (C++, command-line), GROMACS for molecular dynamics (Fortran/C++), SchNet for property prediction (PyTorch), and custom scripts to convert between file formats (SDF, PDB, MOL2, SMILES). Each tool has its own input format, its own configuration, and its own failure modes. There is no unified API, no shared data model, and no pipeline orchestration.

2. **GPU underutilization.** Molecular docking is embarrassingly parallel -- you dock millions of molecules independently -- yet AutoDock Vina runs on CPU. AutoDock-GPU exists but requires CUDA expertise to deploy. Virtual screening campaigns that could finish in hours on a GPU cluster take weeks on CPU because the tooling was not designed for modern hardware.

3. **No experiment tracking.** When a medicinal chemist asks "why was this molecule selected as a lead candidate?", the answer is buried in Jupyter notebooks, spreadsheets, and email chains. There is no audit trail from target selection through virtual screening through lead optimization. This is not just inconvenient -- it is a regulatory liability. The FDA increasingly expects computational evidence to be reproducible (FDA guidance on AI/ML in drug development, 2023).

4. **AI models are disconnected from the pipeline.** A researcher trains a molecular generation model in PyTorch, evaluates generated molecules manually in RDKit, runs docking separately in AutoDock, and checks ADMET properties in yet another tool. The feedback loop -- where docking results inform the next round of generation -- requires manual intervention at every step.

### Why Hanzo Cares

Hanzo operates GPU compute infrastructure for AI workloads. Drug discovery is one of the most compute-intensive applications of AI: a single virtual screening campaign against a 10-million-compound library requires 50,000-100,000 GPU-hours of docking simulation. Molecular dynamics simulations for lead optimization require sustained GPU allocation for days or weeks.

This is the same infrastructure pattern as LLM training and inference -- GPU scheduling, checkpoint management, experiment tracking, and cost metering -- applied to a different domain. Hanzo ML (HIP-0057) already handles GPU job scheduling. Hanzo Object Storage (HIP-0032) already stores large datasets. The pharma pipeline reuses this infrastructure with domain-specific models and file format support.

## Design Philosophy

### Chemistry for AI Engineers: A Primer

This section exists because drug discovery AI sits at the intersection of chemistry and machine learning. ML engineers building or operating this pipeline need enough chemistry to understand what the models are doing. This is not a chemistry textbook -- it is the minimum viable understanding.

**Atoms and bonds.** A molecule is a graph. Atoms are nodes; bonds are edges. Carbon (C), nitrogen (N), oxygen (O), sulfur (S), and hydrogen (H) are the primary atoms in drug molecules. Bonds come in types: single (one shared electron pair), double (two pairs), triple (three pairs), and aromatic (delocalized electrons shared across a ring). The atom types and bond types determine the molecule's chemical properties.

**SMILES notation.** SMILES (Simplified Molecular Input Line Entry System) is a string encoding of a molecular graph. Aspirin is `CC(=O)Oc1ccccc1C(=O)O`. Carbon is implicit in ring notation; lowercase letters indicate aromatic atoms; `=` is a double bond; parentheses indicate branching. SMILES is compact and human-readable but not unique -- the same molecule can have multiple valid SMILES strings. Canonical SMILES algorithms (RDKit, OpenBabel) produce a single canonical form.

**SELFIES notation.** SELFIES (Self-Referencing Embedded Strings) is a more recent alternative to SMILES designed for generative models. Every SELFIES string decodes to a valid molecule, whereas many random SMILES strings are chemically invalid. This property makes SELFIES preferable for language-model-based molecular generation because every output token sequence is guaranteed to be a valid molecule. No post-hoc validity filtering required.

**3D structure matters.** A SMILES string encodes the molecular graph (2D topology) but not the 3D shape. Drug molecules bind to proteins by fitting into a binding pocket -- a 3D cavity on the protein surface. The molecule's 3D conformation (the spatial arrangement of its atoms) determines whether it fits. Two molecules with identical SMILES can have different 3D conformations with different binding affinities. This is why molecular docking operates in 3D, not on SMILES strings.

**Proteins are the targets.** Most drugs work by binding to a protein and either blocking its function (inhibitor) or enhancing it (agonist). A protein is a long chain of amino acids (20 types) that folds into a specific 3D structure. The binding site is a pocket or groove on the protein surface where a drug molecule can nestle. Knowing the protein's 3D structure is essential for structure-based drug design. Until 2020, experimental methods (X-ray crystallography, cryo-EM) were the only reliable way to determine protein structures. AlphaFold changed this by predicting structures from amino acid sequences with near-experimental accuracy.

**ADMET.** Before a drug candidate reaches human trials, it must pass ADMET screening:
- **Absorption**: Can the body absorb it? (Oral bioavailability, membrane permeability)
- **Distribution**: Does it reach the target tissue? (Blood-brain barrier penetration, plasma protein binding)
- **Metabolism**: How does the liver break it down? (CYP450 enzyme interactions, half-life)
- **Excretion**: How is it eliminated? (Renal clearance, biliary excretion)
- **Toxicity**: Is it safe? (hERG channel inhibition causing cardiac arrhythmia, hepatotoxicity, mutagenicity)

Failing ADMET is the single largest cause of drug candidate failure. Roughly 40% of clinical trial failures are due to poor pharmacokinetics (ADMET properties), not lack of efficacy. Predicting ADMET computationally before synthesizing a molecule saves years and millions of dollars.

### Why Diffusion Models for Molecular Generation

Molecular generation is the task of creating novel molecules with desired properties. The dominant approaches are:

**Variational Autoencoders (VAEs)** encode molecules into a continuous latent space and decode back. They produce valid molecules but struggle with multi-objective optimization (simultaneously optimizing binding affinity, drug-likeness, and synthesizability).

**Reinforcement Learning (RL)** treats generation as a sequential decision process (adding one atom or bond at a time) with a reward function combining multiple objectives. RL produces high-scoring molecules but is sample-inefficient and prone to mode collapse (generating variations of the same scaffold).

**Diffusion models** learn to generate 3D molecular structures by reversing a noise process. Starting from random atomic coordinates, the model iteratively denoises to produce valid 3D conformations. The key advantage is that diffusion models natively generate 3D structures, not SMILES strings. This means the generated molecules have realistic 3D geometries that can be directly used for docking -- no separate conformer generation step needed.

For 3D pocket-conditioned generation (generating molecules that fit a specific protein binding site), diffusion models are state of the art. TargetDiff, Pocket2Mol, and DiffSBDD condition the generation process on the protein pocket structure, producing molecules that are geometrically complementary to the target. This is the approach we adopt for structure-based drug design.

For property-conditioned generation without a specific target structure, LLM-based generation on SELFIES strings is more practical. A fine-tuned language model generates SELFIES tokens conditioned on desired property profiles (molecular weight range, logP range, number of hydrogen bond donors). The SELFIES guarantee ensures every output is a valid molecule.

### Why End-to-End Pipeline Over Best-of-Breed Tools

The alternative to an integrated pipeline is a "best-of-breed" approach: use RDKit for cheminformatics, AutoDock-GPU for docking, DeepChem for property prediction, and glue them together with scripts. This is what most computational chemistry groups do today.

The problem is the glue. Converting between file formats (SDF to PDB to PDBQT to MOL2) is error-prone and lossy. Tracking which molecules passed which filters requires a custom database. Scheduling GPU resources for docking and property prediction requires a custom scheduler. Reproducing a virtual screening campaign requires re-running every script in the right order with the right inputs.

The integrated pipeline eliminates the glue. Molecules flow through the pipeline as structured objects with a canonical representation. Each stage (generation, docking, ADMET, scoring) reads from and writes to the same data model. The pipeline scheduler (built on HIP-0057 job scheduling) handles GPU allocation. Experiment tracking (also from HIP-0057) records every parameter and result.

The tradeoff is flexibility. A researcher who wants to use a cutting-edge docking algorithm published last week cannot plug it in without wrapping it in our API. We mitigate this with a plugin architecture: any Docker container that reads molecules from stdin and writes scored molecules to stdout can be registered as a pipeline stage.

## Specification

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Hanzo Pharma API (8092)                            │
│                                                                      │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐ │
│  │ Molecular │ │  Protein  │ │Molecular │ │ ADMET  │ │  Virtual  │ │
│  │ Generator │ │ Structure │ │ Docking  │ │Predict │ │ Screening │ │
│  └─────┬─────┘ └─────┬─────┘ └────┬─────┘ └───┬────┘ └─────┬─────┘ │
│        │             │            │            │            │       │
│  ┌─────┴─────────────┴────────────┴────────────┴────────────┴─────┐ │
│  │                    Pipeline Orchestrator                        │ │
│  │              (DAG execution, GPU scheduling)                    │ │
│  └─────┬──────────────┬───────────────────────┬───────────────────┘ │
└────────┼──────────────┼───────────────────────┼─────────────────────┘
         │              │                       │
┌────────┴────┐  ┌──────┴──────┐  ┌─────────────┴──────────────┐
│ Hanzo ML    │  │Hanzo Object │  │   Hanzo Quantum (HIP-0070) │
│ (HIP-0057)  │  │Storage      │  │   DFT, Molecular Dynamics  │
│ GPU Jobs    │  │(HIP-0032)   │  │                            │
│ Experiments │  │Chemical Libs│  │                            │
└─────────────┘  └─────────────┘  └────────────────────────────┘
```

The pipeline is a stateless Go API backed by PostgreSQL for metadata, Object Storage for molecular data and model weights, and Kubernetes for GPU compute jobs. Each module (generation, structure prediction, docking, ADMET, screening) is an independent service that can run as a pipeline stage or be called directly via the API.

### Molecular File Formats

The pipeline must read and write the file formats that computational chemistry actually uses. These are not interchangeable -- each encodes different information.

```yaml
Supported Formats:

  SMILES:
    description: Line notation for molecular graphs (2D topology)
    extension: .smi
    use_case: Database storage, text-based ML models, compact representation
    limitations: No 3D coordinates, no stereochemistry in basic form
    example: "CC(=O)Oc1ccccc1C(=O)O"  # Aspirin

  SELFIES:
    description: Self-referencing embedded strings (always valid molecules)
    extension: .selfies
    use_case: Generative language models (every token sequence is valid)
    limitations: Less human-readable than SMILES
    example: "[C][C][=Branch1][C][=O][O][C][=C][C][=C][C][=C][Ring1][=Branch1][C][=Branch1][C][=O][O]"

  SDF (Structure Data File):
    description: 2D/3D coordinates + properties for one or more molecules
    extension: .sdf, .mol
    use_case: Chemical databases, property storage, multi-molecule files
    encodes: Atom positions, bond types, charges, arbitrary property fields
    size: ~1-5 KB per molecule

  PDB (Protein Data Bank):
    description: 3D coordinates for proteins and protein-ligand complexes
    extension: .pdb
    use_case: Protein structures, docking results, molecular dynamics input
    encodes: Atom positions, residue names, chain IDs, B-factors
    source: RCSB PDB (rcsb.org), AlphaFold DB, ESMFold predictions

  MOL2 (Tripos):
    description: 3D coordinates with atom types and partial charges
    extension: .mol2
    use_case: Docking input (some engines require MOL2), force field assignment
    encodes: Sybyl atom types, partial charges, bond orders

  PDBQT:
    description: PDB format with partial charges and AutoDock atom types
    extension: .pdbqt
    use_case: AutoDock-GPU input/output
    note: Pipeline handles PDBQT conversion internally; users work with PDB/SDF
```

**Canonical internal representation.** Internally, the pipeline stores molecules as a structured object combining SMILES (for identity and deduplication), 3D coordinates (when available), and computed properties. File format conversion happens at API boundaries -- the user uploads SDF, the pipeline converts; the user requests PDB output, the pipeline converts.

### Molecular Generation

Two generation modes serve different design strategies.

#### 3D Diffusion Generation (Structure-Based)

For targets with known protein structures, the pipeline generates molecules conditioned on the binding pocket geometry.

```yaml
3D Diffusion Configuration:
  model: "hanzo-pharma-diffdock-gen"    # Pocket-conditioned diffusion model
  pocket:
    protein_pdb: "s3://pharma/targets/EGFR/4HJO.pdb"
    pocket_residues: [718, 719, 720, 790, 791, 792, 855, 856]  # Binding site residues
    pocket_radius: 10.0                  # Angstroms around pocket center

  generation:
    num_molecules: 1000                  # Generate 1000 candidates
    temperature: 1.0                     # Sampling temperature
    guidance_scale: 2.0                  # Classifier-free guidance strength
    atom_types: [C, N, O, S, F, Cl]     # Allowed atom types
    max_atoms: 50                        # Maximum heavy atoms per molecule

  constraints:
    molecular_weight: [200, 500]         # Daltons (Lipinski's Rule of Five)
    logP: [-0.4, 5.6]                   # Octanol-water partition coefficient
    hbd: [0, 5]                          # Hydrogen bond donors <= 5
    hba: [0, 10]                         # Hydrogen bond acceptors <= 10
    rotatable_bonds: [0, 10]             # Flexibility constraint
    synthetic_accessibility: [1, 5]      # SA score (1=easy, 10=impossible)

  output:
    format: sdf                          # 3D coordinates included
    deduplicate: true                    # Remove duplicate SMILES
    minimize: true                       # Energy-minimize generated conformations
```

The diffusion model operates on atomic point clouds in 3D space. Starting from Gaussian noise placed within the protein pocket, the model iteratively denoises atom positions and types over T timesteps. The pocket structure is provided as context (not denoised) and acts as a spatial constraint -- the generated atoms must form a molecule that fits the pocket geometry.

#### SELFIES Language Model Generation (Ligand-Based)

For property-conditioned generation without a specific target structure.

```yaml
SELFIES LM Configuration:
  model: "hanzo-pharma-selfies-gen"     # Fine-tuned on ChEMBL actives
  conditioning:
    target_activity: "EGFR_inhibitor"    # Activity class from ChEMBL
    property_profile:
      molecular_weight: 350              # Target MW (Daltons)
      logP: 2.5                          # Target lipophilicity
      tpsa: 80                           # Topological polar surface area
      qed: 0.7                           # Quantitative Estimate of Drug-likeness

  generation:
    num_molecules: 10000
    max_tokens: 128                      # Max SELFIES token length
    temperature: 0.8
    top_p: 0.95
    batch_size: 256                      # Generate in batches on GPU

  filtering:
    validity_check: true                 # Verify SELFIES -> valid molecule
    novelty_check: true                  # Not in training set
    diversity_threshold: 0.3             # Tanimoto distance minimum between outputs
```

This mode leverages HIP-0057 for model training. The base model is a transformer trained on SELFIES representations of the ChEMBL database (~2.4 million molecules). Fine-tuning on subsets (e.g., known kinase inhibitors) conditions the model to generate molecules with target-relevant scaffolds.

### Protein Structure Prediction

When the target protein's experimental structure is unavailable (true for roughly 70% of human proteins), the pipeline predicts it from the amino acid sequence.

```yaml
Structure Prediction Configuration:
  engine: "esmfold"                      # esmfold | openfold
  sequence: "MTEYKLVVVGAGGVGKSALTIQLIQ..."  # Amino acid sequence
  options:
    num_recycles: 4                      # Refinement iterations
    chunk_size: 128                      # Sequence chunks for memory efficiency

Supported Engines:

  ESMFold:
    description: Single-sequence structure prediction from Meta AI
    speed: ~1 second per protein (GPU)
    accuracy: Comparable to AlphaFold for well-folded domains
    advantage: No MSA (multiple sequence alignment) required -- 60x faster
    gpu_memory: ~16 GB for proteins up to 1000 residues
    use_case: Rapid screening, large-scale structure prediction

  OpenFold:
    description: Open-source reimplementation of AlphaFold2
    speed: ~5-10 minutes per protein (with MSA generation)
    accuracy: Highest accuracy, matches AlphaFold2
    advantage: Full MSA pipeline for maximum structural accuracy
    gpu_memory: ~40 GB for large proteins with MSA
    use_case: High-confidence structure prediction for drug targets
```

**Why ESMFold over AlphaFold directly?** ESMFold uses a protein language model (ESM-2) to predict structures from single sequences without multiple sequence alignments (MSAs). AlphaFold2 requires MSAs computed by searching sequence databases (UniRef, BFD) -- a process that takes minutes to hours per protein and requires terabytes of database storage. For drug discovery pipelines where you need rapid structure prediction for hundreds of targets, ESMFold's single-sequence approach is 60x faster with comparable accuracy on well-folded domains. OpenFold (the open-source AlphaFold2 reimplementation) is available for cases where maximum accuracy justifies the time cost.

**Predicted structure quality.** Structure prediction models output a per-residue confidence score (pLDDT for ESMFold/AlphaFold). The pipeline uses pLDDT to assess binding site quality:
- pLDDT > 90: High confidence. Suitable for structure-based drug design.
- pLDDT 70-90: Moderate confidence. Binding site geometry may be approximate.
- pLDDT < 70: Low confidence. The binding site may be disordered; use ligand-based methods instead.

### Molecular Docking

Docking predicts how a small molecule binds to a protein and estimates binding strength (affinity). This is the core computational step in virtual screening.

```yaml
Docking Configuration:
  engine: "autodock-gpu"                 # autodock-gpu | diffdock | vina
  protein:
    pdb_path: "s3://pharma/targets/EGFR/4HJO_prepared.pdbqt"
    center: [22.5, -14.3, 8.7]          # Binding site center (Angstroms)
    box_size: [25.0, 25.0, 25.0]        # Search box dimensions

  ligands:
    source: "s3://pharma/libraries/screening_set.sdf"
    count: 1000000                       # 1M compounds to dock
    preparation:
      add_hydrogens: true
      generate_conformers: 5             # Multiple starting conformations
      assign_charges: "gasteiger"        # Partial charge method

  scoring:
    exhaustiveness: 32                   # Search thoroughness (higher = slower, better)
    num_poses: 5                         # Top binding poses per molecule
    energy_range: 3.0                    # kcal/mol range for reported poses

  gpu:
    batch_size: 65536                    # Molecules per GPU batch
    devices: 4                           # Number of GPUs

Supported Engines:

  AutoDock-GPU:
    description: GPU-accelerated AutoDock4 scoring function
    speed: ~100,000 molecules/hour/GPU (A100)
    accuracy: Well-validated physics-based scoring
    advantage: Fastest traditional docking engine on GPU
    use_case: Large-scale virtual screening (millions of compounds)

  DiffDock:
    description: Diffusion model for blind docking (no predefined box)
    speed: ~1,000 molecules/hour/GPU (generative process is slower)
    accuracy: State-of-the-art on PoseBusters benchmark
    advantage: No manual binding site definition required
    use_case: Novel targets, allosteric sites, difficult binding sites

  Vina:
    description: AutoDock Vina -- CPU-based, widely used baseline
    speed: ~500 molecules/hour/CPU
    accuracy: Reasonable for pose prediction, less reliable for scoring
    advantage: Well-understood, no GPU required
    use_case: Quick validation, fallback when GPU unavailable
```

**Why AutoDock-GPU as the default?** Virtual screening requires docking millions of molecules. At 100,000 molecules/hour/GPU, an A100 can screen 1 million compounds in 10 hours. Four A100s finish in 2.5 hours. AutoDock-GPU achieves this throughput by running the Solis-Wets local search algorithm on CUDA cores, evaluating thousands of ligand poses in parallel. Vina, by comparison, would take 83 days on a single CPU core for the same campaign.

**DiffDock for difficult targets.** Traditional docking requires the user to define a binding site (the "search box"). For novel targets without known ligands, or for allosteric sites (binding pockets away from the active site), defining the box is guesswork. DiffDock is a diffusion model that predicts the binding pose without a predefined box -- it scores the entire protein surface. This is slower but eliminates the binding site definition problem.

### ADMET Prediction

ADMET models predict pharmacokinetic and safety properties from molecular structure. These are graph neural networks (GNNs) and transformer models trained on experimental assay data.

```yaml
ADMET Prediction Configuration:
  models:
    absorption:
      - name: "caco2_permeability"
        description: "Caco-2 cell permeability (intestinal absorption proxy)"
        output: "log_papp (cm/s)"
        threshold: "> -5.15 (good absorption)"
        architecture: "AttentiveFP (graph attention network)"

      - name: "oral_bioavailability"
        description: "Fraction of drug reaching systemic circulation"
        output: "F% (0-100)"
        threshold: "> 20% (acceptable)"

    distribution:
      - name: "bbb_penetration"
        description: "Blood-brain barrier permeability"
        output: "probability (0-1)"
        threshold: "> 0.5 for CNS drugs, < 0.3 for peripheral drugs"

      - name: "plasma_protein_binding"
        description: "Fraction bound to plasma proteins"
        output: "fraction_bound (0-1)"
        threshold: "< 0.95 (highly bound drugs have low free fraction)"

    metabolism:
      - name: "cyp_inhibition"
        description: "Inhibition of CYP450 enzymes (drug-drug interaction risk)"
        output: "probability per isoform (1A2, 2C9, 2C19, 2D6, 3A4)"
        threshold: "< 0.5 for each isoform"

      - name: "half_life"
        description: "Plasma half-life prediction"
        output: "hours"
        threshold: "2-12h for daily oral dosing"

    excretion:
      - name: "clearance"
        description: "Hepatic and renal clearance rate"
        output: "mL/min/kg"
        threshold: "< 5 (low clearance)"

    toxicity:
      - name: "herg_inhibition"
        description: "hERG potassium channel block (cardiac arrhythmia risk)"
        output: "probability (0-1)"
        threshold: "< 0.3 (critical safety endpoint)"

      - name: "ames_mutagenicity"
        description: "Mutagenic potential (Ames test prediction)"
        output: "probability (0-1)"
        threshold: "< 0.5 (non-mutagenic)"

      - name: "hepatotoxicity"
        description: "Drug-induced liver injury risk"
        output: "probability (0-1)"
        threshold: "< 0.5"

      - name: "ld50"
        description: "Acute oral toxicity (lethal dose prediction)"
        output: "log(mg/kg)"
        threshold: "> 2.5 (EPA category IV, low toxicity)"
```

ADMET models are trained on public datasets (TDC - Therapeutics Data Commons, ChEMBL bioactivity data, EPA ToxCast) using HIP-0057. The pipeline ships pre-trained models and supports fine-tuning on proprietary assay data.

**Ensemble scoring.** Individual ADMET models have limited accuracy (~75-85% AUROC for classification tasks). The pipeline runs all applicable models and produces a composite "drug-likeness" score that weights each property by its clinical failure risk. hERG inhibition and hepatotoxicity are weighted highest because they cause the most expensive late-stage failures.

### Virtual Screening Pipeline

Virtual screening combines all modules into an automated funnel that starts with millions of compounds and progressively filters to a handful of leads.

```yaml
Virtual Screening Pipeline:
  name: "EGFR_inhibitor_screen"
  target:
    protein_pdb: "s3://pharma/targets/EGFR/4HJO.pdb"
    pocket_residues: [718, 719, 720, 790, 791, 792]

  stages:
    - name: "library_filter"
      type: "property_filter"
      input: "s3://pharma/libraries/zinc22_druglike.sdf"    # 1.4 billion compounds
      filters:
        molecular_weight: [200, 500]
        logP: [-1, 5]
        hbd: [0, 5]
        hba: [0, 10]
        rotatable_bonds: [0, 10]
      expected_output: ~500M compounds

    - name: "pharmacophore_screen"
      type: "pharmacophore"
      input: "previous"
      pharmacophore:
        features:
          - type: "hydrogen_bond_acceptor"
            position: [22.1, -14.5, 9.2]
            radius: 1.5
          - type: "hydrophobic"
            position: [24.3, -12.1, 7.8]
            radius: 2.0
          - type: "aromatic_ring"
            position: [20.8, -15.7, 10.1]
            radius: 1.5
      expected_output: ~5M compounds

    - name: "rapid_docking"
      type: "docking"
      input: "previous"
      engine: "autodock-gpu"
      exhaustiveness: 8                  # Low thoroughness for speed
      gpu_count: 8
      top_n: 50000                       # Keep top 50K by docking score
      expected_runtime: "6 hours"

    - name: "precise_docking"
      type: "docking"
      input: "previous"
      engine: "autodock-gpu"
      exhaustiveness: 64                 # High thoroughness
      gpu_count: 4
      num_poses: 10
      top_n: 5000
      expected_runtime: "4 hours"

    - name: "admet_filter"
      type: "admet"
      input: "previous"
      filters:
        herg_inhibition: "< 0.3"
        ames_mutagenicity: "< 0.5"
        oral_bioavailability: "> 20"
        caco2_permeability: "> -5.15"
      top_n: 500

    - name: "molecular_dynamics"
      type: "quantum"                    # Delegates to HIP-0070
      input: "previous"
      method: "mm_gbsa"                  # Molecular Mechanics with Generalized Born
      simulation_time: "10ns"            # 10 nanosecond simulation per complex
      gpu_count: 2
      top_n: 50                          # Final lead candidates

  output:
    format: "sdf"
    include_scores: true
    include_poses: true
    report: "pdf"                        # Generate summary report
```

This funnel reduces 1.4 billion compounds to 50 lead candidates through progressive filtering. Each stage is a GPU job managed by the pipeline orchestrator. The entire campaign runs in 1-3 days on a modest GPU cluster (8x A100) versus months of manual work.

### Integration with Quantum Computing (HIP-0070)

For the final stages of lead optimization, classical force fields (used in standard docking) lack the accuracy needed to distinguish between closely ranked candidates. Quantum chemistry provides higher-fidelity energy calculations.

```yaml
Quantum Chemistry Integration:
  methods:
    dft:
      description: "Density Functional Theory -- quantum mechanical energy calculation"
      use_case: "Accurate binding energy for top 50-100 candidates"
      compute_time: "1-4 hours per molecule-protein complex"
      accuracy: "Chemical accuracy (~1 kcal/mol)"
      functional: "B3LYP"
      basis_set: "6-31G*"

    molecular_dynamics:
      description: "QM/MM molecular dynamics -- quantum core + classical surroundings"
      use_case: "Protein-ligand binding free energy estimation"
      compute_time: "Days per complex"
      accuracy: "Best available computational method"

    semi_empirical:
      description: "GFN2-xTB -- fast approximate quantum mechanics"
      use_case: "Geometry optimization, conformer ranking"
      compute_time: "Minutes per molecule"
      accuracy: "Sufficient for geometry, not for binding energies"
```

The pipeline delegates quantum calculations to the Quantum Computing service (HIP-0070). The pharma API submits a job with the protein-ligand complex coordinates and the desired method; the quantum service returns the computed energy. This decoupling allows the quantum backend to evolve independently (e.g., adding quantum hardware acceleration) without changing the pharma pipeline.

### Integration with Chemical Libraries (HIP-0032)

Large chemical databases are stored in Hanzo Object Storage and indexed for rapid substructure and similarity search.

```yaml
Chemical Library Management:
  libraries:
    zinc22:
      description: "ZINC22 -- 1.4 billion commercially available compounds"
      size: "~2 TB (compressed SDF)"
      storage: "s3://pharma/libraries/zinc22/"
      index: "PostgreSQL with RDKit cartridge for substructure search"
      update_frequency: "quarterly"

    chembl:
      description: "ChEMBL -- 2.4 million bioactive compounds with assay data"
      size: "~50 GB"
      storage: "s3://pharma/libraries/chembl34/"
      index: "Full-text + fingerprint index"
      update_frequency: "biannual (follows ChEMBL releases)"

    pubchem:
      description: "PubChem -- 110 million unique structures"
      size: "~500 GB"
      storage: "s3://pharma/libraries/pubchem/"
      index: "Fingerprint similarity index"
      update_frequency: "monthly"

    generated:
      description: "Hanzo-generated molecules (from diffusion/LM models)"
      size: "variable"
      storage: "s3://pharma/libraries/generated/{campaign_id}/"
      index: "Auto-indexed on creation"

  search_capabilities:
    substructure: "Find all molecules containing a benzimidazole ring"
    similarity: "Find 1000 molecules most similar to imatinib (Tanimoto > 0.7)"
    pharmacophore: "Find molecules matching a 3D pharmacophore query"
    property_range: "MW 300-500, logP 1-3, HBD <= 3"
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Molecules** | | |
| `/v1/molecules` | POST | Upload molecules (SDF, SMILES, SELFIES) |
| `/v1/molecules/{id}` | GET | Get molecule with computed properties |
| `/v1/molecules/search` | POST | Substructure/similarity/property search |
| `/v1/molecules/convert` | POST | Convert between formats (SDF, PDB, MOL2, SMILES) |
| **Generation** | | |
| `/v1/generate/diffusion` | POST | 3D pocket-conditioned generation |
| `/v1/generate/selfies` | POST | SELFIES language model generation |
| `/v1/generate/status/{job_id}` | GET | Generation job status |
| **Structure** | | |
| `/v1/structure/predict` | POST | Protein structure prediction (ESMFold/OpenFold) |
| `/v1/structure/{id}` | GET | Get predicted structure (PDB) |
| **Docking** | | |
| `/v1/dock` | POST | Submit docking job (single molecule or batch) |
| `/v1/dock/{job_id}` | GET | Get docking results (poses, scores) |
| `/v1/dock/{job_id}/poses` | GET | Download binding poses (PDB/SDF) |
| **ADMET** | | |
| `/v1/admet/predict` | POST | Predict ADMET properties for molecule(s) |
| `/v1/admet/models` | GET | List available ADMET models |
| **Screening** | | |
| `/v1/screen` | POST | Submit virtual screening pipeline |
| `/v1/screen/{id}` | GET | Get screening status and results |
| `/v1/screen/{id}/report` | GET | Download screening report (PDF) |
| **Libraries** | | |
| `/v1/libraries` | GET | List available chemical libraries |
| `/v1/libraries/{name}/search` | POST | Search within a library |
| **Quantum** | | |
| `/v1/quantum/submit` | POST | Submit quantum chemistry calculation |
| `/v1/quantum/{job_id}` | GET | Get quantum calculation results |

All endpoints require Hanzo IAM authentication. Billing is metered by GPU-hours consumed (docking, generation, quantum) and API calls (ADMET prediction, search).

### Configuration

```yaml
# /etc/hanzo-pharma/config.yaml

server:
  host: 0.0.0.0
  port: 8092
  workers: 4

database:
  url: "postgresql://hanzo:password@postgres:5432/hanzo_pharma"
  rdkit_extension: true                  # Enable RDKit PostgreSQL cartridge

storage:
  endpoint: "http://minio:9000"
  access_key: "${HANZO_STORAGE_ACCESS_KEY}"
  secret_key: "${HANZO_STORAGE_SECRET_KEY}"
  buckets:
    molecules: "pharma-molecules"
    libraries: "pharma-libraries"
    results: "pharma-results"
    models: "pharma-models"

ml:
  endpoint: "http://ml.hanzo.svc:8057"   # HIP-0057

quantum:
  endpoint: "http://quantum.hanzo.svc:8070"  # HIP-0070

auth:
  iam_url: "https://hanzo.id"
  verify_tokens: true

docking:
  default_engine: "autodock-gpu"
  gpu_types: ["nvidia-a100-80gb", "nvidia-h100-80gb"]
  max_concurrent_jobs: 16

generation:
  diffusion_model: "s3://pharma-models/diffdock-gen/latest/"
  selfies_model: "s3://pharma-models/selfies-gen/latest/"

structure:
  esmfold_weights: "s3://pharma-models/esmfold/latest/"
  openfold_weights: "s3://pharma-models/openfold/latest/"
  openfold_databases: "s3://pharma-libraries/openfold-dbs/"

admet:
  model_dir: "s3://pharma-models/admet/"
  ensemble_weights:
    herg: 2.0                            # Critical safety -- double weight
    hepatotoxicity: 2.0
    oral_bioavailability: 1.5
    default: 1.0

metrics:
  enabled: true
  port: 9090
  path: /metrics

logging:
  level: info
  format: json
```

## Implementation

### Deployment

#### Docker

```bash
docker run -p 8092:8092 -p 9090:9090 \
  -e HANZO_PHARMA_DATABASE_URL="postgresql://..." \
  -e HANZO_PHARMA_STORAGE_ENDPOINT="http://minio:9000" \
  --gpus all \
  hanzoai/pharma:latest
```

#### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-pharma
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-pharma
  template:
    metadata:
      labels:
        app: hanzo-pharma
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: hanzo-pharma
      containers:
        - name: hanzo-pharma
          image: hanzoai/pharma:latest
          ports:
            - containerPort: 8092
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: HANZO_PHARMA_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: hanzo-pharma-secrets
                  key: database-url
          readinessProbe:
            httpGet:
              path: /ready
              port: 8092
          livenessProbe:
            httpGet:
              path: /alive
              port: 8092
---
apiVersion: v1
kind: Service
metadata:
  name: hanzo-pharma
  namespace: hanzo
spec:
  selector:
    app: hanzo-pharma
  ports:
    - name: api
      port: 8092
    - name: metrics
      port: 9090
```

### CLI Interface

```bash
# Generate molecules for a target
hanzo-pharma generate --target EGFR --pocket-pdb 4HJO.pdb --num 1000

# Predict protein structure
hanzo-pharma structure predict --sequence MTEYKLVVV... --engine esmfold

# Dock molecules against a target
hanzo-pharma dock --protein target.pdb --ligands candidates.sdf --engine autodock-gpu --gpus 4

# Predict ADMET properties
hanzo-pharma admet predict --molecules candidates.sdf --output results.csv

# Run a full virtual screening campaign
hanzo-pharma screen --config campaign.yaml --watch

# Search chemical libraries
hanzo-pharma library search --library zinc22 --substructure "c1ccc2[nH]cnc2c1" --limit 1000
```

### Health and Metrics

```yaml
Metrics (Prometheus):
  Counters:
    hanzo_pharma_molecules_processed_total{stage}
    hanzo_pharma_docking_jobs_total{engine, status}
    hanzo_pharma_generation_jobs_total{method, status}
    hanzo_pharma_gpu_hours_total{stage, gpu_type}

  Histograms:
    hanzo_pharma_docking_throughput{engine}           # Molecules/hour
    hanzo_pharma_admet_latency_seconds{model}
    hanzo_pharma_api_request_duration_seconds{endpoint}

  Gauges:
    hanzo_pharma_screening_progress{campaign_id}      # Percentage complete
    hanzo_pharma_gpus_allocated{stage}
    hanzo_pharma_library_size{library_name}            # Indexed compounds
```

### Implementation Roadmap

**Phase 1: Core Infrastructure (Q1 2026)**
- Molecular file format parsing (SDF, PDB, SMILES, SELFIES, MOL2)
- Chemical library ingestion and indexing (ChEMBL, ZINC subset)
- ADMET prediction models (pre-trained ensemble)
- REST API and Python SDK
- CLI tool

**Phase 2: Docking and Screening (Q2 2026)**
- AutoDock-GPU integration with GPU job scheduling
- Virtual screening pipeline orchestrator
- DiffDock integration for blind docking
- Screening report generation

**Phase 3: Generation and Structure (Q3 2026)**
- 3D diffusion molecular generation (pocket-conditioned)
- SELFIES language model generation
- ESMFold protein structure prediction
- OpenFold integration (full MSA pipeline)

**Phase 4: Quantum and Optimization (Q4 2026)**
- HIP-0070 quantum chemistry integration (DFT, QM/MM)
- Lead optimization feedback loops (generate -> dock -> score -> regenerate)
- Multi-objective optimization (affinity + ADMET + synthesizability)
- Full ZINC22 library indexing (1.4 billion compounds)

## FDA Regulatory Considerations

AI-designed drug candidates must meet the same regulatory standards as traditionally discovered drugs. The FDA's guidance on AI/ML in drug development (2023) and the ICH M7 guideline on mutagenic impurities impose specific requirements that this pipeline addresses.

**Reproducibility.** The pipeline records every parameter, model version, dataset version, and random seed for every computation. A virtual screening campaign can be reproduced exactly from its configuration file. This is essential for regulatory submissions where the FDA may request computational evidence to be re-run.

**Model validation.** ADMET prediction models must be validated against experimental data before use in regulatory submissions. The pipeline provides built-in benchmarking against standard validation sets (TDC leaderboards) and reports model performance metrics (AUROC, RMSE, enrichment factors) alongside predictions.

**Audit trail.** Every molecule's journey through the pipeline -- from initial library membership through filtering, docking, ADMET scoring, and lead selection -- is recorded with timestamps, model versions, and scores. This audit trail supports the "rationale for lead selection" section required in IND (Investigational New Drug) applications.

**GxP compliance.** For use in GLP (Good Laboratory Practice) and GMP (Good Manufacturing Practice) environments, the pipeline supports:
- Signed and versioned model artifacts (SHA-256 checksums in the model registry)
- Role-based access control (HIP-0026) restricting who can modify screening configurations
- Immutable result storage (results are append-only in Object Storage)
- Electronic signatures for pipeline approval (integrated with Hanzo IAM)

**Limitation disclosure.** The pipeline's reports include explicit confidence intervals and known limitations for each computational method. Docking scores are binding energy estimates, not experimental measurements. ADMET predictions have defined applicability domains -- molecules outside the training distribution receive lower confidence scores. This transparency is essential for regulatory credibility.

## Security Considerations

### Data Classification

Drug discovery data spans multiple sensitivity levels:

- **Public**: Chemical library structures (ZINC, ChEMBL, PubChem)
- **Confidential**: Screening results, lead candidates, ADMET profiles
- **Highly Confidential**: Proprietary targets, novel scaffolds, patent-pending structures

The pipeline enforces data classification through Object Storage bucket policies (HIP-0032) and IAM role-based access (HIP-0026). Proprietary targets and lead candidates are encrypted at rest with customer-managed keys via KMS (HIP-0027).

### Intellectual Property Protection

Novel molecules generated by the pipeline are potential patent candidates. The pipeline:
- Stores generated molecules in organization-scoped, encrypted buckets
- Logs all access to generated molecule data
- Supports export restrictions (preventing bulk download of lead candidates)
- Timestamps all generations for prior art documentation

### Compute Isolation

Docking and generation jobs from different organizations run in separate Kubernetes namespaces with network policies preventing cross-tenant data access. GPU memory is cleared between jobs to prevent model weight or molecular data leakage.

## References

1. [HIP-0032: Object Storage Standard](./hip-0032-object-storage-standard.md)
2. [HIP-0057: ML Pipeline & Training Standard](./hip-0057-ml-pipeline-standard.md)
3. [HIP-0070: Quantum Computing Standard](./hip-0070-quantum-computing-standard.md)
4. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md)
5. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
6. DiMasi, J.A., et al. "Innovation in the pharmaceutical industry: New estimates of R&D costs." *Journal of Health Economics* 47 (2016): 20-33.
7. Corso, G., et al. "DiffDock: Diffusion Steps, Twists, and Turns for Molecular Docking." *ICLR 2023*.
8. Lin, Z., et al. "Evolutionary-scale prediction of atomic-level protein structure with a language model." *Science* 379 (2023): 1123-1130.
9. Schneider, P., et al. "Rethinking drug design in the artificial intelligence era." *Nature Reviews Drug Discovery* 19 (2020): 353-364.
10. Santos-Martins, D., et al. "Accelerating AutoDock4 with GPUs and Gradient-Based Local Search." *JCTC* 17 (2021): 1060-1073.
11. Krenn, M., et al. "Self-Referencing Embedded Strings (SELFIES): A 100% robust molecular string representation." *Machine Learning: Science and Technology* 1 (2020): 045024.
12. Ahdritz, G., et al. "OpenFold: Retraining AlphaFold2 yields new insights into its learning mechanisms and capacity for generalization." *Nature Methods* 21 (2024): 1514-1524.
13. FDA. "Using Artificial Intelligence and Machine Learning in the Development of Drug and Biological Products." Discussion Paper (2023).
14. Huang, K., et al. "Therapeutics Data Commons: Machine Learning Datasets and Tasks for Drug Discovery and Development." *NeurIPS 2021 Datasets Track*.
15. Xiong, Z., et al. "Pushing the Boundaries of Molecular Representation for Drug Discovery with the Graph Attention Mechanism." *Journal of Medicinal Chemistry* 63 (2020): 8749-8760.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
