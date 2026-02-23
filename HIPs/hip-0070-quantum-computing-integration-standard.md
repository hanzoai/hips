---
hip: 0070
title: Quantum Computing Integration Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0037, HIP-0057
---

# HIP-70: Quantum Computing Integration Standard

## Abstract

This proposal defines the Quantum Computing Integration Standard for the Hanzo ecosystem. Hanzo Quantum provides a hybrid classical-quantum computing framework that enables AI workloads to offload specific subroutines -- optimization, sampling, kernel evaluation -- to quantum processors. It abstracts over six quantum cloud backends (IBM Quantum, Google Cirq, AWS Braket, Azure Quantum, IonQ, Rigetti) through a unified circuit API, so that a quantum program written once executes on any backend without modification.

The system is designed for the NISQ (Noisy Intermediate-Scale Quantum) era: current quantum processors have 50-1000 qubits with significant noise, making them unsuitable for general-purpose computation but useful for specific subroutines where quantum mechanics provides a structural advantage. Hanzo Quantum does not replace classical computing. It augments it. The integration targets four AI-specific applications: variational quantum eigensolvers (VQE) for molecular simulation, quantum approximate optimization (QAOA) for combinatorial problems, quantum kernel methods for machine learning, and quantum sampling for generative models.

The system integrates with the ML Pipeline (HIP-0057) for hybrid training loops and with Hanzo Cloud (HIP-0037) for quantum resource scheduling and billing.

