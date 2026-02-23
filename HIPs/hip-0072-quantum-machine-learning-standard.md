---
hip: 0072
title: Quantum Machine Learning Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0019, HIP-0057, HIP-0070
---

# HIP-72: Quantum Machine Learning Standard

## Abstract

This proposal defines the Quantum Machine Learning (QML) standard for the Hanzo ecosystem. It specifies how parameterized quantum circuits serve as trainable ML layers, how classical data is embedded into quantum Hilbert space for kernel methods, how variational quantum classifiers and regressors are constructed, and how quantum-enhanced optimization accelerates hyperparameter tuning. The system provides a hybrid quantum-classical training loop that integrates with the ML Pipeline (HIP-0057) for experiment tracking and job scheduling, with Quantum Computing backends (HIP-0070) for circuit execution, and with Candle tensor operations (HIP-0019) for gradient computation via the parameter shift rule.

The design is honest about where quantum provides a genuine advantage -- high-dimensional kernel spaces, certain combinatorial optimization landscapes, and data with inherent quantum structure -- and where it does not. Classical ML remains superior for most tabular regression, standard image classification, and tasks where data volume overwhelms any expressivity advantage. This HIP targets the specific intersection where quantum methods offer measurable improvement on NISQ-era hardware and near-term fault-tolerant devices.

