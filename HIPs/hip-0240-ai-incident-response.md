---
hip: 240
title: AI Incident Response
tags: [ai-ethics, safety, incident-response, governance]
description: Framework for responding to AI safety and ethics incidents.
author: Hanzo AI Team (@hanzoai)
discussions-to: https://github.com/hanzoai/hips/discussions
status: Draft
type: Meta
created: 2025-12-17
requires: [200, 201]
---

# HIP-240: AI Incident Response

## Abstract

This HIP establishes the incident response framework for AI safety and ethics incidents at Hanzo AI. It defines incident categories, response procedures, communication protocols, and post-incident review processes.

## Incident Definition

### What Constitutes an AI Incident

An AI incident is any event where an AI system:
1. Causes or could cause harm to users or third parties
2. Behaves in unexpected or unintended ways
3. Violates safety guidelines or policies
4. Experiences a significant failure affecting trust or safety
5. Is subject to successful adversarial attack

### Incident Categories

#### Safety Incidents

| Category | Examples |
|----------|----------|
| **Harmful output** | Generated dangerous, illegal, or harmful content |
| **Safety bypass** | Successful jailbreak or guardrail circumvention |
| **Misuse** | System used for malicious purposes |
| **Unintended capability** | System displays unexpected capabilities |

#### Performance Incidents

| Category | Examples |
|----------|----------|
| **Quality degradation** | Significant accuracy decrease |
| **Hallucination spike** | Increased false information |
| **Availability failure** | Service outage or degradation |
| **Latency issues** | Unacceptable response times |

#### Fairness Incidents

| Category | Examples |
|----------|----------|
| **Bias detection** | Systematic bias discovered |
| **Discrimination** | Unfair treatment of user groups |
| **Exclusion** | Groups unable to use service |

#### Security Incidents

| Category | Examples |
|----------|----------|
| **Data breach** | Training data or user data exposed |
| **Model theft** | Unauthorized model extraction |
| **Adversarial attack** | Successful attack on model |
| **Prompt injection** | System manipulation via inputs |

## Incident Severity

### Severity Levels

| Level | Definition | Examples |
|-------|------------|----------|
| **Critical (P0)** | Immediate, severe harm potential | CSAM generation, weapons instructions, mass harm |
| **High (P1)** | Significant harm or widespread impact | Widespread harmful content, major bias issue |
| **Medium (P2)** | Moderate harm or limited impact | Isolated harmful outputs, localized issues |
| **Low (P3)** | Minor issues, low harm potential | Edge cases, minor quality issues |

### Severity Determination

| Factor | Considerations |
|--------|----------------|
| **Harm potential** | Type and severity of possible harm |
| **Scope** | Number of users affected |
| **Reversibility** | Can harm be undone? |
| **Exploitability** | How easily can this be reproduced? |
| **Visibility** | Public awareness level |

## Response Procedures

### Incident Response Phases

```
Detection → Triage → Containment → Investigation → Remediation → Recovery → Review
```

### Phase 1: Detection

#### Detection Sources

| Source | Examples |
|--------|----------|
| **Automated monitoring** | Safety classifiers, anomaly detection |
| **User reports** | Bug reports, safety reports |
| **Internal discovery** | Employee observation, testing |
| **External reports** | Security researchers, media |
| **Third-party** | Partners, regulators |

#### Reporting Channels

| Channel | For |
|---------|-----|
| **Safety hotline** | Internal urgent reports |
| **Safety email** | Internal non-urgent reports |
| **Bug bounty** | External security reports |
| **Support channels** | User reports |
| **Executive escalation** | Critical issues |

### Phase 2: Triage

#### Initial Assessment (Within 15 minutes for P0/P1)

| Step | Action |
|------|--------|
| 1 | Validate incident is real |
| 2 | Determine severity level |
| 3 | Identify affected systems |
| 4 | Assign incident commander |
| 5 | Notify required stakeholders |

#### Triage Checklist

| Question | Purpose |
|----------|---------|
| What happened? | Understand the incident |
| Who is affected? | Scope assessment |
| Is it ongoing? | Urgency determination |
| Can it be reproduced? | Exploitability |
| What's the harm potential? | Severity rating |

### Phase 3: Containment

#### Containment Actions

| Severity | Response Time | Actions |
|----------|---------------|---------|
| **P0** | Immediate | Emergency shutdown if needed, immediate patch |
| **P1** | <1 hour | Feature disable, rate limiting, filter deployment |
| **P2** | <4 hours | Targeted mitigations, monitoring increase |
| **P3** | <24 hours | Standard fix process |

#### Containment Options

| Action | Use Case |
|--------|----------|
| **Kill switch** | Immediate system shutdown (P0 only) |
| **Feature disable** | Turn off affected feature |
| **Rate limiting** | Slow down potential abuse |
| **Filter deployment** | Block specific inputs/outputs |
| **Model rollback** | Revert to previous version |
| **Access restriction** | Limit affected user access |

### Phase 4: Investigation

#### Investigation Scope

| Area | Questions |
|------|-----------|
| **Root cause** | Why did this happen? |
| **Timeline** | When did it start? How long active? |
| **Impact** | Who/what was affected? How severely? |
| **Detection** | Why wasn't this caught earlier? |
| **Similar issues** | Are there related vulnerabilities? |

#### Evidence Collection

