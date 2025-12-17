---
hip: 220
title: Bias Detection & Mitigation
tags: [ai-ethics, fairness, bias, evaluation]
description: Framework for detecting, measuring, and mitigating bias in AI systems.
author: Hanzo AI Team (@hanzoai)
discussions-to: https://github.com/hanzoai/hips/discussions
status: Draft
type: Meta
created: 2025-12-17
requires: [200, 201]
---

# HIP-220: Bias Detection & Mitigation

## Abstract

This HIP establishes the framework for detecting, measuring, and mitigating bias in Hanzo AI systems. It defines bias categories, evaluation methodologies, fairness metrics, and remediation processes to ensure AI systems treat all users equitably.

## Bias Framework

### Definitions

**Algorithmic bias**: Systematic and repeatable errors in a computer system that create unfair outcomes for certain groups.

**Fairness**: The principle that AI systems should treat individuals and groups equitably, without discrimination based on protected characteristics.

### Protected Characteristics

| Category | Characteristics |
|----------|-----------------|
| **Demographic** | Race, ethnicity, nationality, religion |
| **Personal** | Age, gender, sexual orientation, disability |
| **Socioeconomic** | Income, education, occupation |
| **Geographic** | Region, urban/rural, language |

### Bias Types

#### Pre-existing Bias

| Type | Source | Example |
|------|--------|---------|
| **Historical** | Past discrimination in data | Hiring data reflecting past discrimination |
| **Representation** | Underrepresentation in data | Fewer examples of certain groups |
| **Measurement** | How data is collected | Sensors less accurate for certain skin tones |

#### Technical Bias

| Type | Source | Example |
|------|--------|---------|
| **Aggregation** | One-size-fits-all models | Medical model trained primarily on one population |
| **Learning** | Algorithm amplification | Feedback loops reinforcing initial bias |
| **Evaluation** | Biased benchmarks | Test sets not representative |

#### Emergent Bias

| Type | Source | Example |
|------|--------|---------|
| **Deployment** | Context mismatch | Model used in unintended population |
| **Interaction** | User behavior patterns | Different usage across groups |
| **Temporal** | Changing contexts | Society changes, model doesn't |

## Bias Detection

### Detection Methods

#### Quantitative Analysis

| Method | Application | Tools |
|--------|-------------|-------|
| **Demographic parity** | Equal prediction rates | Statistical analysis |
| **Equalized odds** | Equal TPR/FPR across groups | Fairlearn |
| **Calibration** | Consistent probability meaning | Reliability diagrams |
| **Individual fairness** | Similar treatment for similar individuals | Distance metrics |

#### Qualitative Analysis

| Method | Application | Approach |
|--------|-------------|----------|
| **Output auditing** | Review generated content | Human evaluation |
| **Prompt testing** | Test with demographic markers | Structured prompts |
| **User studies** | Perception of fairness | Surveys, interviews |

### Evaluation Datasets

#### Standard Benchmarks

| Benchmark | Bias Type | Metrics |
|-----------|-----------|---------|
| **WinoBias** | Gender | Accuracy parity |
| **StereoSet** | Stereotype | Language model score |
| **CrowS-Pairs** | Multiple | Preference score |
| **BBQ** | Social bias | Accuracy in ambiguous contexts |

#### Custom Evaluation Sets

| Dataset | Coverage | Size |
|---------|----------|------|
| **Hanzo-Bias-1K** | Multi-category bias probes | 1,000+ |
| **Regional-Fairness** | Geographic/cultural bias | 500+ |
| **Intersectional-Set** | Intersecting identities | 300+ |

### Audit Process

#### Pre-Deployment Audit

```
1. Define evaluation scope (groups, use cases)
    ↓
2. Select appropriate metrics
    ↓
3. Run quantitative evaluation
    ↓
4. Conduct qualitative review
    ↓
5. Document findings
    ↓
6. Determine if thresholds met
```

#### Ongoing Monitoring

| Activity | Frequency | Scope |
|----------|-----------|-------|
| **Automated metrics** | Weekly | Key fairness metrics |
| **Sample audits** | Monthly | Human review sample |
| **Full audit** | Quarterly | Comprehensive evaluation |

## Fairness Metrics

### Group Fairness Metrics

#### Demographic Parity

**Definition**: Prediction rates equal across groups

**Formula**:
```
P(Ŷ=1|A=a) = P(Ŷ=1|A=b) for all groups a, b
```

**Threshold**: <10% difference across groups

#### Equalized Odds

**Definition**: Equal true positive and false positive rates across groups

**Formulas**:
```
P(Ŷ=1|Y=1,A=a) = P(Ŷ=1|Y=1,A=b)  (Equal TPR)
P(Ŷ=1|Y=0,A=a) = P(Ŷ=1|Y=0,A=b)  (Equal FPR)
```

