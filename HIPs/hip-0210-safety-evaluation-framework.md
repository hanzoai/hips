---
hip: 210
title: Safety Evaluation Framework
tags: [ai-ethics, safety, evaluation, testing]
description: Framework for evaluating AI system safety through comprehensive testing and red teaming.
author: Hanzo AI Team (@hanzoai)
discussions-to: https://github.com/hanzoai/hips/discussions
status: Draft
type: Meta
created: 2025-12-17
requires: [200, 201]
---

# HIP-210: Safety Evaluation Framework

## Abstract

This HIP establishes the safety evaluation framework for Hanzo AI systems. It defines testing methodologies, evaluation criteria, red teaming processes, and safety benchmarks required before model deployment.

## Safety Evaluation Overview

### Objectives

1. **Identify harms**: Discover potential harmful behaviors
2. **Measure severity**: Quantify harm potential
3. **Verify mitigations**: Confirm safety measures work
4. **Track progress**: Monitor safety over time
5. **Enable comparison**: Benchmark against standards

### Evaluation Types

| Type | Purpose | When |
|------|---------|------|
| **Automated testing** | Scalable coverage | Continuous |
| **Human evaluation** | Nuanced assessment | Milestone |
| **Red teaming** | Adversarial probing | Pre-deployment |
| **External audit** | Independent validation | Annual |

## Harm Taxonomy

### Harm Categories

#### Content Harms

| Category | Examples | Severity |
|----------|----------|----------|
| **Violence** | Instructions for violence, glorification | Critical |
| **CSAM** | Any CSAM generation or facilitation | Critical |
| **Hate speech** | Slurs, dehumanization, discrimination | High |
| **Self-harm** | Suicide methods, eating disorder promotion | High |
| **Sexual content** | Non-consensual, inappropriate contexts | High |
| **Harassment** | Targeted abuse, doxxing | High |

#### Deception Harms

| Category | Examples | Severity |
|----------|----------|----------|
| **Misinformation** | False claims presented as fact | High |
| **Manipulation** | Psychological manipulation | High |
| **Fraud facilitation** | Scam scripts, phishing | High |
| **Impersonation** | False identity claims | Medium |

#### Security Harms

| Category | Examples | Severity |
|----------|----------|----------|
| **Cyberweapons** | Malware, exploits | Critical |
| **CBRN** | Chemical, biological, nuclear info | Critical |
| **Weapons** | Weapons manufacturing | Critical |
| **Privacy violations** | PII exposure, surveillance | High |

#### Societal Harms

| Category | Examples | Severity |
|----------|----------|----------|
| **Election interference** | Voter suppression, disinformation | Critical |
| **Radicalization** | Extremist content | High |
| **Economic harm** | Market manipulation advice | Medium |

### Severity Levels

| Level | Definition | Response |
|-------|------------|----------|
| **Critical** | Immediate physical harm or illegal | Block deployment |
| **High** | Significant harm potential | Remediation required |
| **Medium** | Moderate harm, context-dependent | Mitigation recommended |
| **Low** | Minor issues, edge cases | Monitor and improve |

## Automated Evaluation

### Safety Benchmarks

#### Standard Benchmarks

| Benchmark | Coverage | Metrics |
|-----------|----------|---------|
| **ToxiGen** | Toxicity detection | F1, precision, recall |
| **RealToxicityPrompts** | Generation toxicity | Toxicity rate |
| **WinoBias** | Gender bias | Accuracy parity |
| **BBQ** | Social bias | Disambiguation accuracy |
| **TruthfulQA** | Truthfulness | MC accuracy |

#### Custom Benchmarks

| Benchmark | Coverage | Metrics |
|-----------|----------|---------|
| **Hanzo-Safety-1K** | Multi-harm coverage | Refusal rate, harm rate |
| **Jailbreak-Eval** | Prompt injection resistance | Success rate |
| **PII-Detection** | Privacy protection | Detection F1 |

### Automated Testing Pipeline

```
Input prompts (adversarial + benign)
    ↓
Model generation
    ↓
Classifier scoring (toxicity, harm type)
    ↓
Threshold checking
    ↓
Report generation
```

### Thresholds

| Metric | Threshold | Action if Failed |
|--------|-----------|------------------|
| **Toxicity rate** | <1% on benign prompts | Block deployment |
| **Jailbreak success** | <5% on known attacks | Remediation |
| **PII leakage** | 0% on test set | Block deployment |
| **Refusal accuracy** | >95% on harmful requests | Remediation |

## Human Evaluation

### Evaluator Requirements

| Requirement | Details |
|-------------|---------|
| **Training** | Safety evaluation training (HIP-200 overview) |
| **Background checks** | For sensitive content evaluation |
| **Psychological support** | Access to counseling |
| **Rotation** | Limit exposure to harmful content |

### Evaluation Protocol

#### Rating Scale

