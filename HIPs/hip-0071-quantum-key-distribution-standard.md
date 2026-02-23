---
hip: 0071
title: Quantum Key Distribution Standard
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
created: 2026-02-23
requires: HIP-0005, HIP-0027, HIP-0054
---

# HIP-71: Quantum Key Distribution Standard

## Abstract

This proposal defines the Quantum Key Distribution (QKD) standard for the Hanzo ecosystem. QKD uses the laws of quantum mechanics --- not computational hardness assumptions --- to establish shared secret keys between two parties with information-theoretic security. An eavesdropper who intercepts a QKD transmission unavoidably disturbs the quantum states, revealing their presence.

Hanzo QKD integrates with the existing post-quantum cryptography layer (HIP-0005), secrets management (HIP-0027), and Zero Trust architecture (HIP-0054) to provide a layered defense: QKD secures the highest-value channels (inter-cluster links, model weight transfers, root key establishment), while PQ cryptography protects everything else. This hybrid approach acknowledges that QKD hardware is expensive, range-limited, and not yet deployable everywhere --- but for the links that matter most, it provides a guarantee that no future mathematical breakthrough or quantum computer can compromise.

The QKD service runs on port 8071 and exposes a hardware-abstracted API for key request, key delivery, and channel monitoring. It supports three protocol families: BB84 (prepare-and-measure), E91/Ekert91 (entanglement-based), and CV-QKD (continuous-variable). A trusted node relay architecture extends QKD beyond point-to-point range limitations.

