---
hip: 260
title: Efficient Model Practices
tags: [sustainability, efficiency, optimization, energy]
description: Best practices for developing and deploying energy-efficient AI models.
author: Hanzo AI Team (@hanzoai)
discussions-to: https://github.com/hanzoai/hips/discussions
status: Draft
type: Meta
created: 2025-12-17
requires: [200, 250, 251]
---

# HIP-260: Efficient Model Practices

## Abstract

This HIP establishes best practices for developing and deploying energy-efficient AI models at Hanzo AI. It covers architecture decisions, training optimizations, inference efficiency, and operational practices that reduce environmental impact while maintaining capability.

## Efficiency Principles

### Guiding Principles

1. **Right-size models**: Use smallest model that meets requirements
2. **Optimize before scale**: Efficiency improvements before scaling compute
3. **Measure continuously**: Track energy and efficiency metrics
4. **Share learnings**: Document and share efficiency improvements
5. **Balance trade-offs**: Consider efficiency in capability decisions

### Efficiency Hierarchy

```
1. Avoid unnecessary computation
2. Reduce computation needed
3. Make computation more efficient
4. Use clean energy for remaining computation
5. Offset residual emissions
```

## Training Efficiency

### Architecture Design

#### Efficient Architectures

| Technique | Benefit | Trade-off |
|-----------|---------|-----------|
| **Sparse attention** | O(n) vs O(n²) | Some quality loss |
| **Linear attention** | Lower complexity | Limited context |
| **Mixture of Experts** | Conditional compute | Complexity |
| **Parameter sharing** | Smaller models | Some quality loss |

#### Architecture Guidelines

| Guideline | Rationale |
|-----------|-----------|
| Start small | Prove approach before scaling |
| Test efficiency | Measure before committing |
| Consider alternatives | Evaluate efficient variants |
| Document choices | Record efficiency trade-offs |

### Training Optimizations

#### Compute Efficiency

| Technique | Implementation | Benefit |
|-----------|----------------|---------|
| **Mixed precision (BF16/FP16)** | Default for all training | 2x memory, ~1.5x speed |
| **Gradient checkpointing** | For memory-limited | 3-4x memory reduction |
| **Flash Attention** | Default for transformers | 2-4x attention speedup |
| **Fused kernels** | Use optimized libraries | 10-30% speedup |

#### Data Efficiency

| Technique | Implementation | Benefit |
|-----------|----------------|---------|
| **Data deduplication** | Preprocessing | Better quality per token |
| **Quality filtering** | Curation pipeline | Fewer tokens needed |
| **Curriculum learning** | Easy to hard | Faster convergence |
| **Active learning** | Targeted data collection | Less data needed |

#### Training Strategies

| Strategy | Implementation | Benefit |
|----------|----------------|---------|
| **Learning rate scheduling** | Cosine with warmup | Faster convergence |
| **Early stopping** | Validation monitoring | Avoid overtraining |
| **Checkpoint averaging** | Average best checkpoints | Better final model |
| **Hyperparameter tuning** | Systematic search | Optimal efficiency |

### Training Process Requirements

#### Pre-Training Checklist

| Item | Verification |
|------|--------------|
| ☐ Baseline efficiency established | Measured baseline metrics |
| ☐ Efficiency techniques applied | All applicable techniques |
| ☐ Hardware utilization planned | GPU utilization >80% target |
| ☐ Energy tracking configured | Monitoring in place |

#### During Training

| Metric | Target | Action if Below |
|--------|--------|-----------------|
| GPU utilization | >80% | Optimize batching |
| Memory utilization | >70% | Adjust batch size |
| Training loss curve | Expected descent | Investigate, adjust |

## Inference Efficiency

### Model Optimization

#### Quantization

| Level | Format | Use Case | Quality Impact |
|-------|--------|----------|----------------|
| **FP16** | Half precision | Default deployment | Minimal |
| **INT8** | 8-bit integer | Production | 0-2% quality loss |
| **INT4** | 4-bit integer | Edge/cost-sensitive | 2-5% quality loss |
| **GPTQ/AWQ** | Advanced quant | Best quality at low bits | <2% typically |

#### Model Compression

| Technique | Reduction | Quality Impact |
|-----------|-----------|----------------|
| **Pruning** | 30-50% parameters | 1-3% quality loss |
| **Knowledge distillation** | 2-10x smaller | Variable |
| **Low-rank factorization** | 20-40% reduction | 1-2% quality loss |

### Inference Optimizations

#### Batching

| Strategy | Use Case | Benefit |
|----------|----------|---------|
| **Dynamic batching** | API serving | Better utilization |
| **Continuous batching** | LLM serving | Higher throughput |
| **Request coalescing** | Similar requests | Efficiency gain |

#### Caching

| Cache Type | Implementation | Benefit |
|------------|----------------|---------|
| **KV cache** | Standard for LLMs | Required for efficiency |
| **Response cache** | Exact match cache | Avoid recomputation |
| **Semantic cache** | Similar query cache | Reduce redundant work |

