---
hip: 0094
title: Medical AI & Clinical Decision Support Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0004, HIP-0032, HIP-0043, HIP-0051
---

# HIP-94: Medical AI & Clinical Decision Support Standard

## Abstract

This proposal defines **MedAI**, Hanzo's standard for building, deploying, and monitoring AI systems that operate in clinical environments. MedAI provides a compliance-first infrastructure layer that sits between Hanzo's general-purpose AI platform and the regulated world of healthcare -- enforcing HIPAA, FDA SaMD, EU MDR, and AI Act requirements at the infrastructure level so that clinical AI developers can focus on model quality rather than regulatory plumbing.

MedAI is not a model. It is a set of services, APIs, and deployment patterns that make it possible to serve medical AI models with the audit trails, consent tracking, explainability outputs, and data handling guarantees that healthcare regulators require. It integrates with the LLM Inference Engine (HIP-0043) for HIPAA-compliant model serving, Hanzo Storage (HIP-0032) for encrypted PHI storage, and Guard (HIP-0051) for automated PHI detection and redaction in AI inputs and outputs.

The standard covers four clinical AI domains: clinical NLP (structured extraction from unstructured notes), medical imaging (radiology, pathology, dermatology, ophthalmology), clinical decision support (differential diagnosis, drug interaction, risk scoring), and EHR integration (FHIR R4, DICOM).

