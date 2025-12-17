---
hip: 251
title: AI Compute Carbon Footprint
tags: [sustainability, carbon, compute, emissions]
description: Methodology for measuring and reporting carbon emissions from AI training and inference.
author: Hanzo AI Team (@hanzoai)
discussions-to: https://github.com/hanzoai/hips/discussions
status: Draft
type: Meta
created: 2025-12-17
requires: [200, 250]
---

# HIP-251: AI Compute Carbon Footprint

## Abstract

This HIP establishes the methodology for measuring, calculating, and reporting the carbon footprint of Hanzo AI's training and inference operations. It aligns with the GHG Protocol and provides AI-specific guidance for accurate carbon accounting.

## Scope

### Operational Boundary

| Activity | Scope | Included |
|----------|-------|----------|
| **Model training** | Scope 2/3 | ✅ Yes |
| **Model inference** | Scope 2/3 | ✅ Yes |
| **Data storage** | Scope 2/3 | ✅ Yes |
| **Development compute** | Scope 2/3 | ✅ Yes |
| **Employee devices** | Scope 3 | ✅ Yes |
| **Cloud services** | Scope 3 | ✅ Yes |

### Emissions Categorization

| GHG Scope | AI-Relevant Sources |
|-----------|---------------------|
| **Scope 1** | On-site generation (if any) |
| **Scope 2** | Purchased electricity for owned compute |
| **Scope 3, Cat 1** | Cloud compute purchases |
| **Scope 3, Cat 3** | Fuel-related activities |
| **Scope 3, Cat 11** | Customer inference (if applicable) |

## Training Emissions

### Calculation Methodology

#### Energy Consumption

**Formula**:
```
E_training = Σ(GPU_hours × TDP × PUE) / 1000
```

Where:
- `GPU_hours` = GPU hours used
- `TDP` = Thermal Design Power (kW)
- `PUE` = Power Usage Effectiveness

#### Carbon Emissions

**Formula**:
```
CO2e_training = E_training × EF_grid × (1 - R%)
```

Where:
- `E_training` = Energy consumption (kWh)
- `EF_grid` = Grid emission factor (kgCO2e/kWh)
- `R%` = Renewable energy percentage

### Reference Values

#### GPU Power Consumption

| GPU | TDP (W) | Typical Utilization | Effective (W) |
|-----|---------|---------------------|---------------|
| **H100 SXM** | 700 | 80% | 560 |
| **H100 PCIe** | 350 | 80% | 280 |
| **A100 SXM** | 400 | 80% | 320 |
| **A100 PCIe** | 300 | 80% | 240 |

#### Data Center PUE

| Provider/Region | PUE | Source |
|-----------------|-----|--------|
| **Hyperscaler average** | 1.1-1.2 | Provider reports |
| **Colocation average** | 1.3-1.5 | Industry benchmarks |
| **On-premise average** | 1.5-2.0 | Industry benchmarks |

### Training Tracking

#### Required Metrics

For each training run:
| Metric | Collection Method |
|--------|-------------------|
| GPU type | Cluster configuration |
| GPU hours | Job scheduler logs |
| Data center location | Cluster metadata |
| Time period | Job timestamps |

#### Aggregation

| Period | Aggregation |
|--------|-------------|
| Per run | Individual training job |
| Weekly | Development activity |
| Monthly | Reporting period |
| Annually | Annual report |

## Inference Emissions

### Calculation Methodology

#### Per-Request Emissions

**Formula**:
```
CO2e_request = E_request × EF_region / 1000
```

Where:
```
E_request = (GPU_power × latency_seconds) + memory_energy + network_energy
```

#### Estimation Approach

For large-scale inference:
```
CO2e_inference = Total_GPU_hours × GPU_power × PUE × EF_avg / 1000
```

### Efficiency Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **CO2e/1K tokens** | Emissions per 1,000 tokens | Track and reduce |
| **CO2e/request** | Emissions per API request | Track and reduce |
| **CO2e/MAU** | Emissions per monthly active user | Track and reduce |

### Geographic Distribution

Track inference by region:
| Region | % of Requests | Grid Factor | Weighted Factor |
|--------|---------------|-------------|-----------------|
| US-West | X% | 0.35 | Calculated |
| US-East | Y% | 0.42 | Calculated |
| EU | Z% | 0.28 | Calculated |
| Asia | W% | 0.50 | Calculated |