#### Speculative Decoding

| Technique | Implementation | Benefit |
|-----------|----------------|---------|
| **Draft model** | Small model proposes | 2-3x speedup |
| **Self-speculative** | Same model, different depth | 1.5-2x speedup |
| **Medusa heads** | Multiple prediction heads | 2-3x speedup |

### Serving Infrastructure

#### Request Routing

| Strategy | Implementation | Benefit |
|----------|----------------|---------|
| **Model selection** | Route to appropriate model | Use smallest sufficient |
| **Complexity estimation** | Assess request complexity | Match model to need |
| **Load balancing** | Efficient distribution | Better utilization |

#### Scaling

| Strategy | Implementation | Benefit |
|----------|----------------|---------|
| **Horizontal scaling** | Add instances | Handle load |
| **Vertical scaling** | Better hardware | Efficiency per request |
| **Auto-scaling** | Demand-based | Avoid idle compute |

## Operational Efficiency

### Compute Scheduling

#### Time-Based Scheduling

| Strategy | Implementation | Benefit |
|----------|----------------|---------|
| **Off-peak training** | Schedule for low-carbon hours | Lower emissions |
| **Batch processing** | Aggregate non-urgent work | Better utilization |
| **Preemptible instances** | Use spot/preemptible | Lower cost/emissions |

#### Location-Based Scheduling

| Strategy | Implementation | Benefit |
|----------|----------------|---------|
| **Green region preference** | Route to clean grids | Lower emissions |
| **Carbon-aware scheduling** | Real-time carbon intensity | Optimal timing |
| **Follow-the-sun** | Move work to clean regions | Maximize renewables |

### Hardware Efficiency

#### Hardware Selection

| Factor | Consideration |
|--------|---------------|
| **Latest generation** | 20-50% efficiency gain per generation |
| **Right-sized** | Match hardware to workload |
| **Utilization** | Shared resources where appropriate |

#### Hardware Lifecycle

| Practice | Implementation |
|----------|----------------|
| **Refresh cycles** | Plan efficient hardware upgrades |
| **Utilization targets** | Maintain >70% average utilization |
| **End-of-life** | Responsible recycling/resale |

### Development Practices

#### Experiment Efficiency

| Practice | Implementation |
|----------|----------------|
| **Small-scale first** | Test on small data/models first |
| **Ablation studies** | Systematic, efficient experiments |
| **Negative result tracking** | Avoid repeating failed experiments |
| **Experiment tracking** | Log all runs to avoid duplicates |

#### Code Efficiency

| Practice | Implementation |
|----------|----------------|
| **Profiling** | Identify bottlenecks |
| **Optimized libraries** | Use best implementations |
| **Batch operations** | Vectorize where possible |
| **Memory management** | Avoid unnecessary allocations |

## Metrics & Monitoring

### Efficiency Metrics

#### Training Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **FLOPS/token** | Compute per token | Track and reduce |
| **Samples/GPU-hour** | Training throughput | Maximize |
| **GPU utilization** | Compute usage | >80% |
| **Time to result** | Training duration | Minimize |

#### Inference Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Tokens/second/GPU** | Throughput | Maximize |
| **Latency (p50, p99)** | Response time | Per SLA |
| **CO2e/1K tokens** | Carbon intensity | Minimize |
| **Requests/watt** | Energy efficiency | Track and improve |

### Monitoring Dashboard

| Panel | Contents |
|-------|----------|
| **Efficiency overview** | Key efficiency metrics |
| **Training efficiency** | Current training jobs |
| **Inference efficiency** | Serving metrics |
| **Carbon intensity** | Real-time carbon metrics |
| **Trends** | Efficiency over time |

### Reporting

| Report | Frequency | Contents |
|--------|-----------|----------|
| **Efficiency digest** | Weekly | Key metrics, anomalies |
| **Optimization opportunities** | Monthly | Identified improvements |
| **Efficiency review** | Quarterly | Progress, initiatives |

## Implementation Requirements

### New Model Development

| Phase | Efficiency Requirement |
|-------|------------------------|
| **Design** | Efficiency consideration in architecture |
| **Training** | Efficiency techniques applied |
| **Evaluation** | Efficiency metrics measured |
| **Deployment** | Optimization before deployment |

### Model Deployment

| Requirement | Verification |
|-------------|--------------|
| Quantization evaluated | Documented quality vs. efficiency trade-off |
| Serving optimized | Batching, caching implemented |
| Monitoring configured | Efficiency metrics tracked |
| Right-sized deployment | Hardware matches workload |

### Continuous Improvement

| Activity | Frequency |
|----------|-----------|
| Efficiency benchmarking | Monthly |
| Technique evaluation | Quarterly |
| Hardware assessment | Annual |
| Process review | Annual |

## Related HIPs

- **HIP-200**: Responsible AI Principles
- **HIP-250**: Sustainability Standards Alignment
- **HIP-251**: AI Compute Carbon Footprint
- **HIP-270**: AI Supply Chain Responsibility

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial draft |

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