**Repository**: [github.com/hanzoai/medai](https://github.com/hanzoai/medai)
**Port**: 8094 (API)
**Binary**: `hanzo-medai`
**Container**: `ghcr.io/hanzoai/medai:latest`
**Language**: Go (API layer, compliance engine), Python (model serving, clinical NLP)

## Motivation

### Why Medical AI Needs Special Infrastructure

Diagnostic error is the third leading cause of death in the United States, responsible for an estimated 250,000 deaths annually. AI has demonstrated the ability to reduce these errors -- Google's dermatology AI matches board-certified dermatologists, Viz.ai's stroke detection reduces door-to-treatment time by 26 minutes, and PathAI's computational pathology improves cancer detection sensitivity by 8-12%. The technology works. The problem is deployment.

Medical AI systems cannot be deployed like other software. A bug in a recommendation engine shows the wrong product; a bug in a clinical decision support system can kill a patient. This is not a metaphor. The FDA has recalled AI/ML-based medical devices for producing incorrect diagnoses. The regulatory frameworks exist because the stakes demand them.

General-purpose AI infrastructure -- including Hanzo's own LLM Gateway (HIP-0004) and Engine (HIP-0043) -- lacks the following properties that healthcare regulations require:

1. **Immutable audit trails.** HIPAA requires that every access to Protected Health Information (PHI) is logged with who accessed it, when, why, and what they saw. Standard API logs record request/response metadata. Medical AI logs must record the clinical context, the model version, the input data provenance, the output, and the clinician who reviewed the output. These logs must be tamper-evident and retained for a minimum of six years (HIPAA) or ten years (some state laws).

2. **Patient consent tracking.** Using a patient's data for AI inference requires documented consent. The consent scope varies: a patient may consent to diagnostic imaging AI but not to their data being used for model training. The infrastructure must track consent at the per-patient, per-use-case level and enforce it at inference time. General-purpose AI platforms have no concept of patient consent.

3. **Clinical validation metadata.** The FDA requires that AI-based medical devices document their intended use, clinical validation data, performance characteristics (sensitivity, specificity, PPV, NPV), known limitations, and failure modes. This metadata must travel with every prediction. A model output without its validation context is clinically useless -- a physician cannot act on a prediction they cannot evaluate.

4. **Deterministic reproducibility.** A physician who questions an AI recommendation six months after the fact must be able to reproduce the exact output given the exact inputs. This requires versioned models, versioned preprocessing pipelines, and archived input data. General-purpose inference engines optimize for throughput, not reproducibility.

5. **Demographic bias monitoring.** The FDA and EU MDR require that medical AI systems demonstrate equitable performance across demographic groups (age, sex, race, ethnicity). A model that achieves 95% sensitivity on Caucasian patients and 78% on Black patients is not clinically acceptable, even if the aggregate sensitivity is 91%. The infrastructure must continuously monitor per-subgroup performance and alert when disparities emerge.

6. **PHI isolation.** Patient data must never leave a compliance boundary. It cannot be logged to a general-purpose observability system. It cannot be cached in a shared Redis instance. It cannot appear in error messages sent to Sentry. Every component in the data path must be PHI-aware.

### Why Not Just Use the LLM Gateway

The LLM Gateway (HIP-0004) routes requests to 100+ AI providers with load balancing, cost optimization, and fallback. It is excellent general-purpose infrastructure. It is unsuitable for medical AI for these specific reasons:

- **No consent enforcement.** The Gateway routes based on cost, latency, and model capability. It has no mechanism to check whether patient X has consented to having their radiology images processed by model Y.
- **Shared infrastructure.** The Gateway serves all Hanzo tenants on shared compute. HIPAA requires that PHI processing occurs in isolated environments with dedicated encryption keys. A multi-tenant inference pool violates this requirement.
- **No clinical metadata.** The Gateway returns model outputs as plain text or JSON. Medical AI outputs require structured clinical metadata: ICD-10 codes, confidence intervals, differential diagnoses, contraindications, and citations to clinical literature.
- **No regulatory audit trail.** The Gateway logs requests for operational monitoring. Medical AI requires a separate, immutable, HIPAA-compliant audit log that records the complete clinical decision chain.
- **No post-market surveillance.** The FDA requires continuous monitoring of deployed medical AI systems (post-market surveillance). The Gateway has no mechanism for tracking per-model, per-indication clinical performance over time.

MedAI wraps the Engine (HIP-0043) in a compliance layer that adds these capabilities. It does not replace the Engine -- it configures dedicated Engine instances with HIPAA-compliant settings and adds the regulatory services around them.

### How AI Reduces Diagnostic Errors

The clinical value of AI in diagnostics is not speculative. Published, peer-reviewed evidence supports these claims:

- **Radiology**: AI triage for chest X-rays reduces critical finding report times from 11.2 hours to 2.7 hours (Annarumma et al., Radiology 2019). AI-assisted mammography increases cancer detection by 12% while reducing false positives by 6% (McKinney et al., Nature 2020).
- **Pathology**: AI-assisted prostate cancer grading agrees with expert pathologists at the same rate that expert pathologists agree with each other (Bulten et al., Nature Medicine 2022).
- **Ophthalmology**: AI screening for diabetic retinopathy achieves 87% sensitivity and 90% specificity in real-world deployment, matching ophthalmologist performance (Abramoff et al., NPJ Digital Medicine 2018). The FDA cleared this as the first autonomous AI diagnostic system.
- **Clinical NLP**: AI extraction of diagnoses from clinical notes achieves 94% F1 score for ICD-10 coding, reducing coding backlogs by 60% (Rajkomar et al., NPJ Digital Medicine 2019).

The infrastructure to deploy these systems safely does not exist as a commodity. Each health system builds it from scratch, spending 18-24 months on compliance engineering before the first model serves a single patient. MedAI reduces this to weeks.

## Design Philosophy

### Compliance Is Infrastructure, Not Application Logic

The most common mistake in medical AI engineering is implementing compliance in the application layer. Developers add HIPAA logging to their Flask routes, consent checks to their model inference functions, and PHI redaction to their response serializers. This approach fails for three reasons:

1. **Compliance logic is duplicated across every medical AI application.** Each team reimplements audit logging, consent checking, and PHI handling. Each implementation has different bugs.
2. **Compliance can be bypassed.** If consent checking is in the application code, a developer can (accidentally or deliberately) skip it. If it is in the infrastructure, it cannot be bypassed -- the request never reaches the model.
3. **Compliance logic changes independently of application logic.** When the FDA updates its SaMD guidance (as it did in 2023 and 2025), every application must be updated. When compliance is infrastructure, one update covers all applications.

MedAI implements compliance as a proxy layer. Clinical AI requests pass through MedAI before reaching the inference engine. MedAI checks consent, validates the request against the model's cleared indications, logs the interaction to the immutable audit trail, and attaches clinical metadata to the response. The application developer never touches compliance code.

### Regulation Explained for Engineers

Medical AI regulation is not one law. It is a stack of overlapping frameworks, each with different scope, authority, and requirements. Engineers building on MedAI need to understand what they are complying with and why.

**HIPAA (Health Insurance Portability and Accountability Act, 1996, USA)**

HIPAA governs the handling of Protected Health Information (PHI). PHI is any individually identifiable health information: names, dates, medical record numbers, diagnoses, images, lab results, genetic data, or any combination that could identify a patient.

HIPAA has three relevant rules:
- **Privacy Rule**: Defines what PHI is and who can access it. Requires minimum necessary access -- you can only see the PHI you need for your specific purpose.
- **Security Rule**: Requires administrative, physical, and technical safeguards. For AI infrastructure, this means: encryption at rest (AES-256) and in transit (TLS 1.3), access controls with unique user IDs, audit logs retained 6+ years, automatic session timeouts, and emergency access procedures.
- **Breach Notification Rule**: If PHI is exposed, affected patients must be notified within 60 days. Breaches affecting 500+ patients must be reported to HHS and local media. The average cost of a healthcare data breach is $10.93 million (IBM 2023).

For MedAI, HIPAA means: every component that touches patient data must encrypt it, log access to it, restrict who can see it, and be able to prove all of this to an auditor.

**FDA SaMD (Software as a Medical Device)**

The FDA regulates AI systems that are intended to diagnose, treat, mitigate, or prevent disease. The regulatory classification depends on the risk level:

| Class | Risk | Example | Regulatory Path | Timeline |
|-------|------|---------|-----------------|----------|
| I | Low | Wellness app, health tracker | General Controls, 510(k) exempt | 3-6 months |
| II | Moderate | AI-assisted radiology triage, ECG analysis | 510(k) or De Novo | 6-12 months |
| III | High | Autonomous diagnosis, treatment planning | PMA (Pre-Market Approval) | 1-3 years |

Key FDA concepts for AI engineers:

- **Intended Use**: The FDA clears a device for specific indications. A model cleared for "triage of suspected pneumothorax on chest X-ray" cannot legally be used for "diagnosis of lung cancer." MedAI enforces intended-use boundaries at the API level.
- **Predetermined Change Control Plan (PCCP)**: The FDA now allows manufacturers to describe, in advance, the types of changes they will make to an AI model (retraining, architecture modifications) and the validation protocol for each change type. This enables model updates without re-submission. MedAI's model registry tracks PCCP compliance.
- **Real-World Performance (RWP)**: Post-market surveillance data. The FDA expects manufacturers to monitor how their AI performs on real patients after deployment, not just on curated test sets. MedAI's monitoring pipeline collects RWP data automatically.
- **Good Machine Learning Practice (GMLP)**: FDA's 10 guiding principles for AI/ML-based SaMD, including data quality, clinical association, reference standards, and performance monitoring.

**EU MDR (Medical Device Regulation 2017/745)**

The EU MDR replaced the Medical Device Directive (MDD) and applies to AI-based medical devices marketed in the EU. Key differences from FDA:

- **Notified Bodies**: Devices are certified by Notified Bodies (independent organizations), not a central authority. Availability of Notified Bodies is limited, creating certification backlogs.
- **Clinical Evidence**: The MDR requires "sufficient clinical evidence" including clinical investigations (trials). The bar for clinical evidence is generally higher than the FDA's 510(k) pathway.
- **Post-Market Surveillance**: Manufacturers must implement a Post-Market Surveillance (PMS) system, submit periodic safety update reports (PSUR), and maintain a Summary of Safety and Clinical Performance (SSCP) accessible to the public.
- **UDI**: Every device must carry a Unique Device Identifier in a database (EUDAMED).

**EU AI Act (Regulation 2024/1689)**

The AI Act classifies AI systems by risk level and applies horizontally across sectors. Medical AI falls under "high-risk" AI systems (Annex III, Section 5), which triggers these requirements:

- **Risk Management System**: Continuous, iterative process to identify and mitigate risks.
- **Data Governance**: Training data must be relevant, representative, free of errors, and complete. Bias testing is mandatory.
- **Technical Documentation**: Architecture, design, development methodology, validation results, performance metrics per demographic group.
- **Record-Keeping**: Automatic logging of system operation for traceability.
- **Transparency**: Users must be informed they are interacting with an AI system and understand its capabilities and limitations.
- **Human Oversight**: The system must allow a human to interpret outputs, override decisions, and intervene.
- **Accuracy, Robustness, Cybersecurity**: Must meet "appropriate" levels throughout the lifecycle.

MedAI generates the technical documentation, maintains the record-keeping logs, and enforces the transparency and human oversight requirements automatically.

### The Clinical Terminology Stack

Medical AI systems must speak the language of medicine. This is not natural language -- it is a set of formal coding systems that encode diagnoses, procedures, observations, and medications in machine-readable formats. Engineers building clinical AI need to understand four coding systems:

**ICD-10 (International Classification of Diseases, 10th Revision)**: The global standard for diagnosis coding. Every diagnosis has a code: `J18.9` (pneumonia, unspecified), `E11.65` (type 2 diabetes with hyperglycemia), `C34.11` (malignant neoplasm of upper lobe, right bronchus or lung). There are approximately 72,000 ICD-10-CM codes. Clinical NLP models must map free-text diagnoses to these codes.

**SNOMED CT (Systematized Nomenclature of Medicine - Clinical Terms)**: A richer ontology than ICD-10 with over 350,000 concepts and 1.5 million relationships. SNOMED CT captures clinical meaning with greater precision: while ICD-10 has one code for "pneumonia, unspecified," SNOMED CT distinguishes between community-acquired, hospital-acquired, aspiration, and ventilator-associated pneumonia, with relationships to causative organisms, affected anatomy, and severity.

**LOINC (Logical Observation Identifiers Names and Codes)**: The standard for laboratory tests and clinical observations. Every lab test has a LOINC code: `2345-7` (glucose, serum/plasma), `718-7` (hemoglobin), `33914-3` (estimated glomerular filtration rate). LOINC codes appear in FHIR Observation resources.

**RxNorm**: The standard for medication naming. Maps between brand names, generic names, ingredients, and dosage forms. Essential for drug interaction checking and medication reconciliation.

MedAI's clinical NLP pipeline maps free-text to all four coding systems and returns structured FHIR resources with proper code bindings.

## Specification

### Architecture Overview

```
                        +-----------------------+
                        |   EHR / Clinical App  |
                        |   (FHIR R4 Client)    |
                        +----------+------------+
                                   |
                              FHIR R4 / REST
                                   |
                        +----------v------------+
                        |      MedAI API        |
                        |      :8094            |
                        +----------+------------+
                        |  Consent | Audit      |
                        |  Engine  | Logger     |
                        +----+-----+-----+------+
                             |           |
              +--------------+-+   +-----+----------+
              |  Clinical NLP  |   | Medical Imaging |
              |  Pipeline      |   | Pipeline        |
              +-------+--------+   +--------+--------+
                      |                      |
              +-------v--------+   +--------v--------+
              | Engine         |   | Engine           |
              | (HIP-0043)    |   | (HIP-0043)      |
              | NLP Models     |   | Imaging Models   |
              +-------+--------+   +--------+--------+
                      |                      |
              +-------v--------+   +--------v--------+
              | Guard          |   | Storage          |
              | (HIP-0051)    |   | (HIP-0032)      |
              | PHI Redaction  |   | DICOM / FHIR    |
              +----------------+   +-----------------+
```

MedAI exposes a single API on port 8094. Internally, it delegates to specialized pipelines for clinical NLP, medical imaging, and clinical decision support. Each pipeline uses dedicated Engine instances (HIP-0043) configured for HIPAA compliance: isolated tenant, encrypted model weights, no shared KV cache, audit-logged inference.

### HIPAA-Compliant Model Serving

MedAI configures Engine instances with the following HIPAA-specific settings:

```yaml
# medai-engine-config.yaml
engine:
  # Dedicated instance per tenant -- no shared GPU memory
  isolation: tenant
  tenant_id: ${TENANT_ID}

  # Encryption
  tls:
    enabled: true
    min_version: "1.3"
    cert_file: /etc/medai/tls/server.crt
    key_file: /etc/medai/tls/server.key
  model_encryption:
    enabled: true
    algorithm: AES-256-GCM
    key_source: kms  # Hanzo KMS (HIP-0027)

  # Audit logging -- every inference is recorded
  audit:
    enabled: true
    destination: medai-audit-log
    fields:
      - request_id
      - tenant_id
      - patient_id_hash  # SHA-256, never plaintext
      - model_id
      - model_version
      - indication
      - timestamp
      - input_token_count
      - output_token_count
      - inference_duration_ms
      - clinician_id
    retention_days: 2190  # 6 years per HIPAA
    tamper_protection: hmac-sha256

  # No shared caching -- patient data must not leak across requests
  kv_cache:
    shared_prefix: false  # Disable system prompt sharing
    isolation: per_request

  # Automatic session timeout
  session:
    max_idle_seconds: 900  # 15 minutes
    max_duration_seconds: 3600  # 1 hour
```

Integration with Storage (HIP-0032) for PHI data:

```yaml
# medai-storage-config.yaml
storage:
  endpoint: storage.medai.hanzo.ai:9000
  bucket_prefix: medai-

  # Encryption at rest -- required by HIPAA Security Rule
  encryption:
    algorithm: AES-256-GCM
    key_management: kms  # Hanzo KMS
    key_rotation_days: 90

  # Access logging -- required by HIPAA Security Rule
  access_logging:
    enabled: true
    destination: medai-storage-audit
    log_all_reads: true
    log_all_writes: true
    retention_days: 2190

  # Bucket policies
  buckets:
    dicom-images:
      versioning: true
      object_lock: true  # Immutable for retention period
      lifecycle:
        retention_days: 2190
    clinical-notes:
      versioning: true
      object_lock: true
      lifecycle:
        retention_days: 2190
    model-outputs:
      versioning: true
      lifecycle:
        retention_days: 3650  # 10 years for clinical records
```

Integration with Guard (HIP-0051) for PHI detection:

```yaml
# medai-guard-config.yaml
guard:
  mode: inline

  phi_detection:
    enabled: true
    action: redact  # redact | block | flag

    # PHI entity types to detect (per HIPAA Safe Harbor)
    entities:
      - patient_name
      - date_of_birth
      - social_security_number
      - medical_record_number
      - health_plan_number
      - account_number
      - certificate_number
      - vehicle_identifier
      - device_identifier
      - url
      - ip_address
      - biometric_identifier
      - photo
      - geographic_subdivision  # Smaller than state
      - age_over_89

    # Scan both requests and responses
    scan_requests: true
    scan_responses: true

    # Redaction format
    redaction:
      format: "[REDACTED:{entity_type}]"
      preserve_length: false
      log_original: false  # Never log unredacted PHI
```

### Clinical NLP Pipeline

The clinical NLP pipeline extracts structured data from unstructured clinical text. It accepts free-text clinical notes and returns FHIR-encoded resources with coded diagnoses, medications, procedures, and observations.

**API Endpoint**: `POST /v1/nlp/extract`

```json
{
  "text": "Patient is a 67-year-old male presenting with acute onset chest pain radiating to the left arm. History of type 2 diabetes, hypertension, and hyperlipidemia. Current medications include metformin 1000mg BID, lisinopril 20mg daily, and atorvastatin 40mg daily. ECG shows ST elevation in leads II, III, and aVF. Troponin I elevated at 2.4 ng/mL.",
  "patient_id": "patient-abc-123",
  "encounter_id": "encounter-456",
  "extraction_targets": ["conditions", "medications", "observations", "procedures"],
  "coding_systems": ["icd10", "snomed", "loinc", "rxnorm"],
  "consent_token": "consent-tok-789"
}
```

**Response**:

```json
{
  "request_id": "req-medai-001",
  "model_id": "zen-medai-nlp-14b",
  "model_version": "1.4.2",
  "extraction_timestamp": "2026-02-23T14:30:00Z",
  "conditions": [
    {
      "text": "acute onset chest pain radiating to the left arm",
      "icd10": {"code": "I21.19", "display": "ST elevation myocardial infarction involving other coronary artery of inferior wall"},
      "snomed": {"code": "401303003", "display": "Acute ST segment elevation myocardial infarction"},
      "confidence": 0.94,
      "evidence_span": {"start": 45, "end": 93},
      "clinical_status": "active",
      "verification_status": "provisional"
    },
    {
      "text": "type 2 diabetes",
      "icd10": {"code": "E11.9", "display": "Type 2 diabetes mellitus without complications"},
      "snomed": {"code": "44054006", "display": "Type 2 diabetes mellitus"},
      "confidence": 0.99,
      "evidence_span": {"start": 106, "end": 121},
      "clinical_status": "active",
      "verification_status": "confirmed"
    }
  ],
  "medications": [
    {
      "text": "metformin 1000mg BID",
      "rxnorm": {"code": "861004", "display": "metformin hydrochloride 1000 MG Oral Tablet"},
      "dose": "1000mg",
      "frequency": "BID",
      "confidence": 0.98
    }
  ],
  "observations": [
    {
      "text": "Troponin I elevated at 2.4 ng/mL",
      "loinc": {"code": "10839-9", "display": "Troponin I.cardiac [Mass/volume] in Serum or Plasma"},
      "value": 2.4,
      "unit": "ng/mL",
      "interpretation": "high",
      "reference_range": "0.0-0.04 ng/mL",
      "confidence": 0.97
    }
  ],
  "explainability": {
    "attention_map_url": "/v1/explain/req-medai-001/attention",
    "feature_importance_url": "/v1/explain/req-medai-001/features",
    "reasoning_chain": [
      "ST elevation in leads II, III, aVF indicates inferior wall involvement",
      "Elevated troponin I (2.4 ng/mL, reference <0.04) confirms myocardial injury",
      "Chest pain with left arm radiation is classic presentation for STEMI",
      "Combined findings map to ICD-10 I21.19 with 94% confidence"
    ]
  },
  "audit": {
    "audit_id": "audit-medai-001",
    "logged_at": "2026-02-23T14:30:01Z",
    "consent_verified": true,
    "consent_scope": "diagnostic-ai"
  }
}
```

### Medical Imaging Pipeline

The medical imaging pipeline processes DICOM images and returns structured diagnostic findings. It supports four imaging domains:

| Domain | Modalities | Models | Key Indications |
|--------|-----------|--------|-----------------|
| Radiology | X-ray, CT, MRI | zen-medai-rad-32b | Pneumothorax, fractures, pulmonary nodules, intracranial hemorrhage |
| Pathology | Whole Slide Imaging (WSI) | zen-medai-path-14b | Cancer grading (Gleason, Nottingham), mitotic counting, margin assessment |
| Dermatology | Clinical photography, dermoscopy | zen-medai-derm-7b | Melanoma detection, lesion classification (benign/malignant), skin cancer screening |
| Ophthalmology | Fundus photography, OCT | zen-medai-eye-7b | Diabetic retinopathy screening, glaucoma detection, AMD staging |

**DICOM Handling**:

MedAI accepts DICOM files via the DICOMweb standard (WADO-RS, STOW-RS, QIDO-RS) and via direct file upload. DICOM metadata is parsed to extract patient demographics, study information, and imaging parameters. The pixel data is preprocessed according to the model's requirements (windowing, normalization, resizing).

```
POST /v1/imaging/analyze

Content-Type: multipart/related; type="application/dicom"

--boundary
Content-Type: application/dicom
Content-Location: /studies/1.2.3/series/4.5.6/instances/7.8.9

[DICOM binary data]
--boundary--
```

**Response**:

```json
{
  "request_id": "req-medai-img-001",
  "model_id": "zen-medai-rad-32b",
  "model_version": "2.1.0",
  "study_uid": "1.2.3",
  "series_uid": "4.5.6",
  "findings": [
    {
      "finding": "Left-sided pneumothorax",
      "location": {"x": 234, "y": 156, "width": 89, "height": 112},
      "severity": "moderate",
      "icd10": {"code": "J93.11", "display": "Primary spontaneous pneumothorax"},
      "confidence": 0.91,
      "heatmap_url": "/v1/explain/req-medai-img-001/heatmap/0",
      "recommendation": "Clinical correlation recommended. Consider chest tube placement if symptomatic."
    }
  ],
  "dicom_sr": {
    "content_type": "application/dicom+json",
    "url": "/v1/imaging/results/req-medai-img-001/sr"
  },
  "validation_context": {
    "fda_clearance": "K231234",
    "intended_use": "Triage of suspected pneumothorax on adult posteroanterior chest radiographs",
    "contraindications": ["Pediatric patients (<18 years)", "Lateral-only views", "Post-surgical images with hardware"],
    "clinical_performance": {
      "sensitivity": 0.94,
      "specificity": 0.97,
      "ppv": 0.89,
      "npv": 0.98,
      "auc": 0.97,
      "validation_dataset": "NIH ChestX-ray14 + 3 clinical sites",
      "validation_n": 42000
    }
  },
  "audit": {
    "audit_id": "audit-medai-img-001",
    "logged_at": "2026-02-23T14:35:00Z",
    "consent_verified": true,
    "intended_use_validated": true
  }
}
```

### FHIR R4 Integration

MedAI exposes a FHIR R4-compliant API for EHR integration. All clinical outputs are available as FHIR resources, enabling direct ingestion by Epic, Cerner, Allscripts, and other FHIR-enabled EHR systems.

**Supported FHIR Resources**:

| Resource | Use Case |
|----------|----------|
| `DiagnosticReport` | Imaging analysis results, NLP extraction summaries |
| `Observation` | Individual clinical findings, lab values, vital signs |
| `Condition` | Extracted diagnoses with ICD-10/SNOMED coding |
| `MedicationStatement` | Extracted medications with RxNorm coding |
| `ImagingStudy` | DICOM study metadata and references |
| `ServiceRequest` | AI-generated clinical recommendations |
| `AuditEvent` | Compliance audit trail entries |
| `Consent` | Patient consent records for AI processing |
| `Provenance` | Model version, pipeline version, data lineage |

**FHIR Endpoint**: `GET/POST /v1/fhir/r4/{resource_type}`

Example: Retrieve all AI-generated diagnostic reports for a patient:

```
GET /v1/fhir/r4/DiagnosticReport?patient=patient-abc-123&category=AI-CDS
Accept: application/fhir+json
```

**SMART on FHIR**: MedAI supports SMART on FHIR launch sequences for embedding within EHR workflows. A clinician can launch MedAI from within their EHR, and MedAI receives the patient context, encounter context, and user credentials via the SMART launch protocol.

### Consent Engine

Every inference request requires a valid consent token. The consent engine manages patient consent at the granular level required by HIPAA and GDPR.

**Consent Lifecycle**:

```
Patient grants consent --> Consent recorded in MedAI
                           (scope, duration, purpose)
                                    |
                                    v
Inference request arrives --> Consent engine validates:
                             1. Consent exists for this patient
                             2. Consent covers this use case
                             3. Consent has not expired
                             4. Consent has not been revoked
                                    |
                              +-----+-----+
                              |           |
                           Valid       Invalid
                              |           |
                         Proceed     Return 403
                         to model    "consent_required"
```

**Consent Scopes**:

| Scope | Description |
|-------|-------------|
| `diagnostic-ai` | AI-assisted diagnosis (imaging, NLP) |
| `treatment-recommendation` | AI-generated treatment suggestions |
| `risk-scoring` | Predictive risk models |
| `research` | Use of de-identified data for model improvement |
| `quality-improvement` | Aggregate performance monitoring |

**API**:

```
POST /v1/consent
{
  "patient_id": "patient-abc-123",
  "scopes": ["diagnostic-ai", "risk-scoring"],
  "granted_by": "patient",  // or "legal_representative"
  "purpose": "Emergency department clinical decision support",
  "valid_from": "2026-02-23T00:00:00Z",
  "valid_until": "2027-02-23T00:00:00Z",
  "revocable": true
}

Response:
{
  "consent_token": "consent-tok-789",
  "status": "active"
}
```

Consent revocation is immediate and retroactive: all cached model outputs for the patient are purged, and future requests are blocked until new consent is obtained.

### Model Validation and Registry

MedAI maintains a model registry that tracks clinical validation metadata for every deployed model. No model can serve inference without a validated registry entry.

**Registry Entry**:

```yaml
model_id: zen-medai-rad-32b
model_version: "2.1.0"
regulatory:
  fda_clearance: K231234
  fda_class: II
  fda_pathway: "510(k)"
  eu_mdr_class: IIa
  eu_mdr_notified_body: "BSI 0086"
  ai_act_risk_level: high
  intended_use: >
    Triage of suspected pneumothorax on adult posteroanterior
    chest radiographs. Not intended for diagnosis. Results must
    be reviewed by a qualified radiologist.
  contraindications:
    - "Pediatric patients under 18 years"
    - "Lateral-only chest views"
    - "Post-surgical images with metallic hardware"

clinical_validation:
  primary_study:
    name: "Multi-site prospective validation"
    sites: 3
    patients: 42000
    design: "Prospective, multi-reader, multi-case"
    enrollment_period: "2025-01 to 2025-09"
  performance:
    overall:
      sensitivity: 0.94
      specificity: 0.97
      ppv: 0.89
      npv: 0.98
      auc: 0.97
    subgroup:
      - group: "Male, 18-45"
        n: 8400
        sensitivity: 0.95
        specificity: 0.97
      - group: "Female, 18-45"
        n: 7800
        sensitivity: 0.93
        specificity: 0.97
      - group: "Male, 45-65"
        n: 9200
        sensitivity: 0.94
        specificity: 0.96
      - group: "Female, 45-65"
        n: 8100
        sensitivity: 0.94
        specificity: 0.97
      - group: "Male, >65"
        n: 4800
        sensitivity: 0.93
        specificity: 0.96
      - group: "Female, >65"
        n: 3700
        sensitivity: 0.92
        specificity: 0.96
  bias_assessment:
    method: "Equalized odds analysis"
    max_sensitivity_gap: 0.03
    max_specificity_gap: 0.01
    status: "PASS"

pccp:  # Predetermined Change Control Plan
  allowed_modifications:
    - type: "retraining_with_additional_data"
      validation: "Hold-out test set, performance within 2% of baseline"
    - type: "quantization_format_change"
      validation: "Bitwise comparison of outputs on reference dataset"
  prohibited_modifications:
    - "Architecture change"
    - "Change to intended use or indications"
    - "Removal of demographic subgroups from training data"
```

### Explainability

Medical AI outputs must be explainable. A radiologist will not act on a finding if they cannot understand why the model produced it. A regulator will not approve a model that operates as a black box. MedAI provides three explainability mechanisms:

**1. Attention Visualization**

For imaging models, MedAI generates Grad-CAM heatmaps showing which regions of the input image contributed most to each finding. The heatmaps are overlaid on the original DICOM image and returned as DICOM Secondary Capture objects, viewable in any PACS workstation.

```
GET /v1/explain/{request_id}/heatmap/{finding_index}
Accept: application/dicom

Returns: DICOM Secondary Capture with Grad-CAM overlay
```

**2. Feature Importance**

For NLP models, MedAI returns per-token importance scores indicating which words in the clinical text most influenced each extraction. This uses integrated gradients, which provides a theoretically grounded attribution method.

```
GET /v1/explain/{request_id}/features
Accept: application/json

{
  "finding_index": 0,
  "tokens": ["ST", "elevation", "in", "leads", "II", ",", "III", ",", "and", "aVF"],
  "importance": [0.82, 0.91, 0.05, 0.12, 0.78, 0.01, 0.76, 0.01, 0.02, 0.85],
  "method": "integrated_gradients",
  "baseline": "empty_input"
}
```

**3. Confidence Calibration**

MedAI requires all models to be calibrated: a prediction reported at 90% confidence should be correct 90% of the time. The model registry includes calibration data (reliability diagrams), and MedAI monitors calibration drift in production. If a model's calibration degrades below a configured threshold, it is automatically flagged for review.

```yaml
calibration:
  method: "temperature_scaling"
  ece: 0.018  # Expected Calibration Error
  mce: 0.045  # Maximum Calibration Error
  bins: 10
  threshold_ece: 0.05  # Alert if ECE exceeds this
  threshold_mce: 0.10  # Alert if MCE exceeds this
  last_calibration: "2026-02-01"
  calibration_dataset_n: 5000
```

### Post-Market Surveillance

The FDA and EU MDR require continuous monitoring of deployed medical AI. MedAI implements automated post-market surveillance that collects real-world performance data without requiring manual chart review.

**Feedback Loop**:

```
Model produces finding --> Clinician reviews
                                |
                          +-----+------+
                          |            |
                       Confirm      Override
                          |            |
                     Record as     Record as
                     true positive  false positive/negative
                          |            |
                          +-----+------+
                                |
                          Aggregate into
                          RWP dashboard
                                |
                          Compare to
                          registry baseline
                                |
                     +----------+----------+
                     |                     |
                  Within bounds        Out of bounds
                     |                     |
                  Continue           Alert + review
                  monitoring         PCCP compliance
```

**Metrics Collected**:

| Metric | Frequency | Alert Threshold |
|--------|-----------|-----------------|
| Sensitivity (overall) | Daily | >5% decrease from baseline |
| Specificity (overall) | Daily | >3% decrease from baseline |
| Sensitivity (per subgroup) | Weekly | >8% decrease from baseline |
| Calibration ECE | Weekly | >0.05 |
| Average confidence | Daily | >10% shift from baseline |
| Override rate | Daily | >20% (indicates model disagreement with clinicians) |
| Processing latency p99 | Continuous | >30 seconds |
| System availability | Continuous | <99.9% uptime |

**Reporting**: MedAI generates PSUR (Periodic Safety Update Report) templates for EU MDR compliance and FDA annual reports automatically from the collected surveillance data.

### Bias Detection and Demographic Monitoring

MedAI continuously monitors model performance across demographic subgroups. This is not optional -- it is required by the FDA, EU MDR, and EU AI Act.

**Demographic Dimensions**:

| Dimension | Categories | Source |
|-----------|-----------|--------|
| Age | Pediatric, 18-45, 45-65, >65 | FHIR Patient.birthDate |
| Sex | Male, Female, Other, Unknown | FHIR Patient.gender |
| Race | Per OMB categories | FHIR Patient.extension (US Core Race) |
| Ethnicity | Hispanic/Latino, Not Hispanic/Latino | FHIR Patient.extension (US Core Ethnicity) |
| Insurance | Medicare, Medicaid, Private, Uninsured | FHIR Coverage |

**Bias Detection Algorithm**:

For each model and each demographic dimension, MedAI computes:

1. **Equalized Odds**: P(positive prediction | positive case) and P(positive prediction | negative case) should be equal across groups. Difference > 5% triggers review.
2. **Predictive Parity**: Positive predictive value should be equal across groups. Difference > 5% triggers review.
3. **Calibration Parity**: Calibration curves should be similar across groups. ECE difference > 0.03 triggers review.

When a bias alert fires, MedAI:
- Logs the alert to the audit trail
- Notifies the model owner and compliance team
- Optionally halts the model (configurable per severity)
- Generates a bias investigation report with the specific subgroup data

### API Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/nlp/extract` | POST | Clinical NLP extraction |
| `/v1/imaging/analyze` | POST | Medical image analysis |
| `/v1/cds/evaluate` | POST | Clinical decision support (risk scores, drug interactions) |
| `/v1/fhir/r4/{type}` | GET/POST | FHIR R4 resource access |
| `/v1/consent` | POST/GET/DELETE | Consent management |
| `/v1/explain/{id}/heatmap/{idx}` | GET | Attention heatmap (DICOM) |
| `/v1/explain/{id}/features` | GET | Feature importance |
| `/v1/explain/{id}/reasoning` | GET | Reasoning chain |
| `/v1/registry/models` | GET | Model registry listing |
| `/v1/registry/models/{id}` | GET | Model validation metadata |
| `/v1/surveillance/dashboard` | GET | Post-market surveillance metrics |
| `/v1/surveillance/bias` | GET | Demographic bias monitoring |
| `/v1/audit/events` | GET | Audit trail query |
| `/v1/health` | GET | Health check |
| `/v1/ready` | GET | Readiness check |

### Deployment Topology

```
Production deployment (per healthcare tenant):

+--------------------------------------------------+
|  HIPAA Compliance Boundary (VPC / namespace)     |
|                                                  |
|  +------------+  +------------+  +------------+  |
|  | MedAI API  |  | MedAI API  |  | MedAI API  |  |
|  | (replica)  |  | (replica)  |  | (replica)  |  |
|  +-----+------+  +-----+------+  +-----+------+  |
|        |               |               |         |
|  +-----v---------------v---------------v------+  |
|  |              Internal LB                    |  |
|  +-----+------------------+-------------------+  |
|        |                  |                      |
|  +-----v------+    +-----v------+               |
|  | Engine     |    | Engine     |               |
|  | (NLP GPU)  |    | (Imaging   |               |
|  |            |    |  GPU)      |               |
|  +------------+    +------------+               |
|                                                  |
|  +------------+    +------------+               |
|  | Guard      |    | Storage    |               |
|  | (PHI scan) |    | (DICOM/    |               |
|  |            |    |  FHIR)     |               |
|  +------------+    +------------+               |
|                                                  |
|  +------------+    +------------+               |
|  | Audit DB   |    | Consent DB |               |
|  | (immutable)|    |            |               |
|  +------------+    +------------+               |
+--------------------------------------------------+
```

Each healthcare tenant gets a dedicated namespace with:
- Isolated network policies (no cross-tenant traffic)
- Dedicated encryption keys (per-tenant KMS keys)
- Separate audit log storage
- Independent scaling of NLP and imaging GPU instances

## Security Considerations

### PHI Data Flow

PHI enters MedAI through two paths: clinical text in NLP requests and DICOM images in imaging requests. MedAI enforces the following security properties at every point in the data flow:

1. **In Transit**: TLS 1.3 mandatory. No plaintext PHI on any internal network link. Mutual TLS between MedAI components.
2. **At Rest**: AES-256-GCM encryption for all stored PHI. Keys managed by Hanzo KMS (HIP-0027) with per-tenant key isolation.
3. **In Memory**: PHI is zeroed from memory after processing. No PHI in swap files (mlock enabled for PHI buffers).
4. **In Logs**: Guard (HIP-0051) scans all log output for PHI. Any PHI detected in logs is redacted before persistence. Original PHI is never written to application logs.
5. **In Errors**: Error messages are sanitized. A failed inference returns a generic error code, never the patient data that caused the failure.
6. **In Metrics**: Prometheus metrics contain aggregate counts, never patient-level data. Histogram buckets are designed to prevent re-identification (minimum bucket size of 10 patients).

### Breach Response

If PHI exposure is detected (by Guard, by audit, or by external report):

1. MedAI automatically isolates the affected tenant namespace
2. All active sessions for the tenant are terminated
3. Audit logs for the affected time window are preserved with legal hold
4. Incident response team is notified via PagerDuty integration
5. Breach assessment report is generated automatically with affected patient count, data types exposed, and timeline
6. If breach is confirmed, HIPAA Breach Notification Rule clock starts (60 days to notify patients)

## Backwards Compatibility

MedAI is a new service. There is no backwards compatibility concern for the service itself. However, MedAI's FHIR R4 API is designed for forward compatibility:

- New FHIR resource types can be added without breaking existing integrations
- New fields on existing resources use FHIR extensions, not core field modifications
- API versioning via URL path (`/v1/`, `/v2/`) with minimum 24-month support per version
- DICOM SR (Structured Report) output follows DICOM SR template TID 1500 (Measurement Report) for interoperability with existing PACS systems

## Implementation Plan

| Phase | Timeline | Deliverables |
|-------|----------|-------------|
| 1. Core infrastructure | Months 1-3 | HIPAA-compliant Engine configuration, audit logging, consent engine, PHI storage |
| 2. Clinical NLP | Months 3-5 | NLP extraction pipeline, ICD-10/SNOMED/LOINC/RxNorm coding, FHIR resource generation |
| 3. Medical imaging | Months 5-8 | DICOM handling, radiology pipeline (chest X-ray, CT head), Grad-CAM explainability |
| 4. Regulatory submission | Months 8-12 | FDA 510(k) preparation, clinical validation study, EU MDR technical documentation |
| 5. Post-market surveillance | Months 10-14 | Real-world performance monitoring, bias detection, PSUR generation |
| 6. Additional modalities | Months 12-18 | Pathology (WSI), dermatology, ophthalmology pipelines |

## References

- FDA. (2021). Artificial Intelligence/Machine Learning (AI/ML)-Based Software as a Medical Device (SaMD) Action Plan.
- FDA. (2023). Marketing Submission Recommendations for a Predetermined Change Control Plan for AI/ML-Enabled Device Software Functions.
- European Parliament. (2024). Regulation (EU) 2024/1689 (AI Act).
- European Parliament. (2017). Regulation (EU) 2017/745 on Medical Devices (MDR).
- HHS. (1996). Health Insurance Portability and Accountability Act (HIPAA).
- HL7 International. (2019). FHIR Release 4 (R4). https://hl7.org/fhir/R4/
- DICOM Standards Committee. (2024). DICOM PS3.18 Web Services (DICOMweb).
- IHE International. (2023). AI Results Integration Profile.
- McKinney, S.M. et al. (2020). International evaluation of an AI system for breast cancer screening. Nature, 577(7788), 89-94.
- Abramoff, M.D. et al. (2018). Pivotal trial of an autonomous AI-based diagnostic system for detection of diabetic retinopathy. NPJ Digital Medicine, 1(1), 39.

## Copyright

Copyright 2026 Hanzo AI Inc. All rights reserved. This document is licensed under the Hanzo Improvement Proposal License.