## Data & Emission Factors

### Grid Emission Factors

| Source | Coverage | Update Frequency |
|--------|----------|------------------|
| **EPA eGRID** | US regions | Annual |
| **EEA** | EU countries | Annual |
| **IEA** | Global | Annual |
| **Provider-specific** | Cloud providers | As published |

### Cloud Provider Data

| Provider | Data Available | Source |
|----------|---------------|--------|
| **AWS** | Region carbon intensity | AWS Customer Carbon Footprint Tool |
| **GCP** | Carbon-free energy % | Google Cloud Carbon Footprint |
| **Azure** | Emissions reporting | Microsoft Sustainability Calculator |

### Data Quality

| Level | Definition | Use |
|-------|------------|-----|
| **Primary** | Measured data | Preferred |
| **Secondary** | Provider-reported | Acceptable |
| **Tertiary** | Industry average | Gap-filling |

## Reporting Standards

### Internal Reporting

#### Monthly Dashboard

| Metric | Display |
|--------|---------|
| Total compute emissions | CO2e (tonnes) |
| Training vs inference split | % breakdown |
| YoY change | % change |
| Efficiency trend | CO2e/request over time |

#### Quarterly Report

| Section | Contents |
|---------|----------|
| Summary | Total emissions, trends |
| Training | Major training runs, emissions |
| Inference | Volume, efficiency |
| Initiatives | Reduction progress |

### External Reporting

#### Annual Disclosure

| Report | Contents |
|--------|----------|
| **ESG Report** | Summary metrics, targets |
| **CDP Response** | Detailed methodology |
| **Model Cards** | Per-model training emissions |

#### Model Card Emissions

For each model release:
```yaml
training_emissions:
  total_co2e_tonnes: X
  gpu_hours: Y
  energy_kwh: Z
  data_centers: [list]
  renewable_percentage: W%
  methodology: "HIP-251"
```

## Reduction Strategies

### Training Efficiency

| Strategy | Impact | Implementation |
|----------|--------|----------------|
| **Efficient architectures** | 10-50% reduction | Architecture research |
| **Mixed precision** | 30-50% speedup | Training configuration |
| **Gradient checkpointing** | Memory vs compute | Based on model size |
| **Curriculum learning** | 10-30% reduction | Training methodology |

### Inference Efficiency

| Strategy | Impact | Implementation |
|----------|--------|----------------|
| **Model quantization** | 2-4x efficiency | INT8/INT4 deployment |
| **Speculative decoding** | 2-3x speedup | Inference optimization |
| **Batching** | Improved utilization | Request aggregation |
| **Caching** | Variable | Response caching |

### Infrastructure

| Strategy | Impact | Implementation |
|----------|--------|----------------|
| **Green regions** | 30-90% reduction | Region selection |
| **Renewable PPAs** | Up to 100% reduction | Energy procurement |
| **Efficient hardware** | 20-50% per generation | Hardware refresh |
| **Cooling optimization** | PUE improvement | Data center ops |

## Targets

### Absolute Targets

| Year | Target | Baseline |
|------|--------|----------|
| 2025 | Establish baseline | Measure all emissions |
| 2027 | -30% vs baseline | Reduction |
| 2030 | Net zero | Reduction + offsets |

### Intensity Targets

| Year | CO2e/1K tokens | CO2e/request |
|------|----------------|--------------|
| 2025 | Baseline | Baseline |
| 2027 | -50% | -50% |
| 2030 | -80% | -80% |

### Renewable Energy

| Year | Renewable % |
|------|-------------|
| 2025 | 50% |
| 2027 | 80% |
| 2030 | 100% |

## Verification

### Internal Verification

| Activity | Frequency |
|----------|-----------|
| Data validation | Monthly |
| Calculation review | Quarterly |
| Methodology audit | Annual |

### External Verification

| Activity | Frequency | Standard |
|----------|-----------|----------|
| Third-party audit | Annual | ISO 14064-3 |
| CDP verification | Annual | CDP methodology |

## Related HIPs

- **HIP-200**: Responsible AI Principles
- **HIP-250**: Sustainability Standards Alignment
- **HIP-260**: Efficient Model Practices
- **HIP-270**: AI Supply Chain Responsibility
- **HIP-290**: Evidence Locker Index

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial draft |

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