| Rating | Definition |
|--------|------------|
| **1 - Safe** | No safety concerns |
| **2 - Minor** | Slight issues, acceptable |
| **3 - Moderate** | Concerning but not severe |
| **4 - High** | Significant safety concern |
| **5 - Critical** | Immediate harm potential |

#### Evaluation Criteria

| Criterion | Question |
|-----------|----------|
| **Harmfulness** | Could this output cause harm? |
| **Helpfulness** | Does this appropriately assist the user? |
| **Honesty** | Is this truthful and accurate? |
| **Appropriateness** | Is this suitable for the context? |

#### Sample Size

| Evaluation Type | Minimum Samples | Evaluators |
|-----------------|-----------------|------------|
| **Pre-deployment** | 5,000 | 3 per sample |
| **Periodic review** | 1,000 | 2 per sample |
| **Incident response** | As needed | 3 per sample |

### Inter-Rater Reliability

| Metric | Target |
|--------|--------|
| **Krippendorff's α** | >0.8 |
| **Cohen's κ** | >0.7 |
| **Agreement rate** | >90% on Critical ratings |

## Red Teaming

### Red Team Structure

#### Internal Red Team

| Role | Focus |
|------|-------|
| **Safety researchers** | Known attack patterns |
| **Domain experts** | Domain-specific harms |
| **Adversarial ML specialists** | Technical attacks |

#### External Red Team

| Partner | Purpose |
|---------|---------|
| **Security researchers** | Novel attack discovery |
| **Domain experts** | Specialized knowledge |
| **Academic partners** | Research collaboration |

### Red Team Methodology

#### Attack Categories

| Category | Techniques |
|----------|------------|
| **Prompt injection** | Jailbreaks, role-play attacks |
| **Context manipulation** | Multi-turn attacks, persona switching |
| **Encoding attacks** | Base64, translation, cipher |
| **Social engineering** | Persuasion, authority claims |
| **Technical attacks** | Adversarial inputs, token manipulation |

#### Red Team Process

```
1. Scoping (define attack surface)
    ↓
2. Reconnaissance (understand model behavior)
    ↓
3. Attack development (create test cases)
    ↓
4. Execution (run attacks)
    ↓
5. Documentation (record findings)
    ↓
6. Remediation (develop fixes)
    ↓
7. Verification (confirm fixes work)
```

### Red Team Reporting

| Section | Contents |
|---------|----------|
| **Executive summary** | Key findings, risk assessment |
| **Methodology** | Approaches used, scope |
| **Findings** | Detailed vulnerability list |
| **Severity ratings** | Per finding |
| **Recommendations** | Suggested mitigations |
| **Appendix** | Test cases, evidence |

### Red Team Cadence

| Trigger | Red Team Activity |
|---------|-------------------|
| **New model** | Full red team before deployment |
| **Major update** | Focused red team on changes |
| **Quarterly** | Routine assessment |
| **Incident** | Investigation and expanded testing |

## Safety Metrics

### Primary Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Harm rate** | % outputs rated as harmful | <0.1% |
| **Refusal appropriateness** | % correct refusals | >98% |
| **Over-refusal rate** | % incorrect refusals | <5% |
| **Jailbreak resistance** | % attacks blocked | >95% |

### Derived Metrics

| Metric | Calculation |
|--------|-------------|
| **Safety score** | Weighted composite of primary metrics |
| **Risk exposure** | Harm rate × severity × volume |
| **Defense depth** | Layers of protection passed |

### Trend Monitoring

Track over time:
- Safety metrics by model version
- Attack success rates
- Incident frequency
- Time to remediation

## Evaluation Governance

### Evaluation Independence

- Safety evaluation team independent from development
- Separate reporting line to ESG Committee
- Authority to block deployment

### Review Process

| Stage | Review |
|-------|--------|
| **Pre-training** | Safety objectives review |
| **Post-training** | Initial safety evaluation |
| **Pre-deployment** | Full safety review |
| **Post-deployment** | Ongoing monitoring |

### Sign-Off Requirements

| Risk Tier | Sign-Off |
|-----------|----------|
| **Critical** | Board + external review |
| **High** | ESG Committee |
| **Medium** | Safety Lead |
| **Low** | Team Lead |

## External Validation

### Third-Party Audits

**Frequency**: Annual for high-risk models

**Scope**:
- Methodology review
- Independent testing
- Process assessment
- Recommendations

### Academic Collaboration

- Share evaluation methodologies
- Participate in benchmark development
- Publish safety research
- Host safety workshops

### Regulatory Alignment

| Regulation | Alignment |
|------------|-----------|
| **EU AI Act** | High-risk system requirements |
| **NIST AI RMF** | MEASURE function |
| **ISO/IEC 42001** | Performance evaluation |

## Related HIPs

- **HIP-200**: Responsible AI Principles
- **HIP-201**: Model Risk Management
- **HIP-220**: Bias Detection & Mitigation
- **HIP-230**: AI Transparency & Explainability
- **HIP-240**: AI Incident Response

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial draft |

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
