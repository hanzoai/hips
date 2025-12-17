---
hip: 270
title: AI Supply Chain Responsibility
tags: [sustainability, supply-chain, ethics, governance]
description: Framework for responsible sourcing of compute, hardware, and data for AI systems.
author: Hanzo AI Team (@hanzoai)
discussions-to: https://github.com/hanzoai/hips/discussions
status: Draft
type: Meta
created: 2025-12-17
requires: [200, 250]
---

# HIP-270: AI Supply Chain Responsibility

## Abstract

This HIP establishes the framework for responsible sourcing across Hanzo AI's supply chain, including compute infrastructure, hardware, data, and services. It defines standards for environmental, social, and governance criteria in supplier selection and ongoing management.

## Scope

### Supply Chain Categories

| Category | Components | ESG Relevance |
|----------|------------|---------------|
| **Compute** | Cloud providers, data centers | Energy, carbon, labor |
| **Hardware** | GPUs, servers, networking | Materials, labor, e-waste |
| **Data** | Training data, annotations | Privacy, labor, consent |
| **Services** | Software, consulting, contractors | Labor, security, ethics |

### Tier Classification

| Tier | Definition | Due Diligence Level |
|------|------------|---------------------|
| **Critical** | >$1M annual spend or core to operations | Full assessment |
| **Significant** | $100K-$1M annual spend | Standard assessment |
| **Standard** | <$100K annual spend | Basic assessment |

## Compute Sourcing

### Cloud Provider Standards

#### Environmental Criteria

| Criterion | Requirement | Weight |
|-----------|-------------|--------|
| **Renewable energy** | >50% renewable, trajectory to 100% | High |
| **Carbon reporting** | Public Scope 1, 2, 3 emissions | High |
| **PUE** | <1.3 average | Medium |
| **Water usage** | WUE reporting, reduction targets | Medium |
| **E-waste** | Responsible disposal, circularity | Medium |

#### Social Criteria

| Criterion | Requirement | Weight |
|-----------|-------------|--------|
| **Labor practices** | Fair labor certification | High |
| **Supply chain** | Conflict mineral due diligence | Medium |
| **Community impact** | Local hiring, engagement | Low |

#### Governance Criteria

| Criterion | Requirement | Weight |
|-----------|-------------|--------|
| **Security** | SOC 2 Type II, ISO 27001 | High |
| **Privacy** | GDPR compliance, data residency | High |
| **Business continuity** | Disaster recovery, SLAs | Medium |
| **Transparency** | Public sustainability reports | Medium |

### Provider Assessment

#### Current Provider Evaluation

| Provider | Renewable % | Carbon Neutral | PUE | Assessment |
|----------|-------------|----------------|-----|------------|
| AWS | 100% by 2025 | 2040 target | 1.2 | Acceptable |
| GCP | 100% matched | Carbon neutral | 1.1 | Preferred |
| Azure | 100% by 2025 | 2030 target | 1.2 | Acceptable |

#### Region Selection

Prioritize regions with:
1. Lowest carbon intensity
2. Highest renewable percentage
3. Acceptable latency
4. Data residency compliance

### Data Center Requirements

For colocation or owned infrastructure:

| Requirement | Standard |
|-------------|----------|
| Renewable energy | 100% or credible pathway |
| PUE | <1.4 |
| Water efficiency | WUE <1.0 L/kWh |
| Certifications | ISO 14001, ISO 50001 |
| Location | Climate-resilient, low-carbon grid |

## Hardware Sourcing

### GPU & Server Standards

#### Environmental Criteria

| Criterion | Requirement |
|-----------|-------------|
| **Manufacturer sustainability** | Public ESG commitments |
| **Energy efficiency** | Current generation, efficient design |
| **Conflict minerals** | Conflict-free sourcing certification |
| **Packaging** | Minimal, recyclable packaging |

#### Social Criteria

| Criterion | Requirement |
|-----------|-------------|
| **Labor practices** | RBA (Responsible Business Alliance) membership |
| **Supply chain audits** | Third-party labor audits |
| **Health & safety** | Documented H&S programs |

### Hardware Lifecycle

#### Procurement

| Practice | Implementation |
|----------|----------------|
| **Right-sizing** | Match hardware to actual needs |
| **Consolidation** | Shared resources where possible |
| **Efficiency focus** | Latest generation for efficiency |

#### Operation

| Practice | Implementation |
|----------|----------------|
| **Utilization tracking** | Monitor and optimize usage |
| **Maintenance** | Proper maintenance for longevity |
| **Lifecycle planning** | Plan refresh cycles |

#### End-of-Life

| Practice | Implementation |
|----------|----------------|
| **Reuse** | Internal redeployment first |
| **Resale** | Certified resale for working equipment |
| **Recycling** | R2/e-Stewards certified recyclers |
| **Data destruction** | Certified data destruction |

## Data Sourcing

### Training Data Standards

#### Consent & Rights