**Repository**: [github.com/hanzoai/quantum](https://github.com/hanzoai/quantum)
**Port**: 8070 (API)
**Binary**: `hanzo-quantum`
**Container**: `hanzoai/quantum:latest`

## Motivation

### Why an AI Company Needs Quantum Computing

This is the first question any engineer will ask, and it deserves a direct answer. Quantum computing is not a general-purpose accelerator like a GPU. It does not make matrix multiplication faster. It does not speed up backpropagation. For the vast majority of AI workloads, a classical GPU cluster is strictly better than any quantum processor that exists today or will exist in the next five years.

But AI is not only matrix multiplication. Three classes of problems appear repeatedly in AI research and production where quantum mechanics offers a structural advantage:

1. **Optimization.** Training a neural network is an optimization problem: find the parameter values that minimize a loss function. For smooth, differentiable loss landscapes, gradient descent works well. But many real-world optimization problems are combinatorial -- scheduling GPU jobs across a cluster, routing network traffic, portfolio optimization in finance, drug molecule design. These have discrete variables and rugged loss landscapes where gradient descent cannot operate. Classical solvers (simulated annealing, genetic algorithms) work but scale poorly. Quantum approximate optimization (QAOA) encodes the problem into a quantum circuit whose measurement statistics concentrate around good solutions. For certain problem structures, QAOA finds approximate solutions with fewer evaluations than classical heuristics.

2. **Sampling.** Generative AI models (diffusion models, energy-based models, Boltzmann machines) need to draw samples from complex probability distributions. Classical sampling methods (MCMC, Langevin dynamics) can get stuck in local modes and require many iterations to mix. Quantum processors are naturally probabilistic -- measurement of a quantum state produces samples from a distribution defined by the quantum circuit. Quantum-enhanced sampling can explore the distribution more efficiently for certain families of distributions, particularly those with multi-modal structure.

3. **Kernel methods.** Support vector machines and kernel methods map data into high-dimensional feature spaces where linear classifiers become powerful. The bottleneck is computing the kernel function -- the similarity measure in the feature space. Quantum kernel methods use quantum circuits to implicitly compute kernels in exponentially large Hilbert spaces that have no efficient classical representation. For datasets with specific symmetry structures, quantum kernels achieve better classification accuracy than any classical kernel of comparable computational cost.

None of these advantages are universal. They apply to specific problem structures. The purpose of Hanzo Quantum is to make these advantages accessible to AI practitioners without requiring them to learn quantum physics, manage quantum hardware, or write quantum assembly code.

### The Backend Fragmentation Problem

Quantum computing hardware is fragmented in a way that classical computing has not been since the 1980s. There are six major quantum cloud providers, each with a different programming model:

| Provider | SDK | Qubit Technology | Gate Set | Connectivity |
|----------|-----|-------------------|----------|-------------|
| IBM Quantum | Qiskit | Superconducting (transmon) | CX, Rz, SX, X | Heavy-hex lattice |
| Google | Cirq | Superconducting (Sycamore) | sqrt(iSWAP), Phased-XZ | Grid |
| AWS Braket | Braket SDK | Multiple (IonQ, Rigetti, OQC) | Provider-dependent | Provider-dependent |
| Azure Quantum | Q# / Qiskit | Multiple (IonQ, Quantinuum) | Provider-dependent | All-to-all (trapped ion) |
| IonQ | IonQ API | Trapped ion | GPI, GPI2, MS | All-to-all |
| Rigetti | pyQuil | Superconducting | CZ, Rz, Rx | Octagonal lattice |

A quantum circuit written for IBM's gate set and connectivity does not run on Google's hardware without recompilation. A circuit optimized for IonQ's all-to-all connectivity wastes resources on IBM's sparse lattice where non-adjacent qubits require SWAP gates to interact. Each provider's SDK has a different circuit representation, different simulator, different job submission API, and different pricing model.

This is the same fragmentation problem that plagued classical GPU computing before CUDA unified it, and that plagued classical cloud computing before Kubernetes abstracted over providers. Hanzo Quantum applies the same pattern: a unified circuit API that compiles to any backend, so that researchers write quantum programs once and execute them on whichever hardware is best suited for their circuit.

### Why Now

Two developments make quantum integration practical in 2026:

**Hardware has crossed the utility threshold.** IBM's 1121-qubit Condor processor, Google's 70-qubit Willow chip with below-threshold error correction, and Quantinuum's 56-qubit H2 trapped-ion system can execute circuits with enough depth and fidelity to produce results that are expensive to simulate classically. These are not toy demonstrations. They are noisy, limited, and require careful error mitigation -- but they are real computational resources.

**Error mitigation techniques are mature.** Zero-noise extrapolation, probabilistic error cancellation, and Clifford data regression have progressed from academic papers to production-ready libraries. These techniques do not require fault-tolerant quantum computers. They work on today's noisy hardware by running multiple circuit variants and using classical post-processing to extract signal from noise. The overhead is 10-100x more circuit executions, which is expensive but tractable for high-value problems.

## Design Philosophy

### Why Abstract Over Backends

No quantum hardware provider has won. Unlike classical computing where x86 and ARM dominate, quantum computing has at least three competing qubit technologies (superconducting, trapped ion, photonic) with no clear winner. Each technology has different strengths: superconducting qubits are fast but noisy with limited connectivity; trapped ions are slow but high-fidelity with all-to-all connectivity; photonic systems excel at specific sampling tasks.

An AI team that writes their quantum subroutines against IBM's Qiskit API is locked into IBM's hardware roadmap. If IonQ releases a processor that is better suited to their problem, they rewrite from scratch. The abstraction layer costs almost nothing -- it is a thin compilation step -- and provides freedom to migrate as hardware improves.

The tradeoff is that backend-specific optimizations may be less aggressive than hand-tuned circuits. For the 95% case, the compiler's automated optimization is sufficient. For the 5% case where maximum performance matters, the API allows backend-specific pass-through directives that bypass the abstraction.

### Why Hybrid, Not Pure Quantum

Pure quantum algorithms (Shor's factoring, Grover's search) require fault-tolerant quantum computers with millions of physical qubits and error rates below 10^-10. No such computer exists. The most optimistic timelines place fault-tolerant quantum computing at 2030-2035.

NISQ-era quantum advantage comes from hybrid algorithms where a classical computer handles the bulk of computation and a quantum processor handles a specific subroutine. The pattern is:

```
Classical optimizer (gradient descent, Bayesian optimization)
    |
    +---> Prepares quantum circuit parameters
    |
    +---> Sends circuit to quantum processor
    |
    +---> Quantum processor executes circuit, returns measurement samples
    |
    +---> Classical computer processes samples into objective function value
    |
    +---> Classical optimizer updates parameters
    |
    +---> Repeat until convergence
```

This is the variational quantum eigensolver (VQE) loop, and it is the template for all NISQ-era quantum-classical algorithms. The quantum processor evaluates a function that is hard to evaluate classically; the classical computer optimizes the parameters of that function using standard optimization techniques.

Hanzo Quantum implements this loop natively. The ML Pipeline (HIP-0057) manages the classical optimization; Hanzo Quantum manages the quantum circuit execution. The integration point is a well-defined interface: the classical optimizer sends circuit parameters, the quantum backend returns measurement statistics.

### Why Not Wait for Fault-Tolerant Quantum

Three reasons:

1. **Learning curve.** Quantum computing requires new mental models. Teams that start experimenting now will be ready when fault-tolerant hardware arrives. Teams that wait will spend years catching up.

2. **Problem formulation.** The hardest part of quantum computing is not writing circuits -- it is formulating classical problems as quantum problems. This formulation work is the same whether the hardware is NISQ or fault-tolerant. Starting now means the formulations are ready when the hardware is.

3. **Near-term value.** For specific problem instances (small molecules for drug discovery, portfolio optimization with 50-100 assets, feature maps for structured datasets), NISQ hardware with error mitigation already produces results that are competitive with classical methods. Not faster -- competitive. The value is in exploring a new computational paradigm, not in raw speedup.

## Quantum Computing Primer

This section explains quantum computing concepts for engineers who have no physics background. Skip it if you already understand qubits, gates, and measurement.

### Qubits: The Basic Unit

A classical bit is either 0 or 1. A qubit is a physical system that, when measured, produces either 0 or 1 -- but before measurement, it exists in a superposition of both states simultaneously. Mathematically, a qubit's state is described by two complex numbers (amplitudes) that determine the probability of measuring 0 or 1.

Think of it this way: a classical bit is a coin lying flat -- it is heads or tails. A qubit is a coin spinning in the air -- it is in a superposition of heads and tails. When you catch it (measure it), it collapses to one outcome with a probability determined by how it was spinning.

The power of quantum computing comes from two properties:

- **Superposition**: A system of N qubits can represent 2^N states simultaneously. 50 qubits represent 2^50 (about 10^15) states -- more than a petabyte of classical memory.
- **Entanglement**: Qubits can be correlated in ways that have no classical analogue. Measuring one entangled qubit instantly determines the state of its partner, regardless of distance. This correlation is the resource that quantum algorithms exploit.

### Quantum Gates: Operations on Qubits

Just as classical computation applies logic gates (AND, OR, NOT) to bits, quantum computation applies quantum gates to qubits. Common gates include:

- **X gate** (NOT): Flips 0 to 1 and 1 to 0. The quantum analogue of a classical NOT gate.
- **H gate** (Hadamard): Puts a qubit into equal superposition. If the qubit starts as 0, after H it has a 50/50 chance of being measured as 0 or 1.
- **CNOT gate** (Controlled-NOT): A two-qubit gate that flips the second qubit if and only if the first qubit is 1. This is the primary gate for creating entanglement.
- **Rz gate** (Z-rotation): Rotates the qubit's phase by a specified angle. Phase is invisible when measuring a single qubit but affects how qubits interfere with each other -- this is where the computational power hides.

A quantum algorithm is a sequence of gates applied to qubits, followed by measurement. The art is choosing gates so that the probability amplitudes interfere constructively on correct answers and destructively on incorrect ones.

### Quantum Circuits: Programs

A quantum circuit is a sequence of gates applied to a register of qubits. It is the quantum analogue of a classical program. Here is a simple circuit that creates an entangled pair (Bell state):

```
q0: ──H──@──M──
          |
q1: ─────X──M──
```

Reading left to right: qubit q0 starts in state 0, passes through a Hadamard gate (H) to enter superposition, then serves as the control for a CNOT gate (@) targeting q1. After this circuit, q0 and q1 are entangled: measuring both will always produce either (0,0) or (1,1), each with 50% probability, but never (0,1) or (1,0). This correlation is the foundation of quantum computation.

### Noise: The NISQ Challenge

Real quantum processors are noisy. Every gate has an error rate (typically 0.1-1% for single-qubit gates, 0.5-5% for two-qubit gates), and qubits lose their quantum state over time (decoherence). A circuit with 100 two-qubit gates on hardware with 1% error per gate has roughly a 63% chance of at least one error occurring.

This is why NISQ-era quantum computing focuses on shallow circuits (few gates) and error mitigation (classical post-processing to correct for noise) rather than deep circuits that would require error correction. Hanzo Quantum's compilation pipeline optimizes circuits to minimize depth and gate count, and its error mitigation module applies established techniques to extract reliable results from noisy execution.

## Specification

### Architecture Overview

```
                    +------------------------------------------+
                    |        Hanzo Quantum API (8070)           |
                    |                                          |
                    |  +----------+ +----------+ +----------+  |
                    |  | Circuit  | | Backend  | |  Error   |  |
                    |  | Compiler | | Router   | | Mitigator|  |
                    |  +----+-----+ +----+-----+ +----+-----+  |
                    |       |            |            |         |
                    |  +----+------------+------------+------+  |
                    |  |         Job Scheduler                | |
                    |  +----+--------+--------+--------+-----+ |
                    +-------+--------+--------+--------+-------+
                            |        |        |        |
                   +--------+--+ +---+----+ +-+------+ +--+--------+
                   | IBM       | | Google | | AWS    | | Simulator |
                   | Quantum   | | Cirq   | | Braket | | (Local)   |
                   | (Qiskit)  | | (Cirq) | |        | |           |
                   +-----------+ +--------+ +--------+ +-----------+
```

**Hanzo Quantum API** (port 8070) is the control plane. It accepts quantum circuit definitions, compiles them to target backends, submits jobs, and returns results. It is a stateless Python service backed by PostgreSQL for job metadata and Redis for result caching.

**Circuit Compiler** translates the unified circuit representation into backend-specific instructions. It performs gate decomposition (converting abstract gates into each backend's native gate set), qubit mapping (assigning logical qubits to physical qubits respecting hardware connectivity), and circuit optimization (reducing gate count and depth through algebraic simplification and commutation rules).

**Backend Router** selects the optimal backend for a given circuit based on qubit count, gate fidelity, queue depth, and cost. It can also split a batch of circuits across multiple backends for throughput.

**Error Mitigator** applies noise mitigation techniques to raw measurement results, producing corrected expectation values that approximate the ideal (noise-free) output.

**Job Scheduler** manages the lifecycle of quantum jobs: submission, queuing, execution, result retrieval, and retry on transient failures.

### Unified Circuit API

The circuit API uses a JSON-based intermediate representation (IR) that is independent of any backend:

```yaml
Circuit Schema:
  name: string                    # Human-readable circuit name
  num_qubits: integer             # Number of qubits
  num_classical_bits: integer     # Number of classical bits for measurement
  gates:                          # Ordered list of gate operations
    - gate: string                # Gate name (H, X, Y, Z, CNOT, CZ, Rz, Ry, Rx, etc.)
      qubits: integer[]           # Qubit indices this gate acts on
      params: float[]             # Gate parameters (angles for rotation gates)
      condition: object           # Optional classical condition for conditional gates
  measurements:                   # Measurement instructions
    - qubit: integer
      classical_bit: integer
  metadata:
    description: string
    tags: string[]
```

Example -- a 2-qubit Bell state circuit:

```json
{
  "name": "bell-state",
  "num_qubits": 2,
  "num_classical_bits": 2,
  "gates": [
    {"gate": "H", "qubits": [0]},
    {"gate": "CNOT", "qubits": [0, 1]}
  ],
  "measurements": [
    {"qubit": 0, "classical_bit": 0},
    {"qubit": 1, "classical_bit": 1}
  ]
}
```

This circuit compiles to each backend's native format:

| Backend | Compiled Output |
|---------|----------------|
| IBM (Qiskit) | H(q0), CX(q0, q1), Measure(q0->c0), Measure(q1->c1) |
| Google (Cirq) | H(q(0,0)), CNOT(q(0,0), q(0,1)), Measure(q(0,0), q(0,1)) |
| IonQ | GPI2(q0, 0.25), MS(q0, q1), GPI(q0, 0.5), Measure |
| Rigetti (pyQuil) | H(0), CNOT(0, 1), MEASURE(0, ro[0]), MEASURE(1, ro[1]) |

The compilation handles gate decomposition automatically. CNOT is native on IBM but must be decomposed into MS + single-qubit gates on IonQ. The user never sees this.

### Python Client Library

```python
import hanzo_quantum as hq

# Build a circuit
circuit = hq.Circuit(2, name="bell-state")
circuit.h(0)
circuit.cnot(0, 1)
circuit.measure_all()

# Execute on the best available backend
result = hq.execute(circuit, shots=1024)
print(result.counts)  # {"00": 512, "11": 512}

# Execute on a specific backend
result = hq.execute(circuit, shots=1024, backend="ibm_brisbane")

# Execute on a local simulator (no cloud credentials needed)
result = hq.execute(circuit, shots=1024, backend="simulator")

# Parameterized circuit for variational algorithms
theta = hq.Parameter("theta")
vqe_circuit = hq.Circuit(2)
vqe_circuit.ry(0, theta)
vqe_circuit.cnot(0, 1)
vqe_circuit.measure_all()

# Bind parameters and execute
result = hq.execute(vqe_circuit, shots=1024, params={"theta": 0.42})
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Circuits** | | |
| `/v1/circuits` | POST | Submit a circuit for compilation (returns compiled IR) |
| `/v1/circuits/validate` | POST | Validate a circuit without executing |
| **Jobs** | | |
| `/v1/jobs` | POST | Submit a quantum job (circuit + backend + shots) |
| `/v1/jobs/{id}` | GET | Get job status and results |
| `/v1/jobs/{id}/cancel` | POST | Cancel a queued or running job |
| `/v1/jobs` | GET | List jobs (filtered by status, backend, date) |
| **Backends** | | |
| `/v1/backends` | GET | List available backends with status and pricing |
| `/v1/backends/{id}` | GET | Get backend details (qubits, connectivity, gate fidelities) |
| `/v1/backends/{id}/calibration` | GET | Latest calibration data for a backend |
| **Hybrid** | | |
| `/v1/hybrid/vqe` | POST | Submit a VQE job (Hamiltonian + ansatz + optimizer) |
| `/v1/hybrid/qaoa` | POST | Submit a QAOA job (problem graph + depth) |
| `/v1/hybrid/qkernel` | POST | Submit a quantum kernel evaluation job |
| `/v1/hybrid/sampling` | POST | Submit a quantum sampling job |
| **Error Mitigation** | | |
| `/v1/mitigation/zne` | POST | Apply zero-noise extrapolation to raw results |
| `/v1/mitigation/pec` | POST | Apply probabilistic error cancellation |

### Circuit Compilation Pipeline

Compilation transforms a backend-agnostic circuit into optimized instructions for a specific quantum processor. The pipeline has four stages:

```
Input Circuit (abstract gates, logical qubits)
    |
    v
[1. Gate Decomposition]
    Convert abstract gates to the target backend's native gate set.
    Example: Toffoli gate -> 6 CNOT + 9 single-qubit gates (IBM)
    Example: CNOT -> MS + rotations (IonQ trapped ion)
    |
    v
[2. Qubit Mapping]
    Assign logical qubits to physical qubits on the hardware.
    Respects hardware connectivity constraints.
    Inserts SWAP gates where non-adjacent qubits must interact.
    Uses heuristic algorithms (SABRE) to minimize SWAP count.
    |
    v
[3. Circuit Optimization]
    Algebraic simplification: cancel adjacent inverse gates (H-H = I).
    Commutation: reorder gates that commute to reduce depth.
    Template matching: replace subcircuits with shorter equivalents.
    Rotation merging: combine consecutive rotations on the same qubit.
    |
    v
[4. Noise-Aware Scheduling]
    Schedule gates to minimize decoherence using calibration data.
    Place critical gates on highest-fidelity qubit pairs.
    Parallelize independent gates to reduce total circuit duration.
    |
    v
Output: Backend-native instructions ready for execution
```

**Noise-aware optimization** is what distinguishes a production compiler from a textbook one. Each physical qubit on a quantum processor has different error rates, and these rates change with each calibration cycle (typically daily). The compiler fetches the latest calibration data from the backend and uses it to make routing decisions. A CNOT gate between qubits with 0.5% error is preferred over one with 2% error, even if it requires an extra SWAP.

### AI-Specific Quantum Applications

#### Variational Quantum Eigensolver (VQE)

VQE finds the ground state energy of a quantum system -- the lowest energy configuration of a molecule, material, or optimization problem encoded as a Hamiltonian. This is relevant to AI because molecular property prediction, materials design, and combinatorial optimization can all be expressed as ground state problems.

```python
import hanzo_quantum as hq
from hanzo_quantum.applications import VQE

# Define a molecular Hamiltonian (H2 molecule)
hamiltonian = hq.Hamiltonian.from_molecule("H2", basis="sto-3g")

# Choose an ansatz (parameterized circuit template)
ansatz = hq.ansatz.UCCSD(num_qubits=4, num_electrons=2)

# Run VQE with classical optimizer
vqe = VQE(
    hamiltonian=hamiltonian,
    ansatz=ansatz,
    optimizer="cobyla",
    backend="ibm_brisbane",
    shots=4096,
    error_mitigation="zne",
)

result = vqe.run()
print(f"Ground state energy: {result.energy:.6f} Hartree")
print(f"Iterations: {result.num_iterations}")
print(f"Circuit executions: {result.total_circuits}")
```

#### Quantum Approximate Optimization Algorithm (QAOA)

QAOA solves combinatorial optimization problems (MaxCut, traveling salesman, job scheduling) by encoding the problem as a quantum circuit and variationally optimizing its parameters.

```python
from hanzo_quantum.applications import QAOA

# Define an optimization problem (MaxCut on a graph)
graph = hq.Graph(edges=[(0,1), (1,2), (2,3), (3,0), (0,2)])

qaoa = QAOA(
    problem=hq.problems.MaxCut(graph),
    depth=3,                    # Number of QAOA layers (higher = better but deeper circuit)
    optimizer="cobyla",
    backend="simulator",        # Start with simulator, then move to hardware
    shots=2048,
)

result = qaoa.run()
print(f"Best cut value: {result.best_value}")
print(f"Best partition: {result.best_bitstring}")
print(f"Approximation ratio: {result.approximation_ratio:.3f}")
```

#### Quantum Kernel Methods

Quantum kernel methods compute kernel functions using quantum circuits, enabling SVMs and kernel ridge regression in exponentially large feature spaces.

```python
from hanzo_quantum.applications import QuantumKernel
from sklearn.svm import SVC

# Define a quantum feature map
feature_map = hq.feature_maps.ZZFeatureMap(
    num_qubits=4,
    reps=2,
    entanglement="full",
)

# Compute the quantum kernel matrix
qkernel = QuantumKernel(
    feature_map=feature_map,
    backend="simulator",
    shots=2048,
)

# Use with scikit-learn
kernel_matrix_train = qkernel.evaluate(X_train)
kernel_matrix_test = qkernel.evaluate(X_test, X_train)

svm = SVC(kernel="precomputed")
svm.fit(kernel_matrix_train, y_train)
accuracy = svm.score(kernel_matrix_test, y_test)
print(f"Quantum kernel SVM accuracy: {accuracy:.3f}")
```

#### Quantum Sampling for Generative Models

Quantum circuits can generate samples from distributions that are hard to sample classically, useful as components in generative AI models.

```python
from hanzo_quantum.applications import QuantumSampler

# Define a Born machine (quantum generative model)
sampler = QuantumSampler(
    num_qubits=8,
    circuit_depth=6,
    backend="ibm_brisbane",
    shots=10000,
)

# Train the Born machine on target distribution
sampler.train(
    target_samples=training_data,
    optimizer="adam",
    learning_rate=0.01,
    epochs=100,
)

# Generate new samples
new_samples = sampler.sample(num_samples=1000)
```

### Error Mitigation Strategies

Error mitigation is essential for extracting useful results from NISQ hardware. Hanzo Quantum implements three established techniques:

#### Zero-Noise Extrapolation (ZNE)

The idea: run the same circuit at multiple noise levels by intentionally amplifying the noise (inserting identity-equivalent gate pairs that increase error without changing the ideal circuit), then extrapolate the results back to zero noise.

```
Noise level 1x: measure expectation value E1
Noise level 2x: measure expectation value E2 (noisier)
Noise level 3x: measure expectation value E3 (noisiest)

Extrapolate to 0x noise: E0 = f(E1, E2, E3)
```

ZNE is the simplest mitigation technique and works well when the noise model is approximately uniform across the circuit. It requires 3-5x more circuit executions than unmitigated execution.

#### Probabilistic Error Cancellation (PEC)

The idea: decompose each noisy gate into a linear combination of noisy operations whose weighted sum equals the ideal gate. Execute multiple circuit variants with random gate substitutions, and combine the results with appropriate signs and weights.

PEC produces unbiased estimates of the ideal expectation value but requires detailed knowledge of the noise model (obtained from device characterization). The sampling overhead grows exponentially with circuit size, making PEC practical only for small circuits (up to ~20-30 qubits with moderate depth).

#### Measurement Error Mitigation

The simplest technique: characterize the readout errors by preparing known states and measuring them, then invert the confusion matrix to correct raw measurement results.

```python
# Apply error mitigation to raw results
mitigated = hq.mitigate(
    raw_counts=result.counts,
    technique="zne",           # or "pec", "measurement"
    backend="ibm_brisbane",
    noise_amplification=[1, 2, 3],
)
print(f"Raw expectation: {result.expectation:.4f}")
print(f"Mitigated expectation: {mitigated.expectation:.4f}")
```

### Simulator Support

For development and testing, Hanzo Quantum includes local simulators that require no cloud credentials or quantum hardware access:

| Simulator | Qubits | Speed | Use Case |
|-----------|--------|-------|----------|
| `statevector` | Up to 30 | Fast | Exact simulation, debugging circuits |
| `density_matrix` | Up to 16 | Moderate | Simulating noise, validating error mitigation |
| `mps` | Up to 100 | Moderate | Weakly-entangled circuits (many variational circuits) |
| `stabilizer` | Up to 1000 | Fast | Clifford circuits only (useful for benchmarking) |

The statevector simulator stores the full quantum state (2^N complex amplitudes) in memory. For 30 qubits, this requires 16 GB of RAM. For circuits that exceed local simulation capacity, use the cloud-hosted simulators provided by the quantum backends (Qiskit Aer on IBM, Cirq simulator on Google).

```python
# Local simulator (no credentials required)
result = hq.execute(circuit, shots=1024, backend="simulator")

# Noisy simulator (simulates hardware noise)
noise_model = hq.noise.from_backend("ibm_brisbane")
result = hq.execute(circuit, shots=1024, backend="simulator", noise_model=noise_model)
```

### Integration with ML Pipeline (HIP-0057)

The ML Pipeline manages hybrid quantum-classical training loops. The integration follows the same job submission pattern as classical training:

```yaml
Hybrid Training Job:
  name: "qaoa-portfolio-optimization"
  type: hybrid_quantum
  classical:
    image: "hanzoai/ml-pytorch:2.3-cuda12.4"
    command: ["python", "optimize.py"]
    resources:
      gpus: 1
      memory: "32Gi"
  quantum:
    backend: "auto"             # Router selects best backend
    max_qubits: 20
    max_shots_per_circuit: 8192
    error_mitigation: "zne"
    budget:
      max_circuits: 10000       # Maximum total circuit executions
      max_cost_usd: 50.00       # Cost cap for quantum resources
  experiment: "portfolio-qaoa-sweep"
  tracking_uri: "http://ml.hanzo.svc:8057"
```

The classical optimizer runs on a GPU pod. When it needs a quantum evaluation, it calls the Hanzo Quantum API. The ML Pipeline tracks both classical metrics (loss, convergence) and quantum metrics (circuit depth, shot count, mitigation overhead, quantum cost) in the experiment tracker.

```python
# Inside a hybrid training script
import hanzo_ml
import hanzo_quantum as hq

with hanzo_ml.start_run(run_name="qaoa-depth3-cobyla") as run:
    qaoa = QAOA(problem=problem, depth=3, backend="auto")

    for iteration, evaluation in enumerate(qaoa.optimize()):
        run.log_metrics({
            "objective": evaluation.value,
            "quantum/circuits_executed": evaluation.circuits_executed,
            "quantum/total_shots": evaluation.total_shots,
            "quantum/cost_usd": evaluation.cost_usd,
        }, step=iteration)

    run.log_params({
        "qaoa_depth": 3,
        "backend": qaoa.backend_used,
        "total_quantum_cost_usd": qaoa.total_cost_usd,
    })
```

### Integration with Cloud (HIP-0037)

Hanzo Cloud manages quantum resource scheduling and billing. Quantum job costs are tracked as usage events alongside classical LLM and GPU costs:

```yaml
Quantum Usage Event:
  service: "quantum"
  backend: "ibm_brisbane"
  provider: "ibm"
  circuits_executed: 150
  total_shots: 614400
  total_qubits: 12
  circuit_depth: 45
  cost_cents: 235              # $2.35 for this job
  latency_ms: 45000            # 45 seconds total execution time
  queue_time_ms: 120000        # 2 minutes in provider queue
```

Quantum backends have different pricing models. The Backend Router normalizes these into a unified cost estimate before job submission, so users can set cost caps in their job configuration.

### Backend Pricing (Approximate, 2026)

| Backend | Pricing Model | Approximate Cost |
|---------|--------------|-----------------|
| IBM Quantum | Per second of QPU time | $1.60/second |
| Google (Cirq) | Per circuit execution | $0.003/circuit |
| AWS Braket (IonQ) | Per shot + per task | $0.01/shot + $0.30/task |
| AWS Braket (Rigetti) | Per shot + per task | $0.00035/shot + $0.30/task |
| Azure Quantum (Quantinuum) | Per H1-1QC credit | ~$5/HQC |
| IonQ (direct) | Per shot (gate-dependent) | $0.01-0.03/shot |
| Local Simulator | Free | $0 |

### Configuration

```yaml
# /etc/hanzo-quantum/config.yaml

server:
  host: 0.0.0.0
  port: 8070
  workers: 4

database:
  url: "postgresql://hanzo:password@postgres:5432/hanzo_quantum"

cache:
  url: "redis://redis:6379/0"
  result_ttl: 3600              # Cache results for 1 hour

auth:
  iam_url: "https://hanzo.id"
  verify_tokens: true

backends:
  ibm:
    enabled: true
    api_token: "${IBM_QUANTUM_TOKEN}"
    hub: "ibm-q"
    group: "open"
    project: "main"
    max_qubits: 127
  google:
    enabled: true
    credentials_file: "${GOOGLE_QUANTUM_CREDENTIALS}"
    processor_id: "rainbow"
  aws_braket:
    enabled: true
    region: "us-east-1"
    # Uses AWS credentials from environment
  ionq:
    enabled: true
    api_key: "${IONQ_API_KEY}"
  rigetti:
    enabled: true
    api_key: "${RIGETTI_API_KEY}"
  simulator:
    enabled: true               # Always enabled for development
    max_qubits: 30
    default: true               # Use simulator when no backend specified

compiler:
  optimization_level: 2         # 0=none, 1=light, 2=medium, 3=aggressive
  target_basis_gates: auto      # Auto-detect from backend
  routing_method: "sabre"       # sabre | stochastic | basic

mitigation:
  default_technique: "zne"
  zne_noise_factors: [1, 2, 3]
  zne_extrapolation: "linear"   # linear | polynomial | exponential

metrics:
  enabled: true
  port: 9090
  path: /metrics

logging:
  level: info
  format: json
```

## Implementation

### CLI Interface

```bash
# Execute a circuit from a JSON file
hanzo-quantum run --circuit bell.json --backend simulator --shots 1024

# List available backends and their status
hanzo-quantum backends list

# Get calibration data for a specific backend
hanzo-quantum backends calibration ibm_brisbane

# Submit a VQE job
hanzo-quantum vqe --molecule H2 --ansatz uccsd --backend auto --shots 4096

# Submit a QAOA job
hanzo-quantum qaoa --problem maxcut --graph graph.json --depth 3

# Check job status
hanzo-quantum job status <job-id>

# Get job results
hanzo-quantum job results <job-id>

# Estimate cost before submission
hanzo-quantum estimate --circuit circuit.json --backend ibm_brisbane --shots 4096
```

### Deployment

#### Docker

```bash
docker run -p 8070:8070 -p 9090:9090 \
  -e HANZO_QUANTUM_DATABASE_URL="postgresql://..." \
  -e IBM_QUANTUM_TOKEN="..." \
  -e IONQ_API_KEY="..." \
  hanzoai/quantum:latest
```

#### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-quantum
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-quantum
  template:
    metadata:
      labels:
        app: hanzo-quantum
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      containers:
        - name: hanzo-quantum
          image: hanzoai/quantum:latest
          ports:
            - containerPort: 8070
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: HANZO_QUANTUM_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: hanzo-quantum-secrets
                  key: database-url
            - name: IBM_QUANTUM_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hanzo-quantum-secrets
                  key: ibm-quantum-token
          readinessProbe:
            httpGet:
              path: /ready
              port: 8070
          livenessProbe:
            httpGet:
              path: /alive
              port: 8070
---
apiVersion: v1
kind: Service
metadata:
  name: hanzo-quantum
  namespace: hanzo
spec:
  selector:
    app: hanzo-quantum
  ports:
    - name: api
      port: 8070
    - name: metrics
      port: 9090
```

### Health and Metrics

```yaml
Metrics (Prometheus):
  Counters:
    hanzo_quantum_jobs_total{backend, status, org}        # Total jobs submitted
    hanzo_quantum_circuits_total{backend, org}             # Total circuits executed
    hanzo_quantum_shots_total{backend, org}                # Total shots across all jobs
    hanzo_quantum_cost_cents_total{backend, org}           # Total cost in USD cents

  Histograms:
    hanzo_quantum_job_duration_seconds{backend}            # Job wall-clock duration
    hanzo_quantum_queue_time_seconds{backend}              # Time waiting in provider queue
    hanzo_quantum_compilation_duration_seconds             # Circuit compilation time
    hanzo_quantum_api_request_duration_seconds{endpoint}   # API latency

  Gauges:
    hanzo_quantum_jobs_running{backend}                    # Currently running jobs
    hanzo_quantum_backend_qubits{backend}                  # Available qubits per backend
    hanzo_quantum_backend_status{backend}                  # Backend availability (1=up, 0=down)
    hanzo_quantum_queue_depth{backend}                     # Jobs waiting for execution
```

### Implementation Roadmap

**Phase 1: Core Platform (Q1 2026)**
- Unified circuit IR and compilation to IBM and simulator backends
- Job submission, queuing, and result retrieval API
- Python client library with circuit builder
- Local statevector and density matrix simulators
- CLI interface

**Phase 2: Multi-Backend and Mitigation (Q2 2026)**
- Add Google Cirq, AWS Braket, IonQ, Rigetti backends
- Backend router with cost and fidelity optimization
- Zero-noise extrapolation and measurement error mitigation
- Noise-aware circuit optimization using calibration data
- Noisy simulation support

**Phase 3: AI Applications (Q3 2026)**
- VQE module with molecular Hamiltonians and standard ansatze
- QAOA module with common combinatorial problem encodings
- Quantum kernel methods with scikit-learn integration
- Quantum sampling for generative models
- Integration with ML Pipeline (HIP-0057) for hybrid training

**Phase 4: Production Hardening (Q4 2026)**
- Probabilistic error cancellation (PEC)
- Advanced compilation passes (noise-adaptive routing, dynamical decoupling)
- Cost estimation and budget enforcement
- Hanzo Cloud (HIP-0037) billing integration
- MPS tensor network simulator for large-qubit shallow circuits
- Benchmark suite against classical solvers

## Security Considerations

### Credential Management

Quantum backend API tokens are stored in Hanzo KMS (HIP-0027) and injected into the service via Kubernetes Secrets. Tokens are never logged, never included in job metadata, and never exposed through the API. Each backend credential is scoped to the minimum required permissions (job submission and result retrieval only).

### Circuit Privacy

Quantum circuits may encode proprietary optimization problems, molecular structures, or feature maps. Circuits submitted through Hanzo Quantum are stored in PostgreSQL with encryption at rest and are accessible only to the submitting organization. Circuits are not shared across tenants and are not used for any purpose beyond compilation and execution.

### Result Integrity

Job results include a SHA-256 digest of the raw measurement data returned by the quantum backend. This allows clients to verify that results have not been tampered with between the backend and the Hanzo Quantum API.

### Access Control

All API endpoints require a valid Hanzo IAM bearer token. Permissions are scoped per organization:

```yaml
RBAC Roles:
  quantum-admin:
    - jobs: submit, cancel, read, delete
    - backends: read, configure
    - budgets: set, read

  quantum-user:
    - jobs: submit, cancel (own only), read (own only)
    - backends: read
    - budgets: read

  quantum-viewer:
    - jobs: read
    - backends: read
```

## References

1. [HIP-0037: AI Cloud Platform Standard](./hip-0037-ai-cloud-platform-standard.md)
2. [HIP-0057: ML Pipeline & Training Standard](./hip-0057-ml-pipeline-standard.md)
3. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
4. [HIP-0005: Post-Quantum Security for AI Infrastructure](./hip-0005-post-quantum-security-for-ai-infrastructure.md)
5. [Peruzzo et al., "A variational eigenvalue solver on a photonic quantum processor," Nature Communications 5, 4213 (2014)](https://www.nature.com/articles/ncomms5213)
6. [Farhi et al., "A Quantum Approximate Optimization Algorithm," arXiv:1411.4028 (2014)](https://arxiv.org/abs/1411.4028)
7. [Havlicek et al., "Supervised learning with quantum-enhanced feature spaces," Nature 567, 209-212 (2019)](https://www.nature.com/articles/s41586-019-0980-2)
8. [Temme et al., "Error Mitigation for Short-Depth Quantum Circuits," Physical Review Letters 119, 180509 (2017)](https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.119.180509)
9. [Li and Benjamin, "Efficient Variational Quantum Simulator Incorporating Active Error Minimization," Physical Review X 7, 021050 (2017)](https://journals.aps.org/prx/abstract/10.1103/PhysRevX.7.021050)
10. [Qiskit: An Open-source Framework for Quantum Computing](https://qiskit.org/)
11. [Cirq: A Python Framework for Creating, Editing, and Invoking Noisy Intermediate Scale Quantum Circuits](https://quantumai.google/cirq)
12. [Amazon Braket Developer Guide](https://docs.aws.amazon.com/braket/)
13. [SABRE: A Heuristic for Quantum Circuit Mapping](https://arxiv.org/abs/1809.02573)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