**Repository**: [github.com/hanzoai/qkd](https://github.com/hanzoai/qkd)
**Port**: 8071 (API), 8072 (health/metrics)
**Docker**: `ghcr.io/hanzoai/qkd:latest`
**ETSI Compliance**: GS QKD 004, GS QKD 014, GS QKD 018

## Motivation

### Why AI Infrastructure Needs QKD

AI model weights are among the most valuable digital assets in existence. A frontier model represents tens of millions of dollars in compute, months of researcher time, and proprietary training data. The security implications are distinct from traditional data protection:

1. **Billion-dollar intellectual property**: A single exfiltrated model --- weights, architecture, training recipe --- can be replicated indefinitely at marginal cost. Unlike a stolen credit card number (which can be revoked), stolen model weights are permanently compromised. There is no "rotate your model weights" procedure.

2. **Nation-state adversaries**: State-sponsored actors actively target AI research. The combination of economic value and strategic military applications makes model weights a Tier 1 intelligence target. These adversaries have the resources to operate quantum computers when they become available --- and the patience to stockpile encrypted traffic today for decryption tomorrow ("harvest now, decrypt later").

3. **Long-term secrecy requirements**: A model trained today may be commercially valuable for 5-10 years. Encrypted model weight transfers captured today must remain confidential for at least that duration. Post-quantum cryptography (HIP-0005) protects against known quantum algorithms, but its security rests on computational hardness assumptions that could be broken by future mathematical advances. QKD's security rests on physics.

4. **Key establishment as the weakest link**: Even with PQ-encrypted channels, the security of any symmetric cipher depends on how the key was established. If the key exchange is compromised --- by a flaw in the PQ algorithm, a side-channel attack on the implementation, or a breakthrough in lattice cryptanalysis --- all data encrypted with that key is exposed. QKD provides a key establishment mechanism whose security is independent of computational assumptions.

### Why Not QKD for Everything

QKD is not a replacement for PQ cryptography. It is an additional layer for the highest-security channels. The limitations are real:

- **Range**: Current QKD hardware operates reliably over 50-100 km of fiber. Beyond that, photon loss makes key rates impractical. Free-space (satellite) QKD extends range but requires line-of-sight and is weather-dependent.
- **Cost**: A QKD link requires specialized hardware at both endpoints --- single-photon sources, detectors, and quantum random number generators. A pair of QKD devices costs $100,000-500,000 depending on the vendor and protocol.
- **Throughput**: QKD key generation rates are measured in kilobits per second, not gigabits. A BB84 link over 50 km of fiber produces roughly 1-10 kbit/s of secret key material. This is sufficient for establishing symmetric keys (256 bits per key) but not for encrypting bulk data directly.
- **Point-to-point**: QKD is inherently a two-party protocol. Extending it to a network requires trusted relay nodes or quantum repeaters (which do not yet exist commercially).

The hybrid strategy: use QKD to establish keys for the links that carry the highest-value traffic (inter-cluster, model weight transfers, root key distribution), and use PQ cryptography (HIP-0005) for everything else. This gives information-theoretic security where it matters most, and computational security everywhere else.

### The Physics: Why QKD Works

QKD's security guarantee comes from two principles of quantum mechanics. No understanding of the mathematics is required --- the intuition is physical.

**Principle 1: The No-Cloning Theorem.** In classical computing, you can copy a bit perfectly: read a 0, write a 0 elsewhere. In quantum mechanics, you cannot copy an unknown quantum state. If Alice sends a single photon encoding a bit to Bob, an eavesdropper (Eve) cannot make a perfect copy of that photon. She must measure it, which brings us to the second principle.

**Principle 2: Measurement Disturbs the State.** When Eve measures a quantum state, the measurement changes it. If Alice encodes a bit in the polarization of a photon (horizontal = 0, vertical = 1), and Eve measures it in the wrong basis (diagonal instead of rectilinear), she gets a random result and irreversibly disturbs the photon. When Bob receives the disturbed photon and measures it in the correct basis, he gets the wrong answer some fraction of the time.

Alice and Bob can detect Eve's presence by comparing a random subset of their measurement results over a public channel. If too many results disagree (the Quantum Bit Error Rate, or QBER, exceeds a threshold), they know the channel was intercepted and discard the key. If the QBER is below threshold, they have high confidence that the key bits were transmitted without interception, and they proceed to distill a shorter, perfectly secret key through classical error correction and privacy amplification.

This is not security through obscurity or computational difficulty. It is security through physics. Even an adversary with unlimited computational power --- including a universal quantum computer --- cannot intercept QKD without detection, because the no-cloning theorem and measurement disturbance are fundamental laws, not engineering assumptions.

## Design Philosophy

### Why Three Protocol Families

Hanzo QKD supports three protocol families because no single protocol optimizes for all deployment scenarios:

**BB84 (Bennett-Brassard 1984)** is the original QKD protocol. Alice prepares single photons in random states from two conjugate bases (rectilinear: H/V, and diagonal: +45/-45) and sends them to Bob. Bob measures each photon in a randomly chosen basis. They publicly compare bases (not results), keep only the bits where they chose the same basis, and perform error correction and privacy amplification. BB84 is the most mature, best-understood, and most widely implemented protocol. It is the default for production deployments.

**E91 (Ekert 1991)** uses quantum entanglement. A source (which can be at a midpoint between Alice and Bob) generates pairs of entangled photons --- one to Alice, one to Bob. When both measure their photon, the results are correlated in a way that no classical system can replicate (a violation of Bell's inequality). The correlation produces shared random bits; the Bell test proves no eavesdropper was present. E91's advantage is that the photon source can be untrusted --- security comes from the entanglement correlations, not from trusting the source. This matters for relay architectures where the midpoint node may be in a less-secure facility.

**CV-QKD (Continuous-Variable QKD)** encodes information in the continuous quadratures (amplitude and phase) of coherent laser light, rather than in single photons. It uses standard telecom components (homodyne detectors, balanced receivers) instead of single-photon detectors, which are expensive and fragile. CV-QKD achieves higher key rates at short distances (< 25 km) and is better suited for metropolitan-area networks where telecom fiber is abundant. The tradeoff is lower range and more complex security proofs.

| Protocol | Range | Key Rate | Hardware Cost | Maturity | Best For |
|----------|-------|----------|---------------|----------|----------|
| BB84 | 50-100 km | 1-10 kbit/s | High (SPDs) | Production | Inter-cluster links |
| E91 | 50-100 km | 0.5-5 kbit/s | High (entangled source) | Pilot | Untrusted relay nodes |
| CV-QKD | 10-25 km | 10-100 kbit/s | Medium (telecom parts) | Production | Metro/datacenter links |

### Why a Hardware Abstraction Layer

QKD hardware is a nascent market with incompatible vendor APIs. ID Quantique (Geneva) exposes a REST API. Toshiba QKD (Cambridge) uses a proprietary binary protocol. QuintessenceLabs (Canberra) implements the ETSI QKD 014 key delivery API. Without an abstraction layer, every integration is a bespoke point solution.

The Hanzo QKD Hardware Abstraction Layer (HAL) provides a uniform interface:

```go
// HAL interface - every QKD device driver implements this
type QKDDevice interface {
    // Initialize the device with configuration
    Init(cfg DeviceConfig) error

    // Request a block of key material (in bits)
    RequestKey(ctx context.Context, bits int) (*KeyBlock, error)

    // Get current channel quality metrics
    ChannelStatus() (*ChannelMetrics, error)

    // Get device health and diagnostics
    Health() (*DeviceHealth, error)
}

type KeyBlock struct {
    KeyID     string    // Unique identifier for this key block
    Material  []byte    // Raw key material
    Bits      int       // Number of key bits
    QBER      float64   // Measured QBER for this block
    KeyRate   float64   // Bits per second at time of generation
    Protocol  string    // "bb84", "e91", or "cvqkd"
    Timestamp time.Time // When the key was generated
}

type ChannelMetrics struct {
    QBER         float64 // Current quantum bit error rate
    KeyRate      float64 // Current key generation rate (bits/sec)
    PhotonRate   float64 // Detected photon rate
    Visibility   float64 // Optical visibility (0-1)
    LinkLoss     float64 // Channel loss in dB
    Temperature  float64 // Device temperature (Celsius)
    Uptime       time.Duration
}
```

Drivers for each vendor are implemented as Go packages:

| Driver | Package | Vendor | Protocol Support |
|--------|---------|--------|-----------------|
| IDQ Clavis | `github.com/hanzoai/qkd/driver/idq` | ID Quantique | BB84 |
| Toshiba MKPS | `github.com/hanzoai/qkd/driver/toshiba` | Toshiba | BB84, CV-QKD |
| QLabs qOptica | `github.com/hanzoai/qkd/driver/qlabs` | QuintessenceLabs | BB84, CV-QKD |
| Simulator | `github.com/hanzoai/qkd/driver/sim` | (test/dev) | All |

The simulator driver generates key material from a CSPRNG and simulates realistic QBER and key rate fluctuations. It enables development and testing without physical QKD hardware.

### Why ETSI Standards

The European Telecommunications Standards Institute (ETSI) Industry Specification Group on QKD (ISG-QKD) publishes the only international standards for QKD interfaces and security. Compliance ensures interoperability and establishes a baseline for security certification:

- **GS QKD 004**: Application Interface. Defines the API between the QKD system and the application that consumes keys. Our HAL implements this interface.
- **GS QKD 014**: Protocol and Data Format for the Key Delivery API. Defines how keys are requested, delivered, and acknowledged between QKD nodes and key management systems. Our KMS integration (HIP-0027) follows this format.
- **GS QKD 018**: Orchestration Interface. Defines how a network controller provisions and manages QKD links. Our relay architecture implements this for multi-hop key distribution.

## Specification

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Hanzo QKD Architecture                       │
│                                                                  │
│  ┌────────────┐    Quantum Channel (fiber)    ┌────────────┐    │
│  │ QKD Device │◄══════════════════════════════►│ QKD Device │    │
│  │ (Alice)    │    (single photons / CV)       │ (Bob)      │    │
│  └─────┬──────┘                                └─────┬──────┘   │
│        │ HAL API                                     │ HAL API  │
│  ┌─────┴──────┐    Classical Channel (TCP)    ┌─────┴──────┐   │
│  │ QKD Agent  │◄──────────────────────────────►│ QKD Agent  │   │
│  │ (port 8071)│    (sifting, EC, PA)           │ (port 8071)│   │
│  └─────┬──────┘                                └─────┬──────┘   │
│        │                                             │          │
│  ┌─────┴──────┐                                ┌─────┴──────┐  │
│  │    KMS     │    QKD keys stored via          │    KMS     │  │
│  │ (HIP-0027) │    ETSI QKD 014 API            │ (HIP-0027) │  │
│  └─────┬──────┘                                └─────┴──────┘  │
│        │                                             │          │
│  ┌─────┴──────────────────────────────────────────────┴──────┐  │
│  │              Consuming Services                           │  │
│  │  ZT (HIP-0054)  │  WireGuard  │  Model Transfer Pipeline │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Each QKD link has two components:
1. **Quantum channel**: The physical fiber (or free-space path) carrying quantum states. This channel is one-way and cannot be amplified or split without disturbing the states.
2. **Classical channel**: A standard TCP connection for protocol messages (basis reconciliation, error correction, privacy amplification). This channel must be authenticated (via PQ signatures from HIP-0005) but does not need to be secret.

### QKD Agent Service

The QKD Agent is the central service at each endpoint. It orchestrates the QKD protocol, interfaces with hardware via the HAL, and delivers distilled keys to KMS.

#### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/keys/request` | Request key material from a specific QKD link |
| GET | `/v1/keys/{key_id}` | Retrieve a previously generated key by ID |
| GET | `/v1/links` | List all QKD links and their status |
| GET | `/v1/links/{link_id}/metrics` | Get channel metrics for a link |
| GET | `/v1/links/{link_id}/qber` | Get QBER history (time series) |
| POST | `/v1/links/{link_id}/calibrate` | Trigger channel calibration |
| GET | `/v1/relay/routes` | List available relay routes |
| POST | `/v1/relay/keys/request` | Request key via trusted relay path |
| GET | `/healthz` | Health check (port 8072) |
| GET | `/metrics` | Prometheus metrics (port 8072) |

#### Key Request Flow

```
Application              QKD Agent (8071)           HAL Driver          QKD Device
    │                         │                        │                    │
    │ POST /v1/keys/request   │                        │                    │
    │ { bits: 256,            │                        │                    │
    │   link_id: "hk-lk-1" } │                        │                    │
    ├────────────────────────►│                        │                    │
    │                         │  RequestKey(256)       │                    │
    │                         ├───────────────────────►│                    │
    │                         │                        │  Hardware I/O      │
    │                         │                        ├───────────────────►│
    │                         │                        │  Raw quantum bits  │
    │                         │                        │◄───────────────────┤
    │                         │  KeyBlock              │                    │
    │                         │◄───────────────────────┤                    │
    │                         │                        │                    │
    │                         │  [Error Correction]    │                    │
    │                         │  [Privacy Amplification]                    │
    │                         │  [QBER Check]          │                    │
    │                         │                        │                    │
    │  { key_id: "qk-...",   │                        │                    │
    │    bits: 256,           │                        │                    │
    │    qber: 0.023 }        │                        │                    │
    │◄────────────────────────┤                        │                    │
    │                         │                        │                    │
    │                         │  Store in KMS          │                    │
    │                         │  (ETSI QKD 014)        │                    │
    │                         ├───────────────────────►KMS                  │
```

#### QBER Thresholds and Alarms

The Quantum Bit Error Rate is the primary indicator of channel quality and security. QBER is the fraction of bits where Alice and Bob's values disagree after basis reconciliation.

| QBER Range | Status | Action |
|------------|--------|--------|
| 0.0 - 3.0% | Nominal | Normal key generation |
| 3.0 - 5.0% | Degraded | Alert; increase error correction redundancy |
| 5.0 - 8.0% | Warning | Alert; reduce key rate; investigate channel |
| 8.0 - 11.0% | Critical | Suspend key generation; channel may be compromised |
| > 11.0% | Compromised | Halt immediately; no secure key extraction possible |

The 11% threshold for BB84 is the theoretical limit: above this QBER, an eavesdropper could have gained enough information to reconstruct the key, and privacy amplification cannot compensate. This is not a tunable parameter --- it is a consequence of the protocol's information-theoretic security proof.

#### Key Rate Estimation

The secure key rate after error correction and privacy amplification is:

```
R_secure = R_raw * [1 - H(QBER) - H(QBER)]
```

where `H(x) = -x*log2(x) - (1-x)*log2(1-x)` is the binary entropy function. At 3% QBER, roughly 70% of raw key bits survive. At 8% QBER, less than 20% survive. The QKD Agent reports both raw and secure key rates in its metrics.

### Integration with KMS (HIP-0027)

QKD-derived keys are stored in KMS using a dedicated project and environment:

```
Organization: hanzo
  Project: qkd-keys
    Environment: production
      Folder: /inter-cluster/
        Key: QKD_HANZO_LUX_AES256_CURRENT     = <base64 key material>
        Key: QKD_HANZO_LUX_AES256_PREVIOUS    = <base64 previous key>
        Key: QKD_HANZO_LUX_KEY_ID             = qk-2026-02-23-001
        Key: QKD_HANZO_LUX_QBER               = 0.023
        Key: QKD_HANZO_LUX_GENERATED_AT       = 2026-02-23T14:30:00Z
      Folder: /model-transfer/
        Key: QKD_MODEL_XFER_AES256_CURRENT    = <base64 key material>
        ...
```

The QKD Agent pushes new keys to KMS via the Universal Auth flow (HIP-0027). Services that consume QKD-derived keys (WireGuard for inter-cluster, model transfer pipelines) fetch them from KMS like any other secret --- they do not interact with QKD hardware directly. This separation of concerns means consuming services are unaware of the key's quantum origin; they see only a 256-bit AES key in KMS.

Key rotation is driven by the QKD Agent:
1. QKD Agent generates a new key block via the quantum channel
2. Agent stores the new key as `*_CURRENT` in KMS, moves the old `*_CURRENT` to `*_PREVIOUS`
3. KMS Operator syncs the updated secret to Kubernetes
4. Consuming services pick up the new key on next resync cycle (60s per HIP-0027)
5. The `*_PREVIOUS` key is retained for in-flight traffic that was encrypted with the old key

### Integration with Zero Trust (HIP-0054)

The inter-cluster WireGuard link between hanzo-k8s and lux-k8s (defined in HIP-0054) is the primary consumer of QKD keys. Today, WireGuard uses Curve25519 key exchange. With QKD integration, the key exchange shifts to QKD-derived symmetric keys:

```
┌─────────────────────┐                     ┌─────────────────────┐
│     hanzo-k8s       │                     │      lux-k8s        │
│                     │                     │                     │
│  ┌───────────────┐  │  QKD fiber link     │  ┌───────────────┐  │
│  │ QKD Device    │◄═╪═════════════════════╪═►│ QKD Device    │  │
│  │ (Alice)       │  │                     │  │ (Bob)         │  │
│  └───────┬───────┘  │                     │  └───────┬───────┘  │
│          │          │                     │          │          │
│  ┌───────┴───────┐  │                     │  ┌───────┴───────┐  │
│  │ QKD Agent     │  │  Classical (TCP)    │  │ QKD Agent     │  │
│  │ port 8071     │◄─┼────────────────────►┼──│ port 8071     │  │
│  └───────┬───────┘  │                     │  └───────┬───────┘  │
│          │          │                     │          │          │
│  ┌───────┴───────┐  │                     │  ┌───────┴───────┐  │
│  │     KMS       │  │                     │  │     KMS       │  │
│  └───────┬───────┘  │                     │  └───────┬───────┘  │
│          │          │                     │          │          │
│  ┌───────┴───────┐  │  WireGuard tunnel   │  ┌───────┴───────┐  │
│  │  wg-gateway   │◄─┼──(QKD-derived key)─►┼──│  wg-gateway   │  │
│  │  10.10.0.1    │  │  UDP 51820          │  │  10.10.0.2    │  │
│  └───────────────┘  │                     │  └───────────────┘  │
└─────────────────────┘                     └─────────────────────┘
```

The WireGuard configuration is updated to use a pre-shared key (PSK) derived from QKD, layered on top of the existing Curve25519 exchange:

```ini
[Peer]
PublicKey = <lux-k8s-public-key>
PresharedKey = <qkd-derived-256-bit-key>
AllowedIPs = 10.10.0.2/32, 10.244.0.0/16
Endpoint = 24.144.69.101:51820
```

WireGuard's PSK mechanism provides exactly the layering we need: the Curve25519 exchange provides computational security (and PQ security once migrated per HIP-0005), while the QKD-derived PSK provides information-theoretic security. An attacker must break both to compromise the tunnel.

### Integration with Post-Quantum Crypto (HIP-0005)

QKD and PQ cryptography are complementary, not competing:

| Property | PQ Crypto (HIP-0005) | QKD (this HIP) |
|----------|---------------------|-----------------|
| Security basis | Computational hardness (lattice problems) | Laws of physics |
| Deployment | Software-only, universal | Requires hardware, point-to-point |
| Range | Unlimited (Internet) | 50-100 km (fiber) |
| Cost | Negligible (CPU cycles) | $100K-500K per link |
| Maturity | NIST standardized (FIPS 203/204) | ETSI standards, commercial hardware |
| Vulnerability | Future mathematical breakthroughs | Implementation side-channels |

The layering strategy:
1. **All traffic**: PQ crypto (ML-KEM-768 + X25519 hybrid) per HIP-0005
2. **Inter-cluster links**: PQ crypto + QKD-derived PSK (this HIP)
3. **Model weight transfers**: PQ crypto + QKD-derived session keys
4. **Root key establishment**: QKD-derived keys stored in KMS for annual root key rotation

### Trusted Node Relay Architecture

Point-to-point QKD is limited to ~100 km. To extend QKD to longer distances (e.g., between datacenters in different cities), we use a trusted node relay:

```
    Site A                 Relay Node R              Site B
┌──────────┐          ┌──────────────┐          ┌──────────┐
│ QKD-A    │◄════════►│ QKD-R1 QKD-R2│◄════════►│ QKD-B    │
│          │  Link 1  │              │  Link 2  │          │
│ Key: K1  │  (<100km)│ Key: K1, K2  │  (<100km)│ Key: K2  │
└──────────┘          └──────────────┘          └──────────┘
                            │
                  K_AB = K1 XOR K2
                  (sent to B over
                   authenticated channel)
```

The relay procedure:
1. Site A and Relay R establish a shared key K1 via QKD Link 1
2. Relay R and Site B establish a shared key K2 via QKD Link 2
3. Relay R computes K_AB = K1 XOR K2 and sends K_AB to Site B over an authenticated classical channel
4. Site B computes K1 = K_AB XOR K2, recovering the end-to-end key K1
5. Sites A and B now share K1 without the relay knowing it (the relay knows K1 and K2 individually, but K_AB alone reveals neither)

**Trust model**: The relay node must be trusted not to collude with an eavesdropper. If the relay is compromised, the end-to-end key is exposed. This is a genuine limitation. Mitigation: relay nodes are deployed in physically secured facilities with tamper-evident enclosures, and their access is governed by ZT policy (HIP-0054). Future quantum repeaters will eliminate this trust requirement, but they are not yet commercially available.

The relay architecture supports multi-hop chains for spanning greater distances. The QKD Agent's `/v1/relay/routes` endpoint returns available relay paths with their cumulative key rates and trust assessments.

### Deployment Configuration

The QKD Agent runs as a Kubernetes Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qkd-agent
  namespace: hanzo
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: qkd-agent
          image: ghcr.io/hanzoai/qkd:latest
          ports:
            - containerPort: 8071
              name: api
            - containerPort: 8072
              name: health
          env:
            - name: QKD_DRIVER
              value: "idq"  # or "toshiba", "qlabs", "sim"
            - name: QKD_DEVICE_ADDR
              value: "192.168.100.10:8443"
            - name: QKD_LINK_ID
              value: "hanzo-lux-1"
            - name: QKD_PROTOCOL
              value: "bb84"
            - name: QKD_QBER_THRESHOLD
              value: "0.08"
            - name: QKD_KEY_ROTATION_INTERVAL
              value: "3600"  # seconds
            - name: KMS_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: qkd-kms-auth
                  key: clientId
            - name: KMS_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: qkd-kms-auth
                  key: clientSecret
          resources:
            requests:
              memory: "256Mi"
              cpu: "200m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8072
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8072
            initialDelaySeconds: 30
            periodSeconds: 30
```

### Prometheus Metrics

```
# Key generation
qkd_keys_generated_total{link_id="...", protocol="bb84|e91|cvqkd"}
qkd_key_bits_generated_total{link_id="..."}
qkd_secure_key_rate_bps{link_id="..."}
qkd_raw_key_rate_bps{link_id="..."}

# Channel quality
qkd_qber{link_id="..."}
qkd_channel_loss_db{link_id="..."}
qkd_photon_rate_hz{link_id="..."}
qkd_visibility{link_id="..."}

# Alarms
qkd_qber_threshold_exceeded_total{link_id="...", severity="warning|critical"}
qkd_key_generation_halted_total{link_id="..."}

# Device health
qkd_device_temperature_celsius{link_id="..."}
qkd_device_uptime_seconds{link_id="..."}

# KMS integration
qkd_kms_key_push_total{link_id="...", status="success|failure"}
qkd_kms_key_push_latency_seconds{link_id="..."}
```

## Implementation

### Phase 1: Simulator and API (Q2 2026)
- QKD Agent service with HAL interface
- Simulator driver for development and testing
- KMS integration (key push/pull)
- ETSI QKD 004/014 compliant API
- Prometheus metrics and alerting
- Documentation and integration tests

### Phase 2: Hardware Pilot (Q3 2026)
- Deploy ID Quantique Clavis devices on hanzo-k8s <-> lux-k8s fiber link
- BB84 protocol in production
- WireGuard PSK integration (inter-cluster)
- QBER monitoring dashboard in Visor (HIP-0053)
- Operational runbooks for hardware maintenance

### Phase 3: Relay and Multi-Protocol (Q4 2026)
- Trusted node relay for extended range
- CV-QKD driver for metro-area links
- E91 pilot for untrusted relay scenarios
- Multi-link key management
- ETSI QKD 018 orchestration interface

### Phase 4: Production Hardening (Q1 2027)
- Side-channel analysis and countermeasures
- Formal security audit by third-party cryptography lab
- Key rate optimization and adaptive protocol selection
- Satellite QKD evaluation (if hardware available)
- Full ETSI certification

### Timeline for Practical Deployment

QKD is not science fiction. Commercial QKD systems have been deployed by:
- **China**: Beijing-Shanghai QKD backbone (2,000 km with 32 relay nodes, operational since 2017)
- **South Korea**: SK Telecom metropolitan QKD network (operational since 2019)
- **EU**: EuroQCI initiative connecting all 27 EU member states (deployment 2024-2027)
- **UK**: UK Quantum Network (Bristol-London backbone, operational since 2022)

For Hanzo, the practical deployment path starts with a single inter-cluster link (hanzo-k8s to lux-k8s, both in DigitalOcean NYC region, fiber distance < 10 km) using commercial BB84 hardware. This is a solved problem with off-the-shelf equipment. The relay architecture extends this to future multi-datacenter deployments.

## Security Considerations

### Threat Model

| Threat | Without QKD | With QKD |
|--------|------------|----------|
| Harvest now, decrypt later | PQ crypto is the only defense; vulnerable to future breakthroughs | QKD keys are information-theoretically secure; no future attack can recover them |
| Quantum computer breaks key exchange | PQ algorithms may have unknown weaknesses | QKD security is physics-based; quantum computers cannot help an eavesdropper |
| Fiber tap on inter-cluster link | Detected only if traffic analysis reveals anomalies | Detected immediately via QBER spike; key generation halts |
| Compromised relay node | N/A (no relay in current architecture) | Relay learns individual link keys; mitigated by physical security and ZT policy |
| QKD device side-channel | N/A | Addressed by ETSI-certified hardware and periodic security audits |
| Denial of service on quantum channel | N/A | Attacker can disrupt QKD by disturbing the channel; fallback to PQ-only mode |

### Side-Channel Considerations

QKD's information-theoretic security proof assumes ideal hardware. Real devices have imperfections:

- **Photon number splitting (PNS)**: If the source emits multi-photon pulses, Eve can split off extra photons without disturbing Bob's measurement. Mitigation: decoy-state BB84 (implemented by all modern QKD hardware) uses variable-intensity pulses to detect PNS attacks.
- **Detector blinding**: Eve shines bright light at Bob's single-photon detectors, forcing them into classical mode where she can control their output. Mitigation: measurement-device-independent (MDI) QKD protocols; detector monitoring circuits in certified hardware.
- **Trojan horse attacks**: Eve sends light into Alice's device to read the state of her modulator. Mitigation: optical isolators and power monitoring at device inputs.

These are implementation attacks, not attacks on the protocol. They are addressed by using certified hardware (ETSI GS QKD 004 includes security requirements for devices) and periodic third-party security audits.

### Fallback Policy

If the QKD channel is disrupted (fiber cut, device failure, sustained high QBER), the system falls back to PQ-only mode:

1. QKD Agent detects channel failure (QBER > threshold for 60 consecutive seconds, or device health check fails)
2. Agent sets link status to `DEGRADED` and emits `qkd_key_generation_halted_total` metric
3. Alert fires to on-call SRE via Visor (HIP-0053)
4. Consuming services continue using the last QKD-derived key in KMS until it expires (configurable, default 24 hours)
5. After expiry, WireGuard tunnel falls back to Curve25519-only (or ML-KEM hybrid per HIP-0005)
6. When QKD channel recovers, Agent resumes key generation and pushes fresh keys to KMS

The system is never without encryption. QKD adds a layer; its absence degrades security to "merely" PQ-cryptographic, which is still far beyond classical.

### Compliance

| Standard | Requirement | How Hanzo QKD Satisfies |
|----------|------------|------------------------|
| ETSI GS QKD 004 | Application interface | HAL implements QKD 004 API |
| ETSI GS QKD 014 | Key delivery format | KMS integration uses QKD 014 data format |
| ETSI GS QKD 018 | Orchestration interface | Relay routing implements QKD 018 |
| NIST SP 800-57 | Key management | Keys stored in KMS per HIP-0027 |
| NIST SP 800-207 | Zero Trust | QKD keys consumed via ZT architecture (HIP-0054) |
| FIPS 197 | AES encryption | QKD-derived keys used as AES-256 symmetric keys |

## References

1. [Bennett, C.H. and Brassard, G. (1984). "Quantum cryptography: Public key distribution and coin tossing"](https://doi.org/10.1016/j.tcs.2014.05.025) - The original BB84 paper
2. [Ekert, A.K. (1991). "Quantum cryptography based on Bell's theorem"](https://doi.org/10.1103/PhysRevLett.67.661) - The E91 entanglement-based protocol
3. [ETSI GS QKD 004 v2.1.1](https://www.etsi.org/deliver/etsi_gs/QKD/001_099/004/) - Application Interface
4. [ETSI GS QKD 014 v1.1.1](https://www.etsi.org/deliver/etsi_gs/QKD/001_099/014/) - Protocol and Data Format for Key Delivery
5. [ETSI GS QKD 018 v1.1.1](https://www.etsi.org/deliver/etsi_gs/QKD/001_099/018/) - Orchestration Interface
6. [Scarani, V. et al. (2009). "The security of practical quantum key distribution"](https://doi.org/10.1103/RevModPhys.81.1301) - Comprehensive security analysis of QKD protocols
7. [Lo, H.-K. et al. (2014). "Secure quantum key distribution"](https://doi.org/10.1038/nphoton.2014.149) - Review of QKD security proofs and practical implementations
8. [HIP-0005: Post-Quantum Security for AI Infrastructure](./hip-0005-post-quantum-security-for-ai-infrastructure.md) - PQ cryptography standard
9. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) - KMS for key storage
10. [HIP-0054: Zero Trust Architecture Standard](./hip-0054-zero-trust-architecture-standard.md) - Inter-cluster security
11. [ID Quantique Clavis QKD Platform](https://www.idquantique.com/quantum-safe-security/products/clavis-qkd-platform/) - Commercial BB84 hardware
12. [WireGuard Pre-Shared Keys](https://www.wireguard.com/#cryptokey-routing) - PSK mechanism for QKD integration
13. [Hanzo QKD Repository](https://github.com/hanzoai/qkd)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