| Requirement | Standard |
|-------------|----------|
| **Licensing** | Clear commercial use rights |
| **Consent** | Appropriate consent for personal data |
| **Attribution** | Proper attribution where required |
| **Opt-out** | Respect opt-out requests |

#### Quality & Ethics

| Requirement | Standard |
|-------------|----------|
| **No stolen content** | Due diligence on data sources |
| **No illegal content** | Filtering for illegal material |
| **Bias review** | Assessment of representation |
| **Privacy protection** | PII handling procedures |

### Annotation & Labeling

#### Labor Standards

| Requirement | Standard |
|-------------|----------|
| **Fair wages** | Living wage in local context |
| **Working conditions** | Reasonable hours, breaks |
| **Worker wellbeing** | Support for disturbing content |
| **Transparency** | Disclosed labor practices |

#### Provider Assessment

| Criterion | Evaluation |
|-----------|------------|
| **Wage verification** | Third-party or self-reported |
| **Conditions audit** | Annual assessment |
| **Worker feedback** | Grievance mechanisms |
| **Certifications** | B Corp, Fair Trade, or equivalent |

### Data Provider Selection

| Tier | Due Diligence |
|------|---------------|
| **Primary** | Full assessment, ongoing monitoring |
| **Secondary** | Standard assessment, periodic review |
| **Incidental** | Basic assessment, terms review |

## Services & Contractors

### Software & Services

| Category | ESG Criteria |
|----------|--------------|
| **SaaS** | Security, privacy, accessibility |
| **Consulting** | Labor practices, D&I |
| **Contractors** | Fair treatment, proper classification |

### Contractor Standards

| Requirement | Standard |
|-------------|----------|
| **Classification** | Proper employee/contractor classification |
| **Benefits** | Appropriate benefits for relationship |
| **Payment** | Timely, fair payment |
| **Conditions** | Reasonable working conditions |

## Supplier Management

### Assessment Process

#### Initial Assessment

```
1. Categorize by tier
    ↓
2. Complete assessment questionnaire
    ↓
3. Review publicly available information
    ↓
4. Conduct due diligence (tier-appropriate)
    ↓
5. Score against criteria
    ↓
6. Make selection decision
```

#### Ongoing Monitoring

| Activity | Frequency | Tier |
|----------|-----------|------|
| **Performance review** | Quarterly | Critical |
| **ESG review** | Annual | Critical, Significant |
| **News monitoring** | Continuous | Critical |
| **Re-assessment** | Biennial | All |

### Supplier Scorecard

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| **Environmental** | 30% | Carbon, energy, waste |
| **Social** | 30% | Labor, community, safety |
| **Governance** | 20% | Ethics, transparency, security |
| **Performance** | 20% | Quality, reliability, cost |

### Issue Management

#### Issue Severity

| Severity | Examples | Response |
|----------|----------|----------|
| **Critical** | Human rights violation, major breach | Immediate suspension |
| **High** | Labor violations, significant ESG failure | Remediation plan |
| **Medium** | Policy gaps, minor violations | Improvement plan |
| **Low** | Documentation gaps, minor issues | Noted for improvement |

#### Remediation Process

```
Issue identified
    ↓
Severity assessment
    ↓
Supplier notification
    ↓
Remediation plan development
    ↓
Implementation monitoring
    ↓
Verification
    ↓
Closure or escalation
```

### Termination Criteria

Automatic termination consideration for:
- Verified human rights violations
- Severe environmental damage
- Material fraud or corruption
- Failure to remediate critical issues

## Reporting & Transparency

### Internal Reporting

| Report | Frequency | Contents |
|--------|-----------|----------|
| **Supplier dashboard** | Real-time | Key supplier metrics |
| **Quarterly review** | Quarterly | Performance, issues, actions |
| **Annual assessment** | Annual | Full supplier ESG review |

### External Reporting

| Disclosure | Location | Contents |
|------------|----------|----------|
| **Annual ESG report** | Public report | Supply chain summary |
| **CDP Supply Chain** | CDP platform | Detailed supplier data |
| **Website** | Company website | Supplier standards |

### Transparency Commitments

| Commitment | Implementation |
|------------|----------------|
| **Standards publication** | Public supplier code |
| **Issue disclosure** | Material issues in ESG report |
| **Progress reporting** | Annual improvement tracking |

## Governance

### Oversight Structure

| Body | Role |
|------|------|
| **Procurement Lead** | Day-to-day management |
| **ESG Committee** | Policy oversight |
| **Legal** | Compliance, contracts |
| **Finance** | Spend analysis |

### Policy Review

| Activity | Frequency |
|----------|-----------|
| **Standards review** | Annual |
| **Criteria update** | As needed |
| **Process improvement** | Continuous |

## Related HIPs

- **HIP-200**: Responsible AI Principles
- **HIP-250**: Sustainability Standards Alignment
- **HIP-251**: AI Compute Carbon Footprint
- **HIP-260**: Efficient Model Practices
- **HIP-290**: Evidence Locker Index

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial draft |

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