| Evidence Type | Collection Method |
|---------------|-------------------|
| **Logs** | System logs, API logs, safety logs |
| **Outputs** | Examples of problematic outputs |
| **Inputs** | Triggering inputs/prompts |
| **Metrics** | Relevant monitoring data |
| **User reports** | All related user feedback |

#### Investigation Team

| Role | Responsibility |
|------|----------------|
| **Incident Commander** | Overall coordination |
| **Technical Lead** | Technical investigation |
| **Safety Lead** | Safety assessment |
| **Legal** | Legal implications (if needed) |
| **Communications** | External communication prep |

### Phase 5: Remediation

#### Remediation Planning

| Element | Description |
|---------|-------------|
| **Fix identification** | Determine appropriate fix |
| **Testing** | Verify fix works, no regressions |
| **Deployment plan** | How to roll out fix |
| **Validation** | How to confirm resolution |

#### Fix Types

| Fix Type | Timeline | Use Case |
|----------|----------|----------|
| **Hotfix** | Immediate | Critical safety issues |
| **Patch** | <24 hours | High-priority fixes |
| **Update** | Standard release | Medium/low priority |
| **Major change** | Planned release | Significant changes needed |

### Phase 6: Recovery

#### Recovery Steps

1. Deploy fix
2. Validate resolution
3. Remove containment measures
4. Monitor for recurrence
5. Confirm normal operation

#### Recovery Verification

| Check | Method |
|-------|--------|
| **Issue resolved** | Reproduce attempt fails |
| **No regressions** | Standard tests pass |
| **Performance normal** | Metrics within bounds |
| **User experience** | Sample verification |

### Phase 7: Post-Incident Review

#### Review Timeline

| Severity | Review Timeline |
|----------|-----------------|
| **P0** | Within 72 hours |
| **P1** | Within 1 week |
| **P2** | Within 2 weeks |
| **P3** | Monthly batch review |

#### Post-Incident Report

| Section | Contents |
|---------|----------|
| **Summary** | What happened, when, impact |
| **Timeline** | Detailed event sequence |
| **Root cause** | Why it happened |
| **Response** | What we did |
| **Impact** | Users/systems affected |
| **Lessons learned** | What we learned |
| **Action items** | Preventive measures |

## Communication

### Internal Communication

#### Notification Matrix

| Severity | Immediate | Within 1 Hour | Within 24 Hours |
|----------|-----------|---------------|-----------------|
| **P0** | CEO, CTO, Legal, Safety Lead | ESG Committee, Board | All leadership |
| **P1** | CTO, Safety Lead | Product Lead, ESG Committee | Department heads |
| **P2** | Safety Lead | Product Lead | Team leads |
| **P3** | Team lead | - | - |

#### Communication Channels

| Channel | Use |
|---------|-----|
| **War room (P0/P1)** | Real-time coordination |
| **Incident Slack** | Updates, coordination |
| **Email** | Formal notifications |
| **Ticket** | Tracking, documentation |

### External Communication

#### Communication Decision Tree

```
Is public aware?
    ↓ Yes           ↓ No
Proactive comms    Is disclosure required?
    ↓                  ↓ Yes      ↓ No
                    Disclose    Monitor
```

#### Communication Templates

| Situation | Elements |
|-----------|----------|
| **Initial acknowledgment** | We're aware, investigating, user steps |
| **Update** | What we know, what we're doing, timeline |
| **Resolution** | What happened, what we did, preventive measures |

#### Disclosure Requirements

| Trigger | Disclosure |
|---------|------------|
| **User data affected** | Required notification (per jurisdiction) |
| **Significant public harm** | Proactive disclosure recommended |
| **Regulatory requirement** | Per applicable law |
| **Media inquiry** | Coordinated response |

## Roles & Responsibilities

### Incident Response Team

| Role | Responsibility | On-Call |
|------|----------------|---------|
| **Incident Commander** | Overall coordination | 24/7 rotation |
| **Technical Lead** | Technical investigation/fix | 24/7 rotation |
| **Safety Lead** | Safety assessment | 24/7 rotation |
| **Communications Lead** | External communications | Business hours + on-call |
| **Legal** | Legal assessment | On-call |

### Escalation Authority

| Decision | Authority |
|----------|-----------|
| **Containment actions** | Incident Commander |
| **Model shutdown** | CTO or CEO |
| **External communication** | Communications + Legal |
| **Regulatory notification** | Legal + CEO |

## Continuous Improvement

### Metrics Tracking

| Metric | Target |
|--------|--------|
| **Time to detection** | Reduce over time |
| **Time to containment** | <1 hour for P0/P1 |
| **Time to resolution** | Per severity SLAs |
| **Recurrence rate** | Zero recurrence of same issue |

### Training & Drills

| Activity | Frequency |
|----------|-----------|
| **Incident response training** | Annual for all team |
| **Tabletop exercises** | Quarterly |
| **Full drills** | Biannual |
| **Red team exercises** | Continuous |

### Process Improvement

- Review all incidents quarterly
- Update procedures based on learnings
- Share learnings (appropriately) with community
- Benchmark against industry practices

## Related HIPs

- **HIP-200**: Responsible AI Principles
- **HIP-201**: Model Risk Management
- **HIP-210**: Safety Evaluation Framework
- **HIP-220**: Bias Detection & Mitigation
- **HIP-230**: AI Transparency & Explainability
- **HIP-290**: Evidence Locker Index

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial draft |

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
