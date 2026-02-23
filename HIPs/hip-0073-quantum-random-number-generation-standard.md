---
hip: 0073
title: Quantum Random Number Generation Standard
author: Hanzo AI Team
type: Standards Track
category: Security
status: Draft
created: 2026-02-23
requires: HIP-0005, HIP-0027
---

# HIP-73: Quantum Random Number Generation Standard

## Abstract

This proposal defines the Quantum Random Number Generation (QRNG) standard for the Hanzo ecosystem. It specifies a hardware-abstracted service that produces true random numbers derived from quantum physical processes, exposes them via a simple `/entropy` HTTP endpoint, and integrates with Hanzo KMS (HIP-0027) for seeding cryptographic key generation, with QKD infrastructure (HIP-0071) for protocol randomness, and with blockchain nodes (HIP-0020) for provably fair on-chain randomness.

Classical pseudorandom number generators (PRNGs) are deterministic: given the seed, every output is predictable. Hardware random number generators (HWRNGs) based on thermal noise or electrical jitter improve on this but may carry subtle biases and are not provably unpredictable. Quantum random number generators exploit the fundamental indeterminacy of quantum mechanics -- outcomes that no theory, no matter how complete, can predict. This is not a practical limitation but a physical law.

The reference implementation is Hanzo QRNG, a Go service that abstracts over multiple quantum entropy sources, performs NIST SP 800-90B compliant health testing, applies randomness extraction, and serves conditioned entropy to consumers.