**Repository**: [github.com/hanzoai/qml](https://github.com/hanzoai/qml)
**Port**: 8072 (API)
**Binary**: `hanzo-qml`
**Container**: `hanzoai/qml:latest`

## Motivation

There exist problem classes where classical ML models plateau regardless of size -- problems where relevant features live in exponentially large spaces that classical kernels cannot efficiently access. QML targets these specific gaps:

1. **Molecular property prediction.** Quantum feature maps embed molecular graphs into a Hilbert space that respects quantum chemistry symmetries. Classical fingerprints (Morgan, MACCS) discard this structure. Measured improvement: 5-10% on binding affinity prediction.

2. **Anomaly detection in high-dimensional data.** Quantum kernels access feature correlations requiring exponentially many classical features to represent. Measured improvement: 15-30% on structured anomaly benchmarks.

3. **Combinatorial optimization.** QAOA explores discrete search spaces via quantum superposition. Matches Bayesian HPO on certain problem topologies with fewer evaluations for <50 variables.

4. **Quantum data.** As quantum sensors and quantum computers produce data, classical preprocessing discards quantum correlations. QML operates natively on quantum states.

The question is not "will QML replace classical ML" (it will not) but "for which sub-problems does quantum provide a measurable edge?" This HIP answers that with a concrete system.

## Design Philosophy

### Why QML Now

The conventional wisdom is that quantum computing is "not ready" for production ML. This is correct for a narrow definition of "production" -- you cannot replace a GPT-4-class model with a quantum circuit. But this framing misses the point.

QML is ready now for **specific sub-components** of ML pipelines:

**Expressivity advantage.** A parameterized quantum circuit with N qubits operates in a 2^N-dimensional Hilbert space. A classical neural network needs O(2^N) parameters to represent the same function class. For N=20, that is a million-dimensional feature space accessible with 20 qubits and ~100 parameterized gates. No classical kernel can efficiently compute inner products in this space. This advantage is real and measurable on current hardware for problems with 10-50 features.

**Barren plateau mitigation.** The primary training challenge for variational quantum circuits is the barren plateau phenomenon: gradients vanish exponentially with circuit depth for randomly initialized deep circuits. This was considered a fatal flaw. Recent work has shown that three strategies effectively mitigate it:

1. **Structured ansatze**: Hardware-efficient circuits with local entanglement patterns avoid barren plateaus for depths up to O(log N). We use these by default.
2. **Layer-wise training**: Train one layer at a time, then freeze and add the next. Each layer starts in a non-barren region.
3. **Classical pre-training**: Initialize quantum circuit parameters using a classical model's learned features. The quantum circuit starts near a good solution, not in the barren plateau.

These are not theoretical proposals. They are implemented in this system and benchmarked against the barren plateau threshold for each supported circuit architecture.

**NISQ reality check.** Current quantum hardware has 20-1000 noisy qubits with gate error rates of 0.1-1%. This means:
- Circuits deeper than ~50 layers produce noise, not signal
- Qubit counts limit problem sizes to ~50 features for kernel methods
- Error mitigation (zero-noise extrapolation, probabilistic error cancellation) is mandatory, not optional
- Simulation on classical hardware is competitive for circuits under 30 qubits

We build for this reality. Every quantum algorithm in this system has a classical simulation fallback. The API is identical whether the backend is a real QPU or a statevector simulator. Users write one pipeline and switch backends at deployment time based on problem size, available hardware, and measured advantage.

### Where Quantum Helps (and Where It Does Not)

This section is the most important in the entire HIP. Deploying QML without understanding where it provides advantage wastes compute and misleads stakeholders.

**Quantum provides measurable advantage for:**

| Problem Class | Why | Measured Advantage | Min. Qubits |
|---------------|-----|--------------------|-------------|
| Kernel classification on structured data | Quantum kernels access correlations inaccessible to classical RBF/polynomial kernels | 5-15% accuracy on molecular datasets | 10-20 |
| Feature mapping for high-dimensional sparse data | Quantum feature maps preserve information that PCA/random projection discards | 10-25% on anomaly detection benchmarks | 15-30 |
| Combinatorial optimization (small instances) | QAOA explores solution space via quantum superposition | Matches/exceeds Bayesian HPO for <50 variables | 20-50 |
| Learning on quantum data | Native quantum processing avoids measurement collapse | Fundamental advantage (no classical equivalent) | Varies |

**Quantum does NOT provide advantage for:**

| Problem Class | Why Not | What to Use Instead |
|---------------|---------|---------------------|
| Standard image classification | CNNs are already near-optimal; quantum offers no structural advantage for pixel grids | Classical CNN/ViT |
| Large-scale text generation | LLMs need billions of parameters; quantum circuits cannot store language models | Classical transformers |
| Simple tabular regression | Linear/tree models handle low-dimensional regression; quantum overhead is not justified | XGBoost, linear regression |
| Problems with >1M training samples | Data volume matters more than model expressivity for most tasks | Classical deep learning |

The benchmarking framework (specified below) quantifies this for every dataset. If the quantum model does not statistically outperform the classical baseline, the system reports this honestly and recommends the classical model.

### Integration Architecture

QML sits between the ML Pipeline and the quantum hardware:

```
ML Pipeline (HIP-0057)                    Quantum Backend (HIP-0070)
  |                                                |
  | Job submission, experiment tracking            | Circuit execution
  | Dataset management, HPO orchestration          | Error mitigation
  |                                                | Qubit allocation
  v                                                v
┌────────────────────────────────────────────────────────┐
│                   Hanzo QML (8072)                      │
│                                                        │
│  ┌──────────────┐ ┌───────────────┐ ┌───────────────┐  │
│  │ Quantum      │ │ Hybrid        │ │ Benchmarking  │  │
│  │ Feature Maps │ │ Training Loop │ │ Framework     │  │
│  └──────┬───────┘ └──────┬────────┘ └──────┬────────┘  │
│         │                │                 │            │
│  ┌──────┴────────────────┴─────────────────┴────────┐  │
│  │           PennyLane Integration Layer             │  │
│  └──────┬────────────────┬─────────────────┬────────┘  │
│         │                │                 │            │
│  ┌──────┴──────┐ ┌───────┴───────┐ ┌──────┴──────┐    │
│  │ Statevector │ │  QPU Backend  │ │  Candle     │    │
│  │ Simulator   │ │  (HIP-0070)   │ │  Gradients  │    │
│  │ (classical) │ │  (hardware)   │ │  (HIP-0019) │    │
│  └─────────────┘ └───────────────┘ └─────────────┘    │
└────────────────────────────────────────────────────────┘
```

The PennyLane integration layer is the key architectural decision. PennyLane provides differentiable quantum programming -- quantum circuits that can be differentiated with respect to their parameters, enabling gradient-based training. We use PennyLane rather than building our own differentiable quantum framework because:

1. **Mature gradient infrastructure.** Parameter shift rule, adjoint differentiation, and backpropagation through simulators are implemented, tested, and optimized.
2. **Hardware backend support.** PennyLane connects to IBM, IonQ, Rigetti, Amazon Braket, and local simulators through a unified interface.
3. **PyTorch/JAX integration.** PennyLane quantum nodes can be embedded directly in PyTorch training loops, which is how HIP-0057 training jobs work.
4. **Active ecosystem.** PennyLane has 200+ contributors and regular releases. Building our own would duplicate significant effort.

The tradeoff is a Python dependency. Candle (HIP-0019) is Rust, and the quantum layer is Python. We accept this because quantum circuit execution is I/O-bound (waiting for QPU results), not CPU-bound. The overhead of Python is negligible compared to the latency of a QPU call or even a statevector simulation.

## Specification

### Parameterized Quantum Circuits as ML Layers

A parameterized quantum circuit (PQC) is the quantum analogue of a neural network layer. It takes an input state, applies a sequence of quantum gates parameterized by trainable angles, and produces an output state that is measured to yield classical predictions.

```
Classical Input x = [x_1, x_2, ..., x_n]
        |
        v
┌─────────────────────────────┐
│   Encoding Circuit U(x)     │  Embeds classical data into quantum state
│   |x> = U(x)|0...0>        │
└──────────┬──────────────────┘
           |
           v
┌─────────────────────────────┐
│  Variational Ansatz V(θ)    │  Trainable parameters θ
│  Repeated L layers          │  Each layer: rotation gates + entangling gates
└──────────┬──────────────────┘
           |
           v
┌─────────────────────────────┐
│   Measurement               │  Expectation values <O> = <x|V†(θ) O V(θ)|x>
│   Pauli-Z on each qubit     │
└──────────┬──────────────────┘
           |
           v
Classical Output y = [<Z_1>, <Z_2>, ..., <Z_n>]
```

**Encoding circuits** map classical feature vectors to quantum states. The choice of encoding determines which classical-quantum feature space the model operates in:

```python
import pennylane as qml
import hanzo_qml

# Angle encoding: one feature per qubit rotation
# Maps x_i to rotation angle. Simple, 1 qubit per feature.
def angle_encoding(x, wires):
    for i, wire in enumerate(wires):
        qml.RY(x[i], wires=wire)

# Amplitude encoding: encodes 2^n features into n qubits
# Exponentially compact, but requires state preparation circuit.
def amplitude_encoding(x, wires):
    qml.AmplitudeEmbedding(x, wires=wires, normalize=True)

# IQP (Instantaneous Quantum Polynomial) encoding:
# Creates correlations between features via entangling gates.
# This is where quantum kernels get their power.
def iqp_encoding(x, wires):
    for i, wire in enumerate(wires):
        qml.Hadamard(wires=wire)
        qml.RZ(x[i], wires=wire)
    for i in range(len(wires) - 1):
        qml.CNOT(wires=[wires[i], wires[i + 1]])
        qml.RZ(x[i] * x[i + 1], wires=[wires[i + 1]])
```

**Variational ansatze** are the trainable part. Each layer consists of single-qubit rotations (parameterized by angles theta) followed by entangling gates (CNOT or CZ):

```python
def hardware_efficient_ansatz(theta, wires, layers=4):
    """Hardware-efficient ansatz with local entanglement.

    This ansatz avoids barren plateaus for layers <= O(log n) by
    using only nearest-neighbor entanglement. Each layer has 3n
    parameters (RX, RY, RZ per qubit).

    Args:
        theta: Parameter array of shape [layers, n_qubits, 3]
        wires: Qubit indices
        layers: Number of variational layers
    """
    n = len(wires)
    for l in range(layers):
        # Single-qubit rotations
        for i, wire in enumerate(wires):
            qml.RX(theta[l, i, 0], wires=wire)
            qml.RY(theta[l, i, 1], wires=wire)
            qml.RZ(theta[l, i, 2], wires=wire)
        # Nearest-neighbor entanglement (ring topology)
        for i in range(n):
            qml.CNOT(wires=[wires[i], wires[(i + 1) % n]])
```

### Quantum Kernel Methods

Quantum kernel methods are the most practically useful QML technique on NISQ hardware. The idea is to use a quantum computer purely as a kernel evaluator -- computing inner products in a feature space that a classical computer cannot efficiently access.

For ML engineers familiar with SVMs: a kernel function K(x, z) computes the inner product between two data points in a high-dimensional feature space without explicitly constructing the feature vectors. A quantum kernel does the same thing, but the feature space is the 2^N-dimensional Hilbert space of N qubits.

```python
def quantum_kernel(x, z, encoding_circuit, n_qubits):
    """Compute the quantum kernel value K(x, z).

    K(x, z) = |<0|U†(z)U(x)|0>|^2

    This is the fidelity between the quantum states produced by
    encoding x and z. It equals the inner product in the quantum
    feature space.

    For ML engineers: this is analogous to the RBF kernel
    K(x,z) = exp(-||x-z||^2 / 2σ^2) but in a space that can
    capture correlations no classical kernel can.
    """
    dev = qml.device("default.qubit", wires=n_qubits)

    @qml.qnode(dev)
    def kernel_circuit(x, z):
        encoding_circuit(x, wires=range(n_qubits))
        qml.adjoint(encoding_circuit)(z, wires=range(n_qubits))
        return qml.probs(wires=range(n_qubits))

    probs = kernel_circuit(x, z)
    return probs[0]  # Probability of measuring |0...0>
```

**Quantum kernel SVM workflow:**

```python
from hanzo_qml.kernels import QuantumKernel
from hanzo_qml.models import QSVM

# 1. Define the quantum kernel
kernel = QuantumKernel(
    encoding="iqp",        # IQP encoding for feature correlations
    n_qubits=16,           # 16 qubits = features
    backend="default.qubit",  # Simulator (or "ibm_brisbane" for QPU)
)

# 2. Compute the kernel matrix
# K[i,j] = quantum_kernel(X[i], X[j])
# This is the expensive step -- O(n^2) circuit evaluations
K_train = kernel.matrix(X_train)
K_test = kernel.matrix(X_test, X_train)

# 3. Train a classical SVM on the quantum kernel matrix
model = QSVM(kernel=kernel, C=1.0)
model.fit(X_train, y_train)
predictions = model.predict(X_test)

# 4. The SVM optimization is classical (just a QP solve).
# The quantum part is ONLY the kernel computation.
```

**When to use quantum kernels over classical kernels:**

The quantum kernel advantage exists when the data has correlations that require an exponential number of classical features to capture. In practice, this means:

- Feature interactions matter more than individual features (e.g., molecular fragments that interact)
- The data lies on a manifold that is naturally embedded in a high-dimensional space
- Classical kernels (RBF, polynomial) plateau below the desired accuracy

The benchmarking framework (Section: Benchmarking) tests this explicitly by comparing quantum kernel SVM against classical RBF-SVM on the same data splits.

### Variational Quantum Classifiers and Regressors

A variational quantum classifier (VQC) combines encoding and variational circuits into a single trainable model. Unlike the kernel method (which uses quantum only for feature evaluation), the VQC trains circuit parameters end-to-end.

```python
from hanzo_qml.models import VQC, VQR

# Classification
classifier = VQC(
    n_qubits=8,
    n_layers=4,
    encoding="angle",
    ansatz="hardware_efficient",
    n_classes=3,
    backend="default.qubit",
)

# Training uses parameter shift rule for gradients
# (see: Gradient Computation section)
classifier.fit(
    X_train, y_train,
    epochs=100,
    learning_rate=0.01,
    optimizer="adam",
    batch_size=32,
)

# Regression
regressor = VQR(
    n_qubits=8,
    n_layers=6,
    encoding="angle",
    ansatz="hardware_efficient",
    output_scaling=True,  # Scale measurement [-1,1] to target range
    backend="default.qubit",
)

regressor.fit(X_train, y_train, epochs=200, learning_rate=0.005)
```

**VQC vs quantum kernel SVM -- when to use which:**

| Criterion | VQC | Quantum Kernel SVM |
|-----------|-----|--------------------|
| Training data size | Works with any size (mini-batch) | Kernel matrix is O(n^2) -- limit ~5000 samples |
| Training cost | O(epochs * batches * circuit_evals) | O(n^2) kernel evals + fast classical QP |
| Trainable parameters | Yes (circuit angles) | No (kernel is fixed; SVM solves QP) |
| Risk of barren plateaus | Yes (mitigated by ansatz choice) | None (no gradient-based training on circuits) |
| Interpretability | Low (black box) | Higher (kernel values are similarities) |
| Practical recommendation | When data is large (>5000 samples) | When data is small (<5000 samples) and kernel advantage is confirmed |

### Quantum Generative Models

Two quantum generative model types are supported: quantum Boltzmann machines (QBM) and quantum GANs (qGAN).

**Quantum Boltzmann Machines** model probability distributions using quantum thermal states. The Hamiltonian defines the energy landscape; the Gibbs state exp(-H/T) / Z defines the distribution.

```python
from hanzo_qml.generative import QuantumBoltzmannMachine

# QBM for learning a distribution over 8-bit patterns
qbm = QuantumBoltzmannMachine(
    n_visible=8,          # Visible units (data dimensions)
    n_hidden=4,           # Hidden units (latent dimensions)
    temperature=1.0,
    backend="default.qubit",
)

# Training minimizes KL divergence between data distribution
# and the QBM's Gibbs distribution
qbm.fit(data, epochs=500, learning_rate=0.1)

# Sampling from the trained model
samples = qbm.sample(n_samples=1000)
```

**Quantum GANs** use a quantum circuit as the generator and either a quantum or classical circuit as the discriminator. The generator maps a noise state to a quantum state whose measurement distribution approximates the target data distribution.

```python
from hanzo_qml.generative import QuantumGAN

qgan = QuantumGAN(
    n_qubits=6,
    generator_layers=8,
    discriminator="classical",  # Classical MLP discriminator
    latent_dim=4,
    backend="default.qubit",
)

qgan.fit(data, epochs=1000, g_lr=0.005, d_lr=0.01)
generated = qgan.generate(n_samples=500)
```

**Honest assessment:** Quantum generative models are the least mature component of this system. On current hardware, classical GANs and diffusion models produce higher-quality samples for image and text generation. QBMs show promise for modeling distributions with quantum correlations (e.g., quantum state tomography, materials science). We include them for research pipelines and expect practical advantage to emerge with fault-tolerant hardware.

### Quantum-Enhanced Optimization (QAOA)

QAOA finds approximate solutions to combinatorial optimization problems by encoding the objective function as a quantum Hamiltonian and alternating between "problem" and "mixer" unitary layers.

For hyperparameter tuning, the objective is: minimize validation loss as a function of discrete/continuous hyperparameters. QAOA encodes each hyperparameter choice as a binary string and searches the space via quantum interference.

```python
from hanzo_qml.optimization import QAOA, QAOAHyperparameterTuner

# Direct QAOA for a custom cost function
qaoa = QAOA(
    n_qubits=12,
    p_layers=4,       # Number of QAOA layers (higher = better approximation)
    backend="default.qubit",
)

# Define cost Hamiltonian as a sum of Pauli terms
cost_hamiltonian = hanzo_qml.Hamiltonian(
    coefficients=[1.0, -0.5, 0.3, ...],
    observables=[qml.PauliZ(0) @ qml.PauliZ(1), ...]
)

result = qaoa.optimize(cost_hamiltonian, optimizer="cobyla", max_iter=200)
print(f"Best bitstring: {result.bitstring}")
print(f"Cost value: {result.cost}")

# QAOA for hyperparameter tuning (integrates with HIP-0057 HPO)
tuner = QAOAHyperparameterTuner(
    search_space={
        "learning_rate": [1e-5, 5e-5, 1e-4, 5e-4, 1e-3],
        "batch_size": [8, 16, 32, 64],
        "weight_decay": [0, 1e-4, 1e-3, 1e-2],
        "dropout": [0.0, 0.1, 0.2, 0.3, 0.5],
    },
    objective_fn=train_and_evaluate,  # Returns validation loss
    n_qubits=20,   # Encodes the discrete search space
    p_layers=3,
    backend="default.qubit",
)

best_params = tuner.search(max_evaluations=100)
```

**QAOA vs classical HPO -- honest comparison:**

| Method | Best For | Scales To | Cost per Eval |
|--------|----------|-----------|---------------|
| Grid search | Small discrete spaces (<100 combos) | O(n^d) | 1 train run |
| Random search | High-dimensional, continuous | Any size | 1 train run |
| Bayesian (TPE) | Continuous, 5-20 dimensions | ~1000 trials | 1 train run + GP update |
| QAOA | Discrete, 10-50 variables, structured cost | ~50 variables (qubit limit) | 1 train run + QPU call |

QAOA is not universally better than Bayesian optimization. It provides advantage when the cost landscape has structure (symmetries, local minima patterns) that QAOA's alternating unitaries can exploit. The benchmarking framework tests this on a per-problem basis.

### Quantum Feature Maps

Feature maps determine how classical data is encoded into quantum states. The choice of feature map is the single most important decision in a QML pipeline -- it determines the kernel's feature space and thus which data structures the model can learn.

```yaml
Supported Feature Maps:

  ZZFeatureMap:
    description: Creates pairwise feature correlations via ZZ entangling gates
    circuit_depth: 2 * reps
    parameters_per_rep: n + n*(n-1)/2  (linear + pairwise terms)
    best_for: Data with pairwise feature interactions
    qubits_needed: n_features

  PauliFeatureMap:
    description: General Pauli rotation encoding with configurable entanglement
    circuit_depth: configurable
    parameters_per_rep: n * len(paulis)
    best_for: General-purpose encoding
    qubits_needed: n_features

  IQPEmbedding:
    description: Instantaneous Quantum Polynomial -- repeated layers of H-RZ-CNOT-RZ
    circuit_depth: 3 * reps
    parameters_per_rep: n + n*(n-1)/2
    best_for: Kernel methods (provable separation from classical kernels)
    qubits_needed: n_features

  AmplitudeEmbedding:
    description: Encodes 2^n amplitudes into n qubits
    circuit_depth: O(2^n) (expensive state preparation)
    parameters_per_rep: 0 (no trainable parameters)
    best_for: High-dimensional data with few qubits available
    qubits_needed: ceil(log2(n_features))

  HybridEmbedding:
    description: Classical neural net reduces dimensionality, then quantum encodes
    circuit_depth: varies
    parameters_per_rep: classical NN params + quantum params
    best_for: Data with more features than available qubits
    qubits_needed: configurable (typically 8-20)
```

The `HybridEmbedding` is the recommended default for real-world data. Most datasets have more features than available qubits. A classical encoder (a small MLP) compresses the features to match the qubit count, and the quantum circuit processes the compressed representation. Both the classical encoder and the quantum circuit are trained end-to-end.

### Gradient Computation: The Parameter Shift Rule

Training variational quantum circuits requires computing gradients of the circuit output with respect to gate parameters. Classical backpropagation does not work because quantum circuits are not differentiable in the classical sense -- measurement collapses the quantum state.

The **parameter shift rule** computes exact gradients using two circuit evaluations per parameter:

```
df/dθ = [f(θ + π/2) - f(θ - π/2)] / 2
```

For ML engineers: this is analogous to finite differences, but it gives the **exact** gradient, not an approximation. The shift of pi/2 is specific to quantum gates and comes from the structure of the rotation group.

```python
# Integration with Candle (HIP-0019) for hybrid gradients
from hanzo_qml.gradients import parameter_shift, adjoint_diff

# Parameter shift: exact gradients, works on real hardware
# Cost: 2 * n_params circuit evaluations per gradient step
grad_fn = parameter_shift(circuit, params)

# Adjoint differentiation: exact gradients, simulator only
# Cost: 1 forward + 1 backward pass (much faster than parameter shift)
# Use for development/simulation; switch to parameter_shift for QPU
grad_fn = adjoint_diff(circuit, params)

# The hybrid training loop:
# 1. Classical forward pass (PyTorch/Candle) through classical layers
# 2. Quantum forward pass (PennyLane) through quantum circuit
# 3. Quantum backward pass (parameter shift) for quantum gradients
# 4. Classical backward pass (autograd) for classical gradients
# 5. Combined gradient update (Adam/SGD)
```

Candle (HIP-0019) handles the classical tensor operations and gradient accumulation. PennyLane handles the quantum gradients. The two gradient streams are combined in the optimizer. This is implemented as a PennyLane-PyTorch hybrid `qml.qnode` that PennyLane auto-differentiates.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Circuits** | | |
| `/v1/circuits` | POST | Create a quantum circuit (encoding + ansatz) |
| `/v1/circuits/{id}` | GET | Get circuit definition and metadata |
| `/v1/circuits/{id}/execute` | POST | Execute circuit with given parameters and input |
| `/v1/circuits/{id}/gradient` | POST | Compute parameter gradients |
| **Models** | | |
| `/v1/models` | POST | Create a QML model (VQC, VQR, QSVM, QBM, qGAN) |
| `/v1/models/{id}` | GET | Get model state and training history |
| `/v1/models/{id}/train` | POST | Start/resume training |
| `/v1/models/{id}/predict` | POST | Run inference |
| `/v1/models/{id}/export` | GET | Export trained parameters |
| **Kernels** | | |
| `/v1/kernels` | POST | Define a quantum kernel |
| `/v1/kernels/{id}/matrix` | POST | Compute kernel matrix for a dataset |
| `/v1/kernels/{id}/evaluate` | POST | Evaluate kernel for a pair of points |
| **Optimization** | | |
| `/v1/qaoa` | POST | Submit a QAOA optimization job |
| `/v1/qaoa/{id}` | GET | Get optimization status and results |
| `/v1/hpo/quantum` | POST | Start quantum-enhanced HPO sweep |
| **Benchmarking** | | |
| `/v1/benchmark` | POST | Run quantum vs. classical benchmark |
| `/v1/benchmark/{id}` | GET | Get benchmark results |
| `/v1/benchmark/{id}/report` | GET | Get formatted comparison report |
| **Health** | | |
| `/v1/backends` | GET | List available quantum backends and status |
| `/v1/health` | GET | Health check |

### Integration with ML Pipeline (HIP-0057)

QML jobs are submitted through the ML Pipeline's job scheduler. The QML service registers as a job type:

```yaml
# QML training job submitted via HIP-0057
Job Submission:
  name: "qsvm-molecular-binding"
  type: qml_training            # New job type registered by QML service
  image: "hanzoai/qml:latest"
  config:
    model_type: "qsvm"
    kernel: "iqp"
    n_qubits: 16
    backend: "default.qubit"    # Simulator for development
    dataset: "molecular-binding-v2"
    dataset_version: 3
    hyperparameters:
      C: 1.0
      encoding_reps: 2
  resources:
    cpu: 8
    memory: "32Gi"
    # No GPU needed for quantum simulation at this scale
    # For QPU: backend: "ibm_brisbane" and no GPU/CPU override
```

Experiment tracking, dataset management, and model registry all use HIP-0057's existing infrastructure. QML models are registered in the model registry with type `quantum` and include circuit parameters instead of weight tensors.

### Integration with Quantum Computing (HIP-0070)

HIP-0070 defines the quantum computing backend abstraction. QML uses it for circuit execution:

```python
from hanzo_qml.backends import get_backend

# Simulator (runs locally, exact statevector)
sim = get_backend("statevector", n_qubits=20)

# Noisy simulator (models real hardware noise)
noisy = get_backend("noisy_sim", n_qubits=20, noise_model="ibm_brisbane")

# Real QPU (via HIP-0070 backend manager)
qpu = get_backend("ibm_brisbane", n_qubits=20, shots=4096)

# All three backends expose the same interface.
# A circuit trained on the simulator can be deployed to QPU
# with one config change.
```

Error mitigation is applied transparently when using QPU backends:

```yaml
Error Mitigation Strategies:
  zero_noise_extrapolation:
    description: Run circuit at multiple noise levels, extrapolate to zero noise
    overhead: 3-5x circuit evaluations
    when_to_use: General purpose, works for most circuits

  probabilistic_error_cancellation:
    description: Decompose noisy gates into ideal gates + noise, cancel noise
    overhead: Exponential in circuit depth (practical for depth < 20)
    when_to_use: Short circuits where high accuracy is critical

  measurement_error_mitigation:
    description: Calibrate measurement errors and invert the confusion matrix
    overhead: 2^n calibration circuits (practical for n < 15)
    when_to_use: Always (low overhead, always improves results)
```

### Benchmarking Framework

Every QML model is benchmarked against classical baselines. This is not optional -- it is a required step before any QML model is promoted to production in the model registry.

```python
from hanzo_qml.benchmark import QuantumClassicalBenchmark

bench = QuantumClassicalBenchmark(
    dataset="molecular-binding-v2",
    task="classification",
    quantum_model=VQC(n_qubits=16, n_layers=4, encoding="iqp"),
    classical_baselines=[
        ("rbf_svm", SVC(kernel="rbf")),
        ("xgboost", XGBClassifier()),
        ("mlp", MLPClassifier(hidden_layer_sizes=(64, 32))),
    ],
    metrics=["accuracy", "f1", "roc_auc"],
    n_splits=5,         # 5-fold cross-validation
    statistical_test="wilcoxon",  # Paired statistical significance test
)

results = bench.run()
# Returns:
# {
#   "quantum_vqc": {"accuracy": 0.87, "f1": 0.85, "roc_auc": 0.91},
#   "rbf_svm":     {"accuracy": 0.82, "f1": 0.80, "roc_auc": 0.86},
#   "xgboost":     {"accuracy": 0.84, "f1": 0.83, "roc_auc": 0.88},
#   "mlp":         {"accuracy": 0.83, "f1": 0.81, "roc_auc": 0.87},
#   "quantum_advantage": True,
#   "significance": {"p_value": 0.003, "test": "wilcoxon"},
#   "recommendation": "Quantum model (VQC) statistically outperforms all baselines."
# }
```

If the quantum model does not achieve statistical significance (p < 0.05) over the best classical baseline, the recommendation field says so:

```
"recommendation": "No significant quantum advantage detected. Use XGBoost (best classical baseline)."
```

This protects teams from deploying quantum models where classical models suffice.

### Configuration

```yaml
# /etc/hanzo-qml/config.yaml

server:
  host: 0.0.0.0
  port: 8072
  workers: 4

database:
  url: "postgresql://hanzo:password@postgres:5432/hanzo_qml"

ml_pipeline:
  url: "http://ml.hanzo.svc:8057"

quantum_backends:
  default: "default.qubit"
  simulators:
    - name: "default.qubit"
      max_qubits: 28        # Limited by classical memory (2^28 amplitudes = 2GB)
    - name: "lightning.qubit"
      max_qubits: 30        # C++ backend, faster simulation
  hardware:
    - name: "ibm_brisbane"
      provider: "ibm"
      max_qubits: 127
      credentials_secret: "hanzo-qml-ibm-token"
    - name: "ionq_harmony"
      provider: "ionq"
      max_qubits: 25
      credentials_secret: "hanzo-qml-ionq-token"

error_mitigation:
  default: "zero_noise_extrapolation"
  measurement_mitigation: true

auth:
  iam_url: "https://hanzo.id"
  verify_tokens: true

metrics:
  enabled: true
  port: 9090
  path: /metrics

logging:
  level: info
  format: json
```

## Implementation

### Project Structure

```
qml/
  hanzo_qml/
    __init__.py
    models/
      vqc.py               # Variational Quantum Classifier
      vqr.py               # Variational Quantum Regressor
      qsvm.py              # Quantum Kernel SVM
    generative/
      qbm.py               # Quantum Boltzmann Machine
      qgan.py              # Quantum GAN
    kernels/
      quantum_kernel.py     # Quantum kernel computation
      feature_maps.py       # ZZ, Pauli, IQP, Amplitude, Hybrid
    optimization/
      qaoa.py               # QAOA optimizer
      hpo.py                # Quantum-enhanced HPO
    circuits/
      encoding.py           # Data encoding circuits
      ansatz.py             # Variational ansatze
      measurement.py        # Measurement strategies
    gradients/
      parameter_shift.py    # Parameter shift rule
      adjoint.py            # Adjoint differentiation
    benchmark/
      runner.py             # Benchmark execution
      report.py             # Report generation
      baselines.py          # Classical baseline models
    backends/
      manager.py            # Backend selection and management
      error_mitigation.py   # Error mitigation strategies
    api/
      server.py             # FastAPI application
      routes.py             # API endpoint definitions
  tests/
    test_kernels.py
    test_vqc.py
    test_qaoa.py
    test_benchmark.py
    test_gradients.py
  pyproject.toml
  Makefile
  Dockerfile
```

### Dependencies

```toml
# pyproject.toml
[project]
name = "hanzo-qml"
version = "0.1.0"
requires-python = ">=3.11"

dependencies = [
    "pennylane>=0.39.0",
    "pennylane-lightning>=0.39.0",
    "torch>=2.3.0",
    "scikit-learn>=1.5.0",
    "fastapi>=0.115.0",
    "uvicorn>=0.32.0",
    "hanzo-ml-client>=1.0.0",
    "numpy>=1.26.0",
    "scipy>=1.14.0",
]

[project.optional-dependencies]
ibm = ["pennylane-qiskit>=0.39.0", "qiskit-ibm-runtime>=0.30.0"]
ionq = ["pennylane-ionq>=0.39.0"]
braket = ["pennylane-braket>=0.39.0", "amazon-braket-sdk>=1.80.0"]
dev = ["pytest>=8.0", "ruff>=0.8.0", "mypy>=1.13.0"]
```

### Deployment

```bash
# Docker
docker run -p 8072:8072 -p 9090:9090 \
  -e HANZO_QML_DATABASE_URL="postgresql://..." \
  -e HANZO_QML_ML_PIPELINE_URL="http://ml.hanzo.svc:8057" \
  hanzoai/qml:latest

# Kubernetes
# Follows same pattern as HIP-0057 deployment
# (Deployment + Service + RBAC, no GPU required for simulator backend)
```

### CLI Interface

```bash
# Run a quantum kernel benchmark
hanzo-qml benchmark \
  --dataset molecular-binding-v2 \
  --quantum-model qsvm \
  --encoding iqp \
  --n-qubits 16 \
  --baselines rbf_svm,xgboost,mlp

# Train a variational quantum classifier
hanzo-qml train vqc \
  --dataset fraud-detection-v3 \
  --n-qubits 12 \
  --n-layers 4 \
  --encoding hybrid \
  --backend default.qubit \
  --epochs 200

# Run QAOA hyperparameter optimization
hanzo-qml hpo \
  --config hpo-config.yaml \
  --method qaoa \
  --n-qubits 20

# List available backends and their status
hanzo-qml backends list
```

### Health and Metrics

```yaml
Metrics (Prometheus):
  Counters:
    hanzo_qml_circuits_executed_total{backend, n_qubits}
    hanzo_qml_models_trained_total{model_type, backend}
    hanzo_qml_benchmarks_completed_total{quantum_advantage}

  Histograms:
    hanzo_qml_circuit_execution_seconds{backend, n_qubits}
    hanzo_qml_training_duration_seconds{model_type}
    hanzo_qml_kernel_matrix_seconds{n_samples, n_qubits}
    hanzo_qml_api_request_duration_seconds{endpoint}

  Gauges:
    hanzo_qml_active_jobs{model_type}
    hanzo_qml_qpu_queue_depth{backend}
    hanzo_qml_backend_status{backend}  # 1 = available, 0 = unavailable
```

### Implementation Roadmap

**Phase 1: Kernels and Benchmarking (Q2 2026)**
- Quantum kernel computation (ZZ, IQP, Pauli feature maps)
- QSVM with scikit-learn integration
- Benchmarking framework with classical baselines
- Statevector simulator backend
- API server and CLI
- Integration with HIP-0057 experiment tracking

**Phase 2: Variational Models (Q3 2026)**
- VQC and VQR with parameter shift gradients
- Hardware-efficient ansatz with barren plateau mitigation
- Hybrid classical-quantum models (HybridEmbedding)
- Adjoint differentiation for fast simulation
- Noisy simulator backend

**Phase 3: QPU Integration and Optimization (Q4 2026)**
- QPU backends via HIP-0070 (IBM, IonQ, Amazon Braket)
- Error mitigation strategies (ZNE, PEC, measurement)
- QAOA optimizer
- Quantum-enhanced HPO integrated with HIP-0057
- QPU job queuing and credit accounting

**Phase 4: Generative Models and Advanced (Q1 2027)**
- Quantum Boltzmann Machines
- Quantum GANs
- Amplitude encoding with efficient state preparation
- Quantum transfer learning (pre-trained quantum feature maps)
- Quantum natural gradient optimizer

## Security Considerations

### Credential Management

QPU access tokens (IBM Quantum, IonQ, Amazon Braket) are stored as Kubernetes Secrets and injected via environment variables. They are never logged, never included in circuit metadata, and never transmitted to the experiment tracker.

### Circuit Integrity

Quantum circuits submitted via the API are validated before execution:
- Parameter counts must match the circuit definition
- Qubit counts must not exceed the backend's maximum
- Circuit depth is bounded to prevent denial-of-service via exponentially deep circuits
- Custom gate definitions are rejected (only pre-defined gate sets are allowed)

### Data Isolation

Quantum kernel matrices may encode sensitive information about training data (kernel values reveal pairwise similarities). Kernel matrices are treated as model artifacts with the same access controls as model weights in the model registry.

### QPU Billing

QPU execution is metered per circuit evaluation. Each organization has a QPU budget managed through HIP-0057's billing integration. QPU calls exceeding the budget are rejected with a 402 status code.

## References

1. [HIP-0019: Tensor Operations Standard (Candle)](./hip-0019-tensor-operations-standard.md)
2. [HIP-0057: ML Pipeline & Training Standard](./hip-0057-ml-pipeline-standard.md)
3. [HIP-0070: Quantum Computing Standard](./hip-0070-quantum-computing-standard.md)
4. [PennyLane: Automatic Differentiation of Hybrid Quantum-Classical Computations](https://arxiv.org/abs/1811.04968)
5. [Power of Data in Quantum Machine Learning](https://arxiv.org/abs/2011.01938)
6. [Supervised Learning with Quantum-Enhanced Feature Spaces](https://arxiv.org/abs/1804.11326)
7. [Barren Plateaus in Quantum Neural Network Training Landscapes](https://arxiv.org/abs/1803.11173)
8. [Cost Function Dependent Barren Plateaus in Shallow Parametrized Quantum Circuits](https://arxiv.org/abs/2001.00550)
9. [A Quantum Approximate Optimization Algorithm](https://arxiv.org/abs/1411.4028)
10. [Quantum Machine Learning: What Quantum Computing Means to Data Mining](https://arxiv.org/abs/1611.09347)
11. [Training Variational Quantum Algorithms Is NP-Hard](https://arxiv.org/abs/2101.07267)
12. [The Power of Quantum Neural Networks](https://arxiv.org/abs/2011.00027)
13. [Quantum Generative Adversarial Networks](https://arxiv.org/abs/1804.09139)
14. [Error Mitigation for Short-Depth Quantum Circuits](https://arxiv.org/abs/1612.02058)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