**Threshold**: <15% difference in TPR, <10% difference in FPR

#### Predictive Parity

**Definition**: Equal precision across groups

**Formula**:
```
P(Y=1|Ŷ=1,A=a) = P(Y=1|Ŷ=1,A=b)
```

**Threshold**: <10% difference across groups

### Individual Fairness Metrics

#### Consistency

**Definition**: Similar individuals receive similar treatment

**Formula**:
```
|f(x) - f(x')| ≤ d(x, x') for similar x, x'
```

### Language Model Metrics

#### Stereotype Score

**Definition**: Tendency to associate groups with stereotypes

**Measurement**: Compare likelihood of stereotypical vs. anti-stereotypical completions

**Target**: Score ≈ 50% (no preference)

#### Representation Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Mention parity** | Equal mention rates | Within 20% |
| **Sentiment parity** | Equal sentiment | No significant difference |
| **Association** | Co-occurrence patterns | No stereotypical clustering |

### Intersectional Analysis

Analyze bias at intersection of multiple characteristics:

| Intersection | Analysis |
|--------------|----------|
| **Gender × Race** | Check for compounded bias |
| **Age × Disability** | Assess unique patterns |
| **Region × Language** | Cultural intersections |

## Mitigation Strategies

### Pre-Training Mitigations

| Strategy | Application |
|----------|-------------|
| **Data balancing** | Ensure representative training data |
| **Data augmentation** | Add underrepresented examples |
| **Data filtering** | Remove biased content |
| **Source diversification** | Include diverse data sources |

### Training Mitigations

| Strategy | Application |
|----------|-------------|
| **Debiasing techniques** | RLHF, constitutional AI |
| **Regularization** | Fairness constraints in loss |
| **Adversarial training** | Train against bias detectors |
| **Multi-task learning** | Include fairness objectives |

### Post-Training Mitigations

| Strategy | Application |
|----------|-------------|
| **Output filtering** | Flag biased outputs |
| **Calibration** | Adjust outputs for fairness |
| **Prompt engineering** | Include fairness instructions |
| **Human review** | Manual review of sensitive outputs |

### Deployment Mitigations

| Strategy | Application |
|----------|-------------|
| **Use case restrictions** | Limit high-risk applications |
| **User warnings** | Inform users of limitations |
| **Feedback loops** | Collect bias reports |
| **A/B testing** | Test mitigation effectiveness |

## Implementation

### Bias Review Process

#### New Model Review

```
1. Complete bias assessment questionnaire
    ↓
2. Run standard benchmark suite
    ↓
3. Conduct demographic analysis
    ↓
4. Document known limitations
    ↓
5. Implement mitigations
    ↓
6. Verify mitigation effectiveness
    ↓
7. Obtain fairness sign-off
```

#### Periodic Review

| Activity | Frequency | Owner |
|----------|-----------|-------|
| **Metric monitoring** | Weekly | MRM Team |
| **Benchmark re-run** | Monthly | Safety Team |
| **Full audit** | Quarterly | External + Internal |
| **Process review** | Annual | ESG Committee |

### Documentation Requirements

#### Fairness Card

| Section | Contents |
|---------|----------|
| **Groups evaluated** | Demographic breakdown |
| **Metrics used** | Fairness metrics applied |
| **Results** | Metric values by group |
| **Known limitations** | Identified bias patterns |
| **Mitigations applied** | Steps taken to address |

### Threshold Standards

| Model Risk Tier | Demographic Parity | Equalized Odds |
|-----------------|-------------------|----------------|
| **Critical** | <5% difference | <10% difference |
| **High** | <10% difference | <15% difference |
| **Medium** | <15% difference | <20% difference |
| **Low** | <20% difference | <25% difference |

## Governance

### Fairness Oversight

| Body | Role |
|------|------|
| **Fairness Lead** | Day-to-day oversight |
| **Safety Team** | Evaluation execution |
| **ESG Committee** | Policy and escalations |
| **External Board** | Independent review |

### Escalation Process

| Trigger | Escalation |
|---------|------------|
| **Threshold violation** | Fairness Lead → MRM Lead |
| **User complaint** | Support → Fairness Lead |
| **External report** | Communications → ESG Committee |
| **Regulatory inquiry** | Legal → Board |

### Continuous Improvement

- Track bias metrics over model versions
- Research new evaluation methods
- Engage with fairness research community
- Update thresholds based on capabilities

## Related HIPs

- **HIP-200**: Responsible AI Principles
- **HIP-201**: Model Risk Management
- **HIP-210**: Safety Evaluation Framework
- **HIP-230**: AI Transparency & Explainability
- **HIP-240**: AI Incident Response

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial draft |

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