**Repository**: [github.com/hanzoai/qrng](https://github.com/hanzoai/qrng)
**Port**: 8073

## Motivation

### Why Randomness Matters

Randomness is a primitive. It underpins:

1. **Cryptographic key generation**: Every RSA modulus, every elliptic curve private key, every AES session key starts as a random number. If the random number is predictable, the key is predictable, and the cryptosystem is broken regardless of the algorithm's mathematical strength.
2. **Blockchain consensus**: Verifiable Random Functions (VRFs) in Lux consensus require unpredictable input. Predictable randomness enables validator manipulation.
3. **AI model training**: Weight initialization, dropout masks, data shuffling, and stochastic gradient descent all consume randomness. Biased randomness can introduce subtle correlations that degrade model quality.
4. **Differential privacy**: Privacy guarantees depend on noise drawn from a specific distribution. If the noise source is biased or predictable, the privacy guarantee is void.
5. **Monte Carlo methods**: Simulation accuracy depends directly on the statistical quality of the random number stream.

### Why Classical PRNGs Are Insufficient

A PRNG is a deterministic function: `state_{n+1} = f(state_n)`. Given any state, all future outputs are determined. The security of a PRNG rests entirely on the secrecy of its internal state and the quality of its initial seed. This creates three classes of vulnerability:

**State compromise**: If an attacker reads the PRNG state (via memory disclosure, side channel, or cold boot attack), all past and future outputs are known. The 2008 Debian OpenSSL bug reduced the PRNG seed space to 32,768 values, making every SSL key generated on affected systems trivially breakable.

**Seed quality**: A PRNG is only as good as its seed. If the seed comes from a low-entropy source (boot time, process ID, `time.Now()`), the output space collapses. The Android SecureRandom vulnerability (2013) produced repeated ECDSA nonces due to poor seeding, enabling private key recovery from Bitcoin wallets.

**Algorithmic predictability**: Even with a perfect seed, a PRNG's output is computationally distinguishable from true randomness by an adversary with sufficient resources. For post-quantum security (HIP-0005), we must assume adversaries with quantum computers -- Grover's algorithm halves the effective security of any PRNG state.

### Why Quantum Randomness Is Different

Quantum mechanics provides a source of randomness that is not merely practically unpredictable but *fundamentally* unpredictable. This is not a claim about computational difficulty. It is a consequence of the laws of physics.

Consider the simplest quantum random event: a single photon encountering a balanced beam splitter. The photon is transmitted or reflected with equal probability. Quantum mechanics states that this outcome is not determined by any hidden variable -- it is intrinsically random. The Bell theorem (1964) and subsequent experimental violations of Bell inequalities (Aspect 1982, Hensen 2015) prove that no local hidden-variable theory can reproduce quantum predictions. The randomness is not due to ignorance of the system's state. There is no state to be ignorant of.

This gives QRNG a property that no classical source can match: **the randomness is certified by physics, not by computational assumptions**. Even an adversary with unlimited computational power (including a quantum computer) cannot predict the output of a properly implemented QRNG.

### Why Now

Three developments make QRNG practical for infrastructure deployment:

1. **Integrated QRNG chips**: ID Quantique's Quantis series, QuintessenceLabs qStream, and Quside's FMC series now ship as PCIe cards, USB devices, and chip-on-board modules. Prices have dropped from $50,000 (2010) to under $1,000 per device.
2. **Cloud QRNG services**: AWS, Azure, and dedicated providers (Quantinuum, ID Quantique) offer QRNG-as-a-service APIs, eliminating the need for local hardware in non-airgapped environments.
3. **Regulatory pressure**: NIST SP 800-90C (draft) recommends quantum entropy sources for high-security applications. The NSA's CNSA 2.0 suite mandates transition to quantum-resistant cryptography by 2035, and QRNG is the natural complement.

## Specification

### Architecture

```
                    ┌──────────────────────────────┐
                    │       QRNG Service           │
                    │       (port 8073)            │
                    ├──────────────────────────────┤
                    │                              │
                    │   ┌────────────────────┐     │
                    │   │   /entropy API      │     │
                    │   │   /health           │     │
                    │   │   /metrics          │     │
                    │   └─────────┬──────────┘     │
                    │             │                 │
                    │   ┌─────────▼──────────┐     │
                    │   │  Entropy Pool       │     │
                    │   │  (conditioned bits) │     │
                    │   └─────────┬──────────┘     │
                    │             │                 │
                    │   ┌─────────▼──────────┐     │
                    │   │  Randomness         │     │
                    │   │  Extractor          │     │
                    │   │  (Toeplitz hash)    │     │
                    │   └─────────┬──────────┘     │
                    │             │                 │
                    │   ┌─────────▼──────────┐     │
                    │   │  Health Testing     │     │
                    │   │  (NIST 800-90B)    │     │
                    │   └─────────┬──────────┘     │
                    │             │                 │
                    │   ┌─────────▼──────────┐     │
                    │   │  Source Abstraction │     │
                    │   │  Layer              │     │
                    │   └──┬──────┬──────┬───┘     │
                    │      │      │      │         │
                    └──────┼──────┼──────┼─────────┘
                           │      │      │
               ┌───────────┘      │      └───────────┐
               ▼                  ▼                   ▼
        ┌──────────┐      ┌──────────┐       ┌──────────┐
        │ Photonic  │      │ Vacuum   │       │  Cloud   │
        │ Beam      │      │ Fluct.   │       │  QRNG    │
        │ Splitter  │      │ Device   │       │  API     │
        │ (USB/PCIe)│      │ (PCIe)   │      │ (HTTPS)  │
        └──────────┘      └──────────┘       └──────────┘
```

### Quantum Entropy Sources

The service abstracts over multiple quantum entropy source types. Each source MUST implement the `EntropySource` interface:

```go
// EntropySource provides raw quantum random bits from a physical device
// or remote service. Implementations MUST NOT apply any post-processing
// to the raw output -- conditioning is handled by the extraction layer.
type EntropySource interface {
    // Name returns a human-readable identifier for the source.
    Name() string

    // Type returns the physical mechanism used for randomness generation.
    Type() SourceType

    // Read fills the buffer with raw quantum random bytes.
    // Returns the number of bytes read and any error.
    // The caller MUST NOT assume the raw bytes are uniformly distributed.
    Read(buf []byte) (int, error)

    // BitRate returns the sustained output rate in bits per second.
    BitRate() uint64

    // Close releases the hardware device or network connection.
    Close() error
}

type SourceType int

const (
    SourcePhotonic      SourceType = iota // Beam splitter / photon detection
    SourceVacuum                          // Vacuum fluctuation measurement
    SourceQuantumDot                      // Quantum dot charge tunneling
    SourceCloudAPI                        // Remote QRNG service
)
```

#### Photon-Based Sources (Beam Splitter)

The most common and best-understood QRNG mechanism. A single photon source (attenuated laser or spontaneous parametric down-conversion) emits photons one at a time toward a 50/50 beam splitter. Two single-photon detectors sit at the transmitted and reflected output ports. Each detection event produces one random bit.

Why this works: A single photon in a superposition state `|psi> = (1/sqrt(2))(|transmitted> + |reflected>)` collapses to one outcome upon measurement. The Born rule gives each outcome probability 1/2. No measurement or preparation can bias this probability, because the beam splitter is a unitary transformation that preserves the equal superposition.

Devices: ID Quantique Quantis (USB, PCIe), Quside FMC 400 (PCIe, 400 Mbit/s).

Typical raw bit rate: 4-400 Mbit/s depending on device.

#### Vacuum Fluctuation Sources

Measures the quantum noise in the electromagnetic vacuum. Even in empty space, quantum field theory predicts fluctuating electric and magnetic fields with zero mean but nonzero variance. A homodyne detector measures one quadrature of the vacuum field, producing a continuous random variable that is digitized into random bits.

Why this works: The vacuum state of the electromagnetic field has a Gaussian Wigner function. Homodyne measurement samples from this Gaussian distribution. The outcomes are intrinsically random by the same argument as the beam splitter -- no hidden variables determine the vacuum fluctuation amplitudes.

Devices: QuintessenceLabs qStream (1 Gbit/s), ANU Quantum Optics Group (commercial units).

Typical raw bit rate: 1-10 Gbit/s. Higher rates than photon counting because each measurement produces multiple bits.

#### Quantum Dot Sources

Charge tunneling through a quantum dot is a discrete quantum event. The tunneling time is fundamentally random, governed by the transmission coefficient of the potential barrier. Measuring the tunneling current produces a stream of random bits.

Devices: Research-stage and emerging commercial offerings. Lower bit rates but integratable on-chip.

Typical raw bit rate: 1-10 Mbit/s.

#### Cloud QRNG APIs

For environments where local hardware is not feasible, cloud QRNG services provide quantum random bytes over HTTPS. The quantum hardware runs in the provider's datacenter.

Tradeoff: Cloud QRNG requires trusting the provider's implementation and the network path. For Tier 3-4 security (HIP-0005), local hardware is REQUIRED. Cloud QRNG is acceptable for Tier 0-2.

Supported providers:
- **Quantinuum** (formerly Cambridge Quantum): H-series quantum computer sampling
- **ID Quantique Randomness-as-a-Service**: Quantis hardware in Swiss datacenter
- **ANU QRNG**: Australian National University's vacuum-fluctuation service

### Health Testing (NIST SP 800-90B)

Raw quantum entropy sources are not perfect. Detectors have dark counts, lasers have intensity fluctuations, and electronics introduce classical noise. NIST SP 800-90B defines statistical tests that continuously monitor the entropy source and detect failures or degradation.

The QRNG service MUST implement the following online health tests:

#### Repetition Count Test

Detects a source that becomes stuck, outputting the same value repeatedly. The test tracks the longest run of identical consecutive samples and flags an alarm if the run length exceeds a threshold derived from the claimed min-entropy.

```go
type RepetitionCountTest struct {
    cutoff   int    // Maximum allowed run length (from min-entropy estimate)
    current  byte   // Current sample value
    count    int    // Current run length
    failures uint64 // Cumulative failure count
}
```

The cutoff is calculated as: `C = 1 + ceil(-log2(alpha) / H_min)` where alpha is the false-positive probability (typically 2^-20) and H_min is the assessed min-entropy per sample.

#### Adaptive Proportion Test

Detects a source that becomes biased, outputting one value more frequently than expected. A sliding window of W samples counts occurrences of the most recent sample value. If the count exceeds a threshold, the source is flagged.

```go
type AdaptiveProportionTest struct {
    windowSize int    // W: number of samples in window (512 or 1024)
    cutoff     int    // Maximum allowed count of most-frequent value
    window     []byte // Circular buffer of recent samples
    failures   uint64
}
```

#### Startup Testing

On service start (or device reconnect), the source MUST pass 1,024 consecutive samples through both health tests before any output is made available. This ensures the device is functioning correctly before entropy enters the pool.

#### Continuous Monitoring

Both tests run on every sample, permanently. If either test fails:

1. The source is immediately quarantined -- no further output enters the entropy pool.
2. An alert is emitted via the `/metrics` endpoint and the Hanzo monitoring pipeline (HIP-0053).
3. The service falls back to other configured sources (if available).
4. Manual intervention is required to re-enable the source after investigation.

The service MUST NOT silently degrade to a classical PRNG fallback. If all quantum sources fail, the `/entropy` endpoint MUST return `503 Service Unavailable` rather than serve non-quantum entropy.

### Randomness Extraction

Raw quantum bits, even from a healthy source, may not be perfectly uniform. Detector imperfections, electronic noise, and digitization artifacts introduce small biases. Randomness extraction (also called conditioning or post-processing) transforms nearly-random input into provably uniform output.

#### Toeplitz Hashing

The primary extraction method. A Toeplitz matrix is a matrix where each descending diagonal from left to right is constant. Multiplication of the raw bit vector by a random Toeplitz matrix produces output bits that are within epsilon of uniform, where epsilon decreases exponentially with the entropy deficit.

Why Toeplitz: It is a strong extractor (proven by the Leftover Hash Lemma) that requires only a short random seed (the first row of the matrix) to process arbitrarily long inputs. The seed can be generated once during manufacturing and stored with the device. Toeplitz matrix-vector multiplication is computable in O(n log n) via FFT, making it efficient at high bit rates.

```go
type ToeplitzExtractor struct {
    inputLen  int      // n: raw input bits per extraction
    outputLen int      // m: conditioned output bits per extraction (m < n)
    seed      []byte   // First row of Toeplitz matrix (n + m - 1 bits)
}

// Extract applies the Toeplitz hash to raw input, producing conditioned output.
// The extraction ratio m/n is determined by the min-entropy estimate H_min:
//   m = n * H_min - 2*log2(1/epsilon)
// where epsilon is the statistical distance from uniform.
func (t *ToeplitzExtractor) Extract(raw []byte) ([]byte, error)
```

#### Von Neumann Debiasing

A simpler, less efficient alternative for low-throughput sources. Takes pairs of bits: if they differ, output the first bit; if they are equal, discard both. This removes first-order bias but not higher-order correlations.

Used as a fallback when Toeplitz extraction is computationally infeasible (embedded systems) or as a pre-processing step to reduce bias before Toeplitz extraction.

```go
type VonNeumannDebiaser struct{}

// Debias processes pairs of raw bits, discarding equal pairs.
// Output length is variable (approximately n/4 for input of n bits
// with moderate bias).
func (v *VonNeumannDebiaser) Debias(raw []byte) []byte
```

#### Extraction Pipeline

The full conditioning pipeline:

```
Raw quantum bits
    │
    ▼
Von Neumann debiasing (optional pre-filter)
    │
    ▼
NIST 800-90B health tests (continuous)
    │
    ▼
Toeplitz hashing (primary extractor)
    │
    ▼
Conditioned output → Entropy Pool
```

### Entropy Pool

The entropy pool buffers conditioned quantum random bytes and serves them to consumers. It is a fixed-size ring buffer protected by a mutex, with monitoring for fill level and drain rate.

```go
type EntropyPool struct {
    mu       sync.Mutex
    buf      []byte  // Ring buffer (default: 1 MiB)
    head     int     // Write position
    tail     int     // Read position
    size     int     // Current fill level in bytes
    capacity int     // Total buffer capacity

    // Monitoring
    totalProduced uint64 // Lifetime bytes written
    totalConsumed uint64 // Lifetime bytes read
    drainRate     float64 // Bytes/second consumed (exponential moving average)
    fillRate      float64 // Bytes/second produced (exponential moving average)
}
```

**Sizing**: The pool capacity MUST be at least 10 seconds of expected peak consumption. For a KMS generating 1,000 AES-256 keys per second (32 bytes each), peak consumption is 32 KB/s, requiring at least 320 KB of pool capacity. The default 1 MiB provides approximately 30 seconds of buffer at this rate.

**Exhaustion behavior**: If the pool is empty when a consumer requests entropy, the service MUST block until sufficient entropy is available, up to a configurable timeout (default: 5 seconds). If the timeout expires, the request fails with `503 Service Unavailable`. The service MUST NOT pad the response with non-quantum bytes.

### API

#### `GET /entropy`

Returns quantum random bytes.

**Parameters**:
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bytes`   | int  | 32      | Number of random bytes to return (1-1048576) |
| `format`  | string | `hex` | Output format: `hex`, `base64`, `raw` |

**Response** (200 OK):
```json
{
  "bytes": "a3f7c2e891b4d05627ef3a8c1d9b4e0f2a6c7d8e9f0b1a2c3d4e5f6a7b8c9d0",
  "length": 32,
  "format": "hex",
  "source": "photonic",
  "timestamp": "2026-02-23T12:00:00.000Z",
  "entropy_pool_pct": 87
}
```

**Response** (503 Service Unavailable):
```json
{
  "error": "entropy_exhausted",
  "message": "Entropy pool depleted. All quantum sources healthy but demand exceeds generation rate.",
  "retry_after_ms": 500
}
```

**Authentication**: Requests MUST include a valid Hanzo API key or KMS Universal Auth token in the `Authorization` header. Unauthenticated access is prohibited.

**Rate limiting**: Per-consumer rate limits are enforced to prevent a single client from draining the pool. Default: 1 MB/s per API key. Configurable via KMS policy.

#### `GET /health`

Returns source and pool health status.

```json
{
  "status": "healthy",
  "sources": [
    {
      "name": "quantis-pcie-0",
      "type": "photonic",
      "status": "active",
      "bit_rate_bps": 40000000,
      "health_test_failures": 0,
      "uptime_seconds": 864000
    }
  ],
  "pool": {
    "capacity_bytes": 1048576,
    "available_bytes": 912384,
    "fill_pct": 87,
    "drain_rate_bps": 256000,
    "fill_rate_bps": 5000000
  }
}
```

#### `GET /metrics`

Prometheus-format metrics for integration with Hanzo monitoring (HIP-0053).

```
# HELP qrng_entropy_produced_bytes_total Total conditioned bytes produced
# TYPE qrng_entropy_produced_bytes_total counter
qrng_entropy_produced_bytes_total 1.234567e+12

# HELP qrng_entropy_consumed_bytes_total Total bytes served to consumers
# TYPE qrng_entropy_consumed_bytes_total counter
qrng_entropy_consumed_bytes_total 9.876543e+11

# HELP qrng_pool_available_bytes Current entropy pool fill level
# TYPE qrng_pool_available_bytes gauge
qrng_pool_available_bytes 912384

# HELP qrng_source_health_test_failures_total Cumulative health test failures per source
# TYPE qrng_source_health_test_failures_total counter
qrng_source_health_test_failures_total{source="quantis-pcie-0",test="repetition_count"} 0
qrng_source_health_test_failures_total{source="quantis-pcie-0",test="adaptive_proportion"} 0

# HELP qrng_request_duration_seconds Entropy request latency
# TYPE qrng_request_duration_seconds histogram
qrng_request_duration_seconds_bucket{le="0.001"} 9500
qrng_request_duration_seconds_bucket{le="0.01"} 9900
qrng_request_duration_seconds_bucket{le="0.1"} 9999
```

### Configuration

```yaml
# /etc/hanzo/qrng.yaml
server:
  port: 8073
  tls:
    cert: /etc/hanzo/tls/cert.pem
    key: /etc/hanzo/tls/key.pem

sources:
  - name: quantis-pcie-0
    type: photonic
    driver: idquantique-quantis
    device: /dev/qrandom0
    bit_rate: 40_000_000  # 40 Mbit/s

  - name: cloud-quantinuum
    type: cloud
    driver: quantinuum
    api_url: https://api.quantinuum.com/qrng/v1
    api_key_ref: kms://hanzo/qrng/quantinuum-api-key  # Fetched from KMS
    bit_rate: 1_000_000   # 1 Mbit/s (rate-limited by API)

pool:
  capacity: 1048576  # 1 MiB
  low_watermark_pct: 20   # Alert when pool drops below 20%

health_testing:
  alpha: 1.0e-6     # False-positive probability for health tests
  startup_samples: 1024
  min_entropy_estimate: 0.95  # Conservative per-bit min-entropy

extraction:
  method: toeplitz
  input_block_bits: 2048
  output_block_bits: 1024   # 50% extraction ratio (conservative)
  seed_file: /etc/hanzo/qrng/toeplitz-seed.bin

auth:
  kms_url: https://kms.hanzo.ai
  required: true
```

### Integration with KMS (HIP-0027)

Hanzo KMS generates cryptographic keys for every service in the ecosystem. The quality of these keys depends entirely on the quality of the random numbers used to generate them.

The integration is straightforward: KMS calls the QRNG `/entropy` endpoint to seed key generation instead of relying on the operating system's `/dev/urandom`.

```
KMS Key Generation Request
    │
    ▼
KMS calls QRNG /entropy?bytes=32
    │
    ▼
QRNG returns 32 quantum random bytes
    │
    ▼
KMS uses bytes as key material (AES-256)
or as seed for ML-KEM/ML-DSA key generation (HIP-0005)
```

For post-quantum key generation (ML-KEM, ML-DSA), the NIST standards specify that key generation randomness MUST come from an approved entropy source. QRNG with NIST 800-90B health testing satisfies this requirement.

### Integration with QKD (HIP-0071)

Quantum Key Distribution protocols require randomness at multiple points: basis selection in BB84, measurement choice in E91, and decoy-state intensity selection. These random choices MUST be quantum-random and MUST be independent of the quantum channel being measured -- otherwise, the security proof breaks down.

The QRNG service provides a dedicated high-priority entropy stream for QKD systems. QKD randomness requests are served before general-purpose requests to prevent pool exhaustion from affecting QKD security.

### Integration with Blockchain (HIP-0020)

On-chain randomness is a hard problem. Smart contracts need unpredictable random numbers for fair lotteries, NFT minting, and validator selection, but blockchain execution is deterministic -- every node must compute the same result.

The standard approach is a Verifiable Random Function (VRF): a validator generates a random output from a secret key and a public input, along with a proof that the output is correct. Other validators verify the proof without learning the secret key.

QRNG enhances this by seeding the VRF's secret key and per-round input with quantum randomness:

```
Quantum Random Seed (from QRNG)
    │
    ▼
VRF(secret_key, block_hash || quantum_seed) → (random_output, proof)
    │
    ▼
On-chain: verify(public_key, block_hash || quantum_seed, random_output, proof) → bool
```

This provides defense-in-depth: even if the VRF's algebraic structure has an undiscovered weakness, the quantum seed ensures the input is unpredictable.

### AI Applications

#### Weight Initialization

Neural network training begins with random weight initialization. The choice of initialization affects convergence speed, final accuracy, and the likelihood of getting trapped in local minima.

Standard PRNGs produce weights that are deterministic given the seed. This is useful for reproducibility but problematic for security-sensitive models: an adversary who knows the initialization seed can predict the weight trajectory during training, potentially enabling model extraction attacks.

QRNG provides an option for security-critical training: initialize weights with quantum-random values. The initialization is still drawn from the appropriate distribution (Kaiming, Xavier, etc.) -- only the underlying random bytes are quantum-sourced.

**When to use QRNG for initialization**: Models whose weights are trade secrets (proprietary Zen models), models trained on sensitive data (medical, financial), and models where training reproducibility is less important than protection against initialization-based attacks.

**When to use PRNG for initialization**: Research experiments requiring exact reproducibility, ablation studies, and models where the weights will be published openly.

#### Differential Privacy Noise

Differential privacy adds calibrated noise to query results or gradient updates to protect individual data points. The noise MUST be drawn from a precise distribution (typically Laplacian or Gaussian) and MUST be unpredictable to the analyst.

If the noise source is a PRNG and the analyst can observe enough noisy results, they may be able to infer the PRNG state and subtract the noise, defeating the privacy guarantee. Quantum-random noise eliminates this attack vector because the noise values have no deterministic relationship to each other.

```go
// QuantumLaplacian returns a sample from the Laplace distribution
// with location 0 and scale b, using quantum random bytes.
func QuantumLaplacian(pool *EntropyPool, scale float64) (float64, error) {
    buf := make([]byte, 16)
    if _, err := pool.Read(buf); err != nil {
        return 0, fmt.Errorf("qrng: pool read: %w", err)
    }
    // Convert to uniform [0, 1) then apply inverse CDF
    u := bytesToFloat64(buf[:8])
    sign := 1.0
    if bytesToFloat64(buf[8:]) < 0.5 {
        sign = -1.0
    }
    return -sign * scale * math.Log(1-2*math.Abs(u-0.5)), nil
}
```

#### Monte Carlo Sampling

Monte Carlo methods estimate integrals, simulate physical systems, and explore high-dimensional spaces. The rate of convergence depends on the quality of the random number stream. Correlations in PRNG output (which exist, even in good generators, at sufficiently long sequences) can introduce systematic errors.

QRNG provides a correlation-free random stream. For high-precision Monte Carlo simulations (financial risk modeling, particle physics, climate modeling), this eliminates a class of systematic error.

## Rationale

### Why a Dedicated Service (Not a Library)

Quantum entropy is a finite physical resource. A single QRNG device produces bits at a fixed rate (e.g., 40 Mbit/s for a Quantis PCIe card). If every service linked a QRNG library and opened the device directly, contention would be unmanaged, health testing would be duplicated, and monitoring would be impossible.

A centralized service manages the scarce resource: it buffers entropy in a pool, enforces rate limits, runs continuous health monitoring, and provides a single point of observability. Multiple consumers share the entropy through a standard API, and the service ensures no single consumer can starve others.

### Why Hardware Abstraction

The QRNG market is young and fragmented. ID Quantique, QuintessenceLabs, Quside, and Quantinuum use different physical mechanisms, device interfaces, and raw output formats. Committing to a single vendor creates lock-in and a single point of failure.

The `EntropySource` interface abstracts over all source types. The service can mix sources (e.g., a local Quantis card as the primary source and a cloud API as backup). If a vendor discontinues a product, the device driver is replaced without changing any consumer code.

### Why Not Just Use /dev/urandom

Linux's `/dev/urandom` mixes multiple entropy sources (interrupt timing, disk I/O, CPU jitter) through a cryptographic hash. It produces output that is computationally indistinguishable from random for any known attack. For most applications, this is sufficient.

QRNG is warranted when:

1. **Regulatory compliance** requires a quantum entropy source (NIST SP 800-90C, CNSA 2.0).
2. **Long-term security** demands information-theoretic randomness that no future computational advance (including quantum computers) can distinguish from uniform.
3. **Formal verification** of cryptographic protocols requires a randomness source whose properties are derived from physical laws rather than computational assumptions.
4. **Post-quantum cryptography** (HIP-0005) key generation benefits from quantum-certified seeds.

For routine randomness (HTTP request IDs, non-security-critical shuffling), `/dev/urandom` remains appropriate. QRNG is not a replacement for `/dev/urandom` -- it is a higher-assurance complement for security-critical operations.

### Cost-Performance Tradeoffs

| Source | Cost | Throughput | Latency | Trust Model |
|--------|------|------------|---------|-------------|
| `/dev/urandom` | Free | Unlimited | ~1 us | Trust kernel + hardware |
| Quantis USB | ~$1,000 | 4 Mbit/s | ~10 us | Trust device vendor |
| Quantis PCIe | ~$3,000 | 40 Mbit/s | ~5 us | Trust device vendor |
| qStream | ~$10,000 | 1 Gbit/s | ~2 us | Trust device vendor |
| Cloud QRNG | ~$0.01/MB | Rate-limited | ~50 ms | Trust vendor + network |

For most Hanzo deployments, a single Quantis PCIe card ($3,000) provides 40 Mbit/s -- sufficient to seed every cryptographic operation across all services with quantum randomness. The cost is negligible relative to the infrastructure it protects.

## Security Considerations

### Device Tampering

A compromised QRNG device could output deterministic data that passes statistical tests. Defenses:
- **Dual-source verification**: Run two independent QRNG devices; XOR their outputs. Both must be compromised to bias the result.
- **Continuous health testing**: NIST 800-90B tests detect many (but not all) forms of deterministic output.
- **Device attestation**: Verify firmware signatures on device startup.

### Network Attacks on Cloud QRNG

A man-in-the-middle could substitute classical random bytes for cloud QRNG responses. Defenses:
- **TLS with certificate pinning** to the provider's known certificate.
- **Signed entropy**: Some providers sign each entropy response with a device-bound key.
- **Hybrid approach**: XOR cloud QRNG with local `/dev/urandom` as a hedge.

### Side-Channel Leakage

The entropy pool contents could leak via timing side channels (e.g., cache timing attacks on the ring buffer). Defenses:
- **Constant-time pool access**: Read operations take constant time regardless of pool fill level.
- **Memory isolation**: Pool buffer is `mlock()`ed to prevent swapping to disk.

### Entropy Starvation

A denial-of-service attack could drain the entropy pool by making rapid API requests. Defenses:
- **Per-consumer rate limits** enforced at the API layer.
- **Priority queues**: KMS and QKD requests are served before general consumers.
- **Pool low-watermark alerts**: Monitoring triggers before complete exhaustion.

## Implementation

### Phase 1: Core Service (Q1 2026)
- Go service with `/entropy`, `/health`, `/metrics` endpoints
- ID Quantique Quantis PCIe driver
- NIST 800-90B health testing
- Toeplitz extraction
- KMS integration for key seeding

### Phase 2: Multi-Source and Cloud (Q2 2026)
- Cloud QRNG provider drivers (Quantinuum, ANU)
- Multi-source failover and XOR combination
- Prometheus metrics and alerting integration
- Von Neumann debiaser for low-throughput sources

### Phase 3: AI and Blockchain Integration (Q3 2026)
- Quantum-random weight initialization library for Python (PyTorch integration)
- Differential privacy noise generation library
- VRF quantum seeding for Lux blockchain nodes
- QKD priority entropy stream

## Test Vectors

```go
func TestEntropyPoolBlocksOnEmpty(t *testing.T) {
    pool := NewEntropyPool(1024)
    // Pool starts empty -- read should block then timeout
    buf := make([]byte, 32)
    ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel()
    _, err := pool.ReadContext(ctx, buf)
    if !errors.Is(err, context.DeadlineExceeded) {
        t.Fatalf("expected deadline exceeded, got %v", err)
    }
}

func TestRepetitionCountTest(t *testing.T) {
    rct := NewRepetitionCountTest(0.95, 1e-6) // H_min=0.95, alpha=1e-6
    // Feed 100 identical bytes -- must trigger failure
    for i := 0; i < 100; i++ {
        if rct.AddSample(0x42) {
            return // Correctly detected stuck source
        }
    }
    t.Fatal("repetition count test failed to detect stuck source")
}

func TestToeplitzExtraction(t *testing.T) {
    ext := NewToeplitzExtractor(2048, 1024, testSeed)
    // Input: all zeros (worst case bias)
    raw := make([]byte, 256) // 2048 bits
    out, err := ext.Extract(raw)
    if err != nil {
        t.Fatal(err)
    }
    if len(out) != 128 { // 1024 bits = 128 bytes
        t.Fatalf("expected 128 bytes, got %d", len(out))
    }
    // Output should not be all zeros (Toeplitz hash disperses input)
    allZero := true
    for _, b := range out {
        if b != 0 { allZero = false; break }
    }
    if allZero {
        t.Fatal("Toeplitz extractor produced all-zero output from all-zero input")
    }
}

func TestHealthEndpoint(t *testing.T) {
    srv := NewTestServer(t)
    resp, err := http.Get(srv.URL + "/health")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        t.Fatalf("expected 200, got %d", resp.StatusCode)
    }
    var health HealthResponse
    if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
        t.Fatal(err)
    }
    if health.Status != "healthy" {
        t.Fatalf("expected healthy, got %s", health.Status)
    }
}
```

## References

1. [HIP-0005: Post-Quantum Security for AI Infrastructure](./hip-0005-post-quantum-security-for-ai-infrastructure.md)
2. [HIP-0020: Blockchain Node Standard](./hip-0020-blockchain-node-standard.md)
3. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
4. [HIP-0053: Visor Monitoring Standard](./hip-0053-visor-monitoring-standard.md)
5. [NIST SP 800-90B: Recommendation for the Entropy Sources Used for Random Bit Generation](https://csrc.nist.gov/publications/detail/sp/800-90b/final)
6. [NIST SP 800-90C: Recommendation for Random Bit Generator (RBG) Constructions (Draft)](https://csrc.nist.gov/publications/detail/sp/800-90c/draft)
7. [Bell, J.S. "On the Einstein Podolsky Rosen Paradox" (1964)](https://doi.org/10.1103/PhysicsPhysiqueFizika.1.195)
8. [Hensen, B. et al. "Loophole-free Bell inequality violation" (2015)](https://doi.org/10.1038/nature15759)
9. [Ma, X. et al. "Quantum random number generation" (2016)](https://doi.org/10.1038/npjqi.2016.21)
10. [ID Quantique Quantis QRNG](https://www.idquantique.com/random-number-generation/)
11. [QuintessenceLabs qStream](https://www.quintessencelabs.com/)
12. [Leftover Hash Lemma](https://en.wikipedia.org/wiki/Leftover_hash_lemma) -- theoretical foundation for Toeplitz extraction

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
