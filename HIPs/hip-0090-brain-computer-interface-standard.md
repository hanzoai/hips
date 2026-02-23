---
hip: 0090
title: Brain-Computer Interface (BCI) Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0009, HIP-0043, HIP-0056
---

# HIP-90: Brain-Computer Interface (BCI) Standard

## Abstract

This proposal defines the Brain-Computer Interface standard for the Hanzo ecosystem. Hanzo BCI provides a multi-device abstraction layer for neural signal acquisition, an AI-driven neural decoding pipeline, and a real-time intent delivery system that bridges human neural activity to Hanzo agents, applications, and services. The standard covers non-invasive (EEG), semi-invasive (ECoG), and invasive (intracortical microelectrode array) signal modalities, and specifies the protocols, latency requirements, data formats, and ethical constraints that govern neural data within the Hanzo platform.

The core thesis is that AI decoding is what makes BCIs practical. Raw neural signals are noisy, high-dimensional, and variable across individuals. Without machine learning, a BCI is a fancy oscilloscope. With the right decoder models -- CNNs for motor imagery, transformers for speech, diffusion models for visual reconstruction -- neural signals become reliable input channels for human-computer interaction.

**Repository**: [github.com/hanzoai/bci](https://github.com/hanzoai/bci)
**Port**: 8090 (HTTP/REST API), 8091 (WebSocket for real-time neural streams)
**Binary**: `hanzo-bci`
**Container**: `hanzoai/bci:latest`

## Motivation

Brain-computer interfaces have crossed the threshold from laboratory curiosity to clinical reality. Neuralink's N1 implant has demonstrated cursor control in human subjects. BrainGate participants have typed at 90 characters per minute using intracortical arrays. Non-invasive EEG-based spellers have achieved 95%+ accuracy with modern deep learning decoders. The hardware exists. What does not exist is a software platform that connects these devices to the broader AI ecosystem.

The problems are concrete:

1. **BCI hardware is fragmented.** A researcher using a 64-channel g.tec EEG cap, a clinician working with a Utah array, and a consumer using a Muse headband all speak different protocols, produce different data formats, and require different preprocessing pipelines. There is no unified abstraction that lets application developers write code once and support multiple devices.

2. **Signal processing is the bottleneck, not hardware.** Modern EEG caps sample at 1024 Hz across 64 channels, producing 65,536 floating-point values per second. Intracortical arrays sample at 30,000 Hz across 128 channels, producing 3.84 million values per second. This data is dominated by noise -- muscle artifacts, power line interference, electrode drift, volume conduction. Extracting intent from this torrent requires real-time AI inference, not traditional signal processing.

3. **No standard connects neural intent to AI agents.** HIP-0009 defines how agents receive commands and coordinate actions. But agents currently accept only text, voice, and structured API calls as input. There is no specification for neural intent as an input modality -- how a decoded motor command or imagined speech becomes an agent action.

4. **Neural data has no privacy framework in AI systems.** Neural signals encode not just intended actions but also emotional states, cognitive load, attention focus, and potentially covert mental content. Existing biometric privacy frameworks (GDPR, BIPA) were designed for fingerprints and face scans, not for continuous brain activity streams. The Hanzo ecosystem needs an explicit neural data governance model.

5. **Closed-loop BCIs require integrated AI.** Therapeutic BCIs -- for seizure prediction, depression treatment, and motor rehabilitation -- operate in a closed loop: decode neural state, compute intervention, deliver stimulation. This loop must execute within milliseconds, demands GPU-accelerated inference (HIP-0043), and must be observable (HIP-0031). No existing BCI platform integrates these capabilities.

## Background: Neuroscience for Engineers

This section explains the neuroscience concepts that inform the technical specification. If you already know what a spike train is, skip to Specification.

### How the Brain Produces Signals

The brain contains approximately 86 billion neurons. Each neuron communicates by generating electrical impulses called **action potentials** (or "spikes") -- brief voltage changes lasting about 1 millisecond with an amplitude of roughly 100 millivolts at the cell body. When a neuron fires, it releases neurotransmitters at synapses, influencing downstream neurons. This electrochemical cascade is the basis of all thought, perception, and motor control.

For BCI purposes, we care about three scales of neural signal:

**Single-unit activity (spikes).** A microelectrode inserted into cortical tissue can detect the action potentials of individual neurons within a radius of approximately 100 micrometers. This is the highest-fidelity signal available. Intracortical arrays like the Utah array and Neuralink N1 record single-unit activity. The signal-to-noise ratio (SNR) is high (10-20 dB), but the method requires neurosurgery and chronic implantation.

**Local field potentials (LFPs).** The same microelectrode, when low-pass filtered below ~300 Hz, captures the aggregate electrical activity of thousands of neurons in the surrounding tissue. LFPs reflect synchronized synaptic input to a cortical region rather than individual spikes. They are more stable over time than single units (electrodes drift, neurons die, but population-level activity persists) and contain information about movement intention, attention, and cognitive state.

**Scalp EEG.** Electrodes placed on the scalp surface detect voltage fluctuations generated by the synchronous activity of millions of cortical neurons. The signal passes through cerebrospinal fluid, skull, and skin, which attenuate and spatially blur it. Scalp EEG has poor spatial resolution (~1-2 cm) and low SNR (0-5 dB for relevant features), but requires no surgery. EEG is the workhorse of consumer and research BCIs.

Between these extremes sits **electrocorticography (ECoG)**, where electrode grids are placed directly on the cortical surface beneath the skull but above the brain tissue. ECoG has better spatial resolution and SNR than scalp EEG (~10x), without penetrating brain tissue like intracortical arrays. It is used in epilepsy surgery and increasingly in BCI research.

### What Makes Neural Decoding Hard

A naive engineer might assume that reading motor cortex activity during hand movement would produce a clean, repeatable signal -- like reading a digital bus. In reality:

1. **Neural coding is distributed and redundant.** The "reach left" command is not encoded in one neuron. It is a pattern across hundreds of neurons, each contributing partial information. The same neuron may participate in "reach left," "reach up," and "grasp," with different firing rates for each.

2. **Neural signals are non-stationary.** The mapping from neural activity to intention changes over hours, days, and weeks. Electrode impedance drifts. Neurons near the electrode die and are replaced by glial scar tissue. The brain itself adapts to the BCI, forming new neural strategies. A decoder trained on Monday's data degrades by Friday.

3. **Noise dominates the signal.** Scalp EEG is roughly 90% noise -- muscle artifact from jaw clenching and eye movement, 50/60 Hz power line interference, electrode contact noise, and volume conduction from distant brain regions. Even intracortical recordings contain substantial noise from neural activity unrelated to the task.

4. **Individual variation is extreme.** Brain anatomy varies significantly across individuals. The hand area of motor cortex is in roughly the same location across people, but the precise neuron-to-movement mapping is unique. A decoder trained on one person's neural data does not generalize to another without substantial transfer learning.

These properties make neural decoding fundamentally an AI problem. Traditional signal processing (bandpass filtering, thresholding, linear discriminant analysis) achieves moderate accuracy on simple tasks. Deep learning achieves high accuracy on complex tasks by learning hierarchical representations that are robust to noise, non-stationarity, and individual variation.

### Signal Modalities Comparison

| Property | Scalp EEG | ECoG | Intracortical MEA |
|----------|-----------|------|-------------------|
| Invasiveness | None | Craniotomy | Brain-penetrating |
| Spatial resolution | ~2 cm | ~1 mm | ~100 um (single neuron) |
| Temporal resolution | ~1 ms | ~1 ms | ~0.03 ms (30 kHz) |
| SNR | 0-5 dB | 10-15 dB | 10-20 dB |
| Channel count | 16-256 | 64-256 | 128-3072 |
| Sample rate | 256-1024 Hz | 1-10 kHz | 20-30 kHz |
| Information transfer rate | 20-60 bits/min | 100-300 bits/min | 500-5000+ bits/min |
| Longevity | Indefinite | Months-years | Months-years (degradation) |
| Setup time | 5-30 min | Surgery | Surgery |
| Use cases | Consumer, research, communication BCIs | Epilepsy monitoring, research BCIs | Motor prosthetics, high-bandwidth communication |

## Design Philosophy

### Why BCI + AI (Not BCI Alone)

A BCI without AI decoding is limited to detecting a handful of coarse brain states -- eyes open vs. closed (alpha rhythm), focused vs. relaxed (beta/theta ratio), or simple binary choices (P300 evoked potentials). These are useful but primitive. They operate at the level of a two-button mouse.

AI decoding transforms BCIs into high-bandwidth input devices:

- **Motor imagery decoding** (CNN/RNN): Classify imagined movements (left hand, right hand, feet, tongue) from EEG with 85-95% accuracy. This provides a 4+ class discrete controller updated every 250ms.
- **Speech decoding** (transformer): Reconstruct intended speech from ECoG or intracortical recordings at 60-90 words per minute. The 2023 Stanford study achieved 62 WPM from a paralyzed participant using RNNs on intracortical data; transformer architectures have since improved this.
- **Visual reconstruction** (diffusion model): Reconstruct the image a person is viewing from fMRI or high-density EEG. While not real-time today, the architecture generalizes to real-time ECoG-based visual prosthetics.
- **Continuous cursor control** (Kalman filter + neural network): Decode intended 2D/3D cursor velocity from motor cortex at 50 Hz. This provides mouse-equivalent pointing with zero physical movement.

The AI decoder is not an accessory. It is the core technology that makes a BCI usable. Raw neural data is the fuel; the AI model is the engine.

### Why Multi-Device Abstraction

The BCI hardware landscape resembles the early days of graphics cards: every vendor has a proprietary protocol, data format, and SDK. Building a BCI application today means choosing one device and hard-coding to its API.

Hanzo BCI provides a **Hardware Abstraction Layer (HAL)** that normalizes all devices into a common interface:

```
Application Layer (Agent SDK, Chat, any Hanzo service)
         │
    Neural Intent API (decoded commands, probabilities, latencies)
         │
    Decoder Layer (AI models for each signal type)
         │
    Preprocessing Layer (artifact removal, re-referencing, filtering)
         │
    Hardware Abstraction Layer (unified device interface)
         │
    ┌────┴─────────┬──────────────┬─────────────────┐
    │              │              │                  │
  BCI2000      LSL (Lab       Neuralink         Vendor
  Protocol     Streaming      Link Protocol     Native SDK
               Layer)                           (g.tec, etc.)
```

The HAL speaks three upstream protocols:

1. **BCI2000** -- The oldest and most widely supported BCI framework. Defines a standardized data acquisition, signal processing, and application interface used in hundreds of research labs. The Hanzo HAL implements BCI2000's Operator module protocol, allowing any BCI2000-compatible device to connect without modification.

2. **Lab Streaming Layer (LSL)** -- A cross-platform library for real-time streaming of time-series data over a network. LSL is the de facto standard for multi-device synchronization in neuroscience. An LSL stream has a name, type, channel count, sample rate, and format. The Hanzo HAL discovers LSL streams on the local network and ingests them automatically.

3. **Vendor-native protocols** -- For devices that support neither BCI2000 nor LSL (primarily consumer devices like Muse, Emotiv, OpenBCI), the HAL includes thin driver adapters that translate vendor Bluetooth/USB protocols into the internal stream format.

Application developers never see the device layer. They subscribe to neural intent events via the Agent SDK (HIP-0009) or PubSub (HIP-0056) and receive decoded, classified, timestamped intent objects.

### Ethical Framework for Neural Data

Neural data is categorically different from other biometric data. A fingerprint reveals identity. Neural data reveals thought. This distinction demands a governance model that goes beyond standard biometric protections.

**Principle 1: Cognitive Liberty.** Users have the absolute right to control access to their neural data. No Hanzo service may record, store, or transmit raw neural signals without explicit, informed, revocable consent. Consent is per-session, not per-account. Opting in to neural input for one application does not grant access to any other application.

**Principle 2: Minimal Retention.** Raw neural signals are processed in memory and discarded after decoding. Only decoded intent labels (e.g., "left hand motor imagery, probability 0.87") are persisted, and only when the user explicitly enables intent logging. Raw signal storage is available for research applications with IRB approval and user consent but is never the default.

**Principle 3: On-Device Decoding Preference.** When hardware permits, neural decoding runs on the user's local device. Sending raw neural signals to a remote server increases both latency and privacy risk. The Hanzo BCI server can run locally (laptop GPU, edge device) or in the cloud, but local deployment is the recommended default for consumer applications.

**Principle 4: Neural Data is Never Training Data (By Default).** Decoded intent and raw neural signals are never used to train Hanzo models unless the user explicitly opts in to a research program with full IRB oversight. This differs from standard telemetry policies where anonymized usage data may be collected by default.

**Principle 5: No Covert Neural Assessment.** The BCI system decodes only the signal types the user has explicitly selected. If a user enables motor imagery decoding, the system does not simultaneously decode emotional state, cognitive load, or attention focus, even if the underlying signals contain that information.

## Specification

### Architecture Overview

The BCI service implements a five-stage pipeline from raw signal acquisition to delivered intent:

```
Stage 1       Stage 2          Stage 3           Stage 4          Stage 5
Acquire  -->  Preprocess  -->  Extract  -->      Decode  -->      Deliver
              & Clean          Features           Intent           Intent
   │              │                │                │                │
   v              v                v                v                v
 HAL         Artifact          Feature          AI Model          PubSub
 Drivers     Removal           Space            Inference         (HIP-56)
             Engine            Projection        (HIP-43)         Agent SDK
                                                                  (HIP-09)
```

**Stage 1: Acquisition.** The HAL receives raw samples from connected devices. Each sample is a vector of floating-point voltage values (one per channel) with a hardware timestamp. The HAL normalizes timestamps to UTC nanoseconds, converts voltage units to microvolts, and emits samples into a ring buffer. The ring buffer size is configurable (default: 10 seconds of data per device).

**Stage 2: Preprocessing.** Raw signals pass through an artifact removal pipeline:

1. **Notch filter** at 50 Hz and 60 Hz (configurable) to remove power line interference.
2. **Bandpass filter** specific to the signal modality: 0.5-45 Hz for EEG, 0.5-200 Hz for ECoG, 300-6000 Hz for spike detection.
3. **Common average re-referencing (CAR)** for EEG: subtract the mean across all channels to reduce common-mode noise.
4. **Artifact rejection**: Channels exceeding a voltage threshold (default: +/-100 uV for EEG, +/-500 uV for ECoG) are marked as artifact-contaminated. Epochs with >30% contaminated channels are dropped.
5. **Eye movement correction** (for EEG): Independent Component Analysis (ICA) or regression-based removal of electrooculographic (EOG) artifacts using frontal electrode signals.

All preprocessing runs on CPU with SIMD acceleration. For a 64-channel EEG at 1024 Hz, preprocessing consumes <5% of a single CPU core.

**Stage 3: Feature Extraction.** Clean signals are transformed into a lower-dimensional feature representation suitable for the decoder model:

| Signal Type | Feature | Dimensionality | Update Rate |
|-------------|---------|---------------|-------------|
| EEG motor imagery | Common Spatial Patterns (CSP) | 2 * n_classes features | 4 Hz (250ms windows) |
| EEG P300 | Windowed voltage averages | channels * time_points | Per stimulus (variable) |
| EEG SSVEP | FFT magnitude at target frequencies | n_targets | 4 Hz |
| ECoG speech | High-gamma (70-150 Hz) analytic amplitude | channels * time_bins | 50 Hz (20ms windows) |
| Intracortical spikes | Binned spike counts per channel | n_channels * n_bins | 50 Hz (20ms bins) |
| Intracortical LFP | Multi-taper spectral power in bands | n_channels * n_bands | 20 Hz (50ms windows) |

Feature extraction reduces data volume by 100-1000x while preserving task-relevant information. This reduction is critical for meeting real-time inference deadlines.

**Stage 4: Decoding.** Feature vectors are fed to AI decoder models that classify intent or estimate continuous control signals. Decoding runs on GPU via the Engine (HIP-0043) inference pipeline. The decoder model architecture depends on the application:

| Application | Model Architecture | Input | Output | Latency Target |
|-------------|-------------------|-------|--------|----------------|
| Motor imagery classification | EEGNet (compact CNN) | CSP features, 250ms window | Class probabilities (4 classes) | <50 ms |
| Cursor control | Kalman filter + MLP | Spike counts, 20ms bins | 2D velocity vector | <30 ms |
| Speech decoding | Transformer encoder | High-gamma features, 20ms frames | Phoneme sequence | <200 ms |
| Speech-to-text | Transformer encoder-decoder | Phoneme sequence | Text tokens | <500 ms |
| Visual reconstruction | Latent diffusion model | ECoG high-gamma, 1s window | 64x64 image | <2000 ms |
| Emotion classification | LSTM | EEG band power, 5s window | Valence-arousal coordinates | <1000 ms |
| Seizure prediction | Temporal CNN | ECoG spectral power, 30s window | Seizure probability | <5000 ms |

Models are served using the Engine's (HIP-0043) standard model loading and inference pipeline. BCI-specific models are stored in ONNX format for portability and loaded via the Engine's ONNX runtime backend.

**Stage 5: Delivery.** Decoded intents are published as structured events to PubSub (HIP-0056) topics and/or delivered directly to agents via the Agent SDK (HIP-0009). The intent event format is:

```json
{
  "type": "neural_intent",
  "timestamp_utc_ns": 1740307200000000000,
  "device_id": "neuralink-n1-0042",
  "modality": "intracortical",
  "decoder": "cursor_control_v3",
  "intent": {
    "class": "cursor_velocity",
    "value": { "vx": 0.34, "vy": -0.12 },
    "confidence": 0.91,
    "latency_ms": 28
  },
  "session_id": "bci_sess_abc123",
  "user_id": "usr_xyz789"
}
```

### Hardware Abstraction Layer

The HAL provides a uniform interface across all supported devices:

```python
class BCIDevice(Protocol):
    """
    Abstract interface for any BCI acquisition device.
    Implementations exist for BCI2000, LSL, and vendor-native protocols.
    """

    @property
    def device_id(self) -> str:
        """Unique identifier for this device instance."""
        ...

    @property
    def modality(self) -> SignalModality:
        """EEG, ECOG, INTRACORTICAL, or HYBRID."""
        ...

    @property
    def channel_count(self) -> int:
        """Number of acquisition channels."""
        ...

    @property
    def sample_rate_hz(self) -> float:
        """Nominal sampling rate in Hz."""
        ...

    @property
    def channel_labels(self) -> list[str]:
        """Channel names following the 10-20 system (EEG) or array geometry."""
        ...

    async def connect(self) -> None:
        """Establish connection to the device. Raises BCIDeviceError on failure."""
        ...

    async def disconnect(self) -> None:
        """Gracefully disconnect. Flushes remaining samples."""
        ...

    async def start_acquisition(self) -> None:
        """Begin streaming samples to the ring buffer."""
        ...

    async def stop_acquisition(self) -> None:
        """Stop streaming. Device remains connected."""
        ...

    def read_samples(self, n: int) -> NDArray[np.float64]:
        """Read n samples from ring buffer. Shape: (n, channel_count). Units: microvolts."""
        ...
```

Device discovery is automatic. On startup, the BCI service:

1. Scans for LSL streams on the local network (multicast discovery).
2. Attempts connection to any configured BCI2000 Operator port.
3. Scans Bluetooth for known consumer devices (Muse, Emotiv, OpenBCI Cyton/Ganglion).
4. Registers discovered devices in the service registry.

### BCI2000 Protocol Support

BCI2000 is a general-purpose software platform for BCI research, developed at the Wadsworth Center and used in over 400 laboratories worldwide. It defines a modular architecture with four components: Source (acquisition), Signal Processing, Application, and Operator.

The Hanzo BCI service implements the **Operator interface**, meaning it can control any BCI2000 pipeline remotely. It also implements a **Source module adapter** that ingests BCI2000's data format (state vector + signal matrix per block) and converts it to the Hanzo internal stream format.

```
BCI2000 Pipeline          Hanzo BCI
┌───────────┐            ┌──────────────────┐
│  Source    │───signal──>│  BCI2000 Adapter  │
│  (g.USBamp,│           │  (Source module)   │
│   BioSemi) │           └────────┬───────────┘
└───────────┘                     │
                                  v
                          ┌──────────────────┐
                          │  Preprocessing    │
                          │  Pipeline         │
                          └──────────────────┘
```

BCI2000 state variables (e.g., `TargetCode`, `Feedback`, `StimulusTime`) are preserved as metadata on each sample block, enabling the Hanzo decoder to use paradigm-specific timing information.

### Lab Streaming Layer (LSL) Support

LSL is a transport protocol for real-time time-series data, widely adopted in neuroscience for its clock synchronization and network discovery features. An LSL stream is defined by:

- **Name**: Human-readable stream identifier (e.g., "Emotiv_EEG").
- **Type**: Data category (e.g., "EEG", "Markers", "Gaze").
- **Channel count**: Number of data channels.
- **Nominal rate**: Expected sampling rate (0 for irregular streams like event markers).
- **Channel format**: Data type per sample (float32, double64, int32, string).

The Hanzo BCI service runs an LSL inlet resolver that continuously discovers streams on the local network. When a new EEG, ECoG, or neural stream is discovered, the service automatically creates a `BCIDevice` instance for it, begins ingesting data, and registers it in the device registry.

LSL's built-in clock synchronization (using NTP-like round-trip estimation) provides sub-millisecond timestamp alignment across devices, which is critical for multi-modal BCI setups (e.g., EEG + eye tracking + event markers).

### Decoder Model Specification

Decoder models are the AI core of the BCI pipeline. The service ships with pre-trained models for common paradigms and supports custom model deployment.

#### EEGNet (Motor Imagery)

EEGNet is a compact convolutional neural network designed specifically for EEG-based BCIs. Its architecture exploits the known spatial and temporal structure of EEG signals:

```
Input: (batch, 1, channels, timepoints)    # e.g., (1, 1, 64, 256) for 64ch @ 1024Hz, 250ms

Layer 1 - Temporal Convolution:
    Conv2D(1, F1, (1, kernel_length))      # Learn temporal filters
    BatchNorm → ELU

Layer 2 - Depthwise Spatial Convolution:
    DepthwiseConv2D(F1, D*F1, (channels, 1))  # Learn spatial filters per temporal feature
    BatchNorm → ELU → AvgPool → Dropout

Layer 3 - Separable Convolution:
    SeparableConv2D(D*F1, F2, (1, 16))    # Learn temporal patterns in feature space
    BatchNorm → ELU → AvgPool → Dropout

Output: Dense(F2, n_classes) → Softmax     # Class probabilities
```

Why this architecture works for EEG: Layer 1 acts as a bank of FIR bandpass filters in the temporal domain. Layer 2 performs spatial filtering equivalent to Common Spatial Patterns (CSP) but learned end-to-end. Layer 3 captures temporal dynamics within the spatially filtered features. The entire network has 2,000-10,000 parameters depending on configuration -- small enough to run inference in <5 ms on CPU, <1 ms on GPU.

Default configuration: F1=8, D=2, F2=16, kernel_length=64 (62.5 ms at 1024 Hz).

#### Transformer Speech Decoder

For speech decoding from ECoG or intracortical recordings, the service uses a transformer encoder-decoder architecture:

```
Encoder:
    Input: High-gamma analytic amplitude, (batch, time_frames, channels)
    Positional encoding (sinusoidal, 20ms frame resolution)
    N transformer encoder layers (N=6, d_model=256, n_heads=8)
    Output: Contextualized neural representations

Decoder:
    Input: Previously decoded phonemes (autoregressive)
    N transformer decoder layers (N=6, d_model=256, n_heads=8)
    Cross-attention to encoder output
    Output: Phoneme logits at each step

Post-processing:
    CTC beam search or greedy decoding
    Phoneme-to-grapheme conversion
    Language model rescoring (optional, adds ~50ms latency)
```

The encoder processes 50 frames (1 second) of neural data per forward pass. The decoder generates phonemes autoregressively. End-to-end latency from neural activity to text output is 150-200 ms, within the 200 ms target for communication BCIs.

#### Adaptive Calibration

All decoder models support online adaptive calibration to handle neural signal non-stationarity:

```python
class AdaptiveDecoder:
    """
    Wraps a base decoder with online adaptation.
    Uses exponential moving average of batch normalization
    statistics and periodic fine-tuning of the final classification layer.
    """

    def __init__(self, base_model: nn.Module, adaptation_rate: float = 0.01):
        self.model = base_model
        self.rate = adaptation_rate
        self.buffer = CalibrationBuffer(max_size=1000)

    async def decode(self, features: Tensor) -> Intent:
        """Decode and optionally update."""
        intent = self.model.forward(features)
        if intent.confidence < self.confidence_threshold:
            self.buffer.add(features, label=None)  # unsupervised
        return intent

    async def calibrate(self, features: Tensor, label: int):
        """Supervised calibration from user feedback."""
        self.buffer.add(features, label=label)
        if self.buffer.is_full:
            self._update_final_layer()
            self.buffer.clear()
```

Calibration operates in two modes:

1. **Supervised**: The user performs known actions (e.g., "imagine moving your left hand") and the system updates the decoder with labeled data. Used during initial setup and periodic recalibration.
2. **Unsupervised**: The decoder tracks batch normalization statistics and adjusts internal representations to compensate for distribution drift. This runs continuously without user intervention.

### Real-Time Latency Requirements

BCI applications have strict latency budgets because neural control loops must feel responsive to the user. Perceptible delays break the sense of agency and degrade control accuracy.

| Application | End-to-End Latency | Rationale |
|------------|-------------------|-----------|
| Motor cursor control | <50 ms | Fitts's Law: control accuracy degrades linearly with delay beyond 50 ms. BrainGate studies show optimal performance at 30-45 ms. |
| Discrete selection (P300, SSVEP) | <200 ms | User perceives selection as instantaneous below 200 ms. Higher latency disrupts the stimulus-response rhythm. |
| Communication (speech BCI) | <200 ms | Conversational turn-taking tolerates ~200 ms delay. Higher latency causes users to slow their speech rate. |
| Closed-loop neurostimulation | <10 ms | Seizure abortion requires stimulation within one oscillation cycle (~10 ms at beta frequency). |
| Emotion/state monitoring | <1000 ms | Emotional state changes over seconds. 1-second granularity is sufficient for adaptive interfaces. |
| Visual reconstruction | <2000 ms | Image reconstruction is not real-time interactive. 2-second updates are acceptable for assistive viewing. |

The latency budget is distributed across pipeline stages:

```
Total: 50 ms (motor control example)
  Acquisition + buffering:   5 ms  (one 20ms bin, captured halfway)
  Preprocessing:             3 ms  (filtering, artifact detection)
  Feature extraction:        2 ms  (spike binning or CSP projection)
  Neural network inference: 25 ms  (GPU forward pass)
  Post-processing:           5 ms  (smoothing, thresholding, output formatting)
  Network delivery:         10 ms  (PubSub to application)
```

The service enforces latency SLOs. If any pipeline stage exceeds its budget, the service emits a `bci.latency.exceeded` metric (HIP-0031) and logs a warning. Persistent latency violations trigger an alert.

### Integration with Agent SDK (HIP-0009)

Neural intent events are first-class inputs to the Agent SDK. An agent can subscribe to neural intent exactly as it subscribes to text input or tool results:

```python
from hanzo.agent import HanzoAgent
from hanzo.bci import NeuralIntentSource, MotorImageryDecoder

class NeuralControlAgent(HanzoAgent):
    """Agent that accepts neural commands alongside text."""

    def __init__(self, config):
        super().__init__(config)
        self.neural = NeuralIntentSource(
            decoder=MotorImageryDecoder(model="eegnet-4class-v3"),
            device_filter={"modality": "eeg"}
        )

    async def observe(self, environment):
        """Merge neural and text observations."""
        text_obs = await environment.get_text_input()
        neural_obs = await self.neural.get_latest_intent()

        if neural_obs and neural_obs.confidence > 0.8:
            return Observation(
                source="neural",
                intent=neural_obs.intent_class,
                confidence=neural_obs.confidence
            )
        return Observation(source="text", content=text_obs)
```

The Agent SDK treats neural intent as a high-priority, low-latency input channel. When both text and neural inputs are available, the agent's `think()` method receives both and can decide which to act on based on confidence and context.

### Integration with PubSub (HIP-0056)

The BCI service publishes to the following PubSub topic hierarchy:

```
bci.device.{device_id}.raw          # Raw samples (disabled by default, privacy)
bci.device.{device_id}.features     # Extracted features (opt-in)
bci.device.{device_id}.intent       # Decoded intents (default)
bci.device.{device_id}.status       # Device status (connected, disconnected, artifact)
bci.session.{session_id}.intent     # All intents for a session
bci.session.{session_id}.markers    # Experiment markers and events
```

Raw sample topics are disabled by default and require explicit activation with a consent token. Feature and intent topics carry only derived, lower-dimensional data that cannot be used to reconstruct raw neural activity.

### Integration with Engine (HIP-0043)

Decoder models are served by the Hanzo Engine (HIP-0043) using its ONNX runtime backend. The BCI service communicates with the Engine over a local gRPC channel:

```protobuf
service BCIDecoder {
    // Single inference call for discrete classification
    rpc Decode(DecodeRequest) returns (DecodeResponse);

    // Bidirectional streaming for continuous control
    rpc StreamDecode(stream FeatureFrame) returns (stream IntentFrame);
}

message FeatureFrame {
    int64 timestamp_ns = 1;
    string device_id = 2;
    repeated float features = 3;     // Flattened feature vector
    repeated int32 shape = 4;        // Original tensor shape
}

message IntentFrame {
    int64 timestamp_ns = 1;
    string intent_class = 2;
    float confidence = 3;
    map<string, float> class_probabilities = 4;
    repeated float continuous_output = 5;  // For cursor velocity etc.
    float inference_latency_ms = 6;
}
```

The `StreamDecode` RPC uses bidirectional streaming for continuous decoding applications (cursor control, speech). Feature frames flow in; intent frames flow out. The Engine maintains model state (hidden states for RNNs, KV cache for transformers) across frames within a session.

### Data Storage: BIDS Compliance

For research applications where raw neural data is stored (with user consent), the BCI service writes data in **Brain Imaging Data Structure (BIDS)** format, the community standard for neuroimaging data organization.

```
bids_root/
├── dataset_description.json
├── participants.tsv
├── sub-001/
│   └── ses-20260223/
│       └── eeg/
│           ├── sub-001_ses-20260223_task-motorImagery_eeg.edf
│           ├── sub-001_ses-20260223_task-motorImagery_eeg.json
│           ├── sub-001_ses-20260223_task-motorImagery_channels.tsv
│           ├── sub-001_ses-20260223_task-motorImagery_events.tsv
│           └── sub-001_ses-20260223_task-motorImagery_electrodes.tsv
```

BIDS sidecar JSON files include Hanzo-specific extensions:

```json
{
  "TaskName": "motorImagery",
  "SamplingFrequency": 1024,
  "EEGReference": "CAR",
  "SoftwareFilters": {
    "notch": {"frequency": [50, 60]},
    "bandpass": {"low": 0.5, "high": 45.0}
  },
  "HanzoBCI": {
    "decoder_model": "eegnet-4class-v3",
    "decoder_version": "1.2.0",
    "preprocessing_pipeline": "standard_eeg_v1",
    "session_id": "bci_sess_abc123",
    "consent_token": "consent_xyz789",
    "data_retention_days": 90
  }
}
```

Raw data files use European Data Format (EDF+), the standard interchange format for physiological signals. For intracortical recordings, Neurodata Without Borders (NWB) format is used instead of EDF+ due to its support for spike-sorted data and high channel counts.

### Closed-Loop BCI Architecture

Closed-loop BCIs decode neural state and deliver stimulation feedback, forming a control loop between brain and device. This architecture is used for seizure prediction/abortion, deep brain stimulation for depression, and motor rehabilitation.

```
┌──────────────────────────────────────────────────────────────────┐
│                        Closed Loop                               │
│                                                                  │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌────────────┐ │
│  │  Sense   │───>│  Decode  │───>│ Decide   │───>│ Stimulate  │ │
│  │ (Record) │    │ (AI)     │    │ (Policy) │    │ (Actuate)  │ │
│  └────┬─────┘    └──────────┘    └──────────┘    └─────┬──────┘ │
│       │                                                 │        │
│       └─────────────────<───────────────────────────────┘        │
│                     Neural Tissue                                │
└──────────────────────────────────────────────────────────────────┘
```

**Sense**: Continuous recording from implanted electrodes. For seizure prediction, this is typically ECoG from epileptogenic cortex sampled at 1-2 kHz.

**Decode**: AI model classifies current neural state. For seizure prediction, a temporal CNN analyzes 30-second windows of spectral features to estimate seizure probability 30-60 seconds before clinical onset.

**Decide**: A control policy determines whether to stimulate and with what parameters. The policy must balance sensitivity (catch all seizures) against specificity (avoid unnecessary stimulation). This is a reinforcement learning problem: the policy is trained to minimize seizure duration while minimizing total stimulation time.

**Stimulate**: Electrical stimulation is delivered through the same or adjacent electrodes. Parameters include frequency (typically 130-185 Hz), pulse width (60-200 us), amplitude (1-5 mA), and duration (30-120 seconds).

The closed-loop latency requirement is <10 ms from detection to stimulation onset. The BCI service achieves this by running the sense-decode-decide loop on a dedicated GPU stream with pre-allocated memory, bypassing the standard scheduling queue.

```python
class ClosedLoopController:
    """
    Hard real-time closed-loop BCI controller.
    Bypasses standard pipeline for deterministic latency.
    """

    def __init__(self, decoder: nn.Module, policy: StimulationPolicy,
                 stimulator: StimulationDevice):
        self.decoder = decoder
        self.policy = policy
        self.stimulator = stimulator
        self.loop_budget_ms = 10.0

    async def run(self, device: BCIDevice):
        """Main closed loop. Runs until stopped."""
        while self.active:
            samples = device.read_samples(n=self.window_size)
            features = self.extract_features(samples)

            t0 = time.monotonic_ns()
            state = self.decoder(features)
            action = self.policy.decide(state)
            if action.stimulate:
                await self.stimulator.deliver(action.parameters)
            elapsed_ms = (time.monotonic_ns() - t0) / 1e6

            if elapsed_ms > self.loop_budget_ms:
                emit_metric("bci.closed_loop.overrun", elapsed_ms)
```

### Security and Encryption

Neural data in transit is encrypted with TLS 1.3 minimum. Neural data at rest (when stored per user consent) is encrypted with AES-256-GCM, with per-user encryption keys managed by KMS (HIP-0027).

Access control:

| Action | Required Permission |
|--------|-------------------|
| Connect BCI device | `bci:device:connect` |
| Read decoded intent (own) | `bci:intent:read:self` |
| Read decoded intent (other user) | `bci:intent:read:any` (admin only) |
| Store raw neural data | `bci:raw:store` + consent token |
| Access raw neural data | `bci:raw:read` + consent token + audit log |
| Configure decoder model | `bci:decoder:configure` |
| Run closed-loop stimulation | `bci:stimulation:execute` (requires clinical approval flag) |

All access to raw neural data is logged to an immutable audit trail. The audit log records who accessed what data, when, and for what stated purpose. This log is retained indefinitely regardless of data retention policies.

### API Endpoints

The BCI service exposes a REST API on port 8090:

```yaml
Devices:
  GET    /v1/devices                    # List connected devices
  GET    /v1/devices/{id}               # Device details
  POST   /v1/devices/{id}/connect       # Connect to device
  POST   /v1/devices/{id}/disconnect    # Disconnect device
  POST   /v1/devices/{id}/calibrate     # Start calibration session
  GET    /v1/devices/{id}/impedance     # Electrode impedance check

Sessions:
  POST   /v1/sessions                   # Create BCI session
  GET    /v1/sessions/{id}              # Session details
  POST   /v1/sessions/{id}/start        # Start decoding
  POST   /v1/sessions/{id}/stop         # Stop decoding
  GET    /v1/sessions/{id}/intents      # Query decoded intents (paginated)

Decoders:
  GET    /v1/decoders                   # List available decoder models
  POST   /v1/decoders/load              # Load a decoder model
  GET    /v1/decoders/{id}/metrics      # Decoder accuracy metrics

Data (research, consent-gated):
  POST   /v1/data/consent               # Grant data storage consent
  DELETE /v1/data/consent               # Revoke consent (triggers deletion)
  GET    /v1/data/export                # Export data in BIDS format
  GET    /v1/data/retention             # View retention policy

Health:
  GET    /v1/health                     # Service health
  GET    /v1/metrics                    # Prometheus metrics
```

WebSocket endpoint on port 8091:

```yaml
ws://host:8091/v1/stream/intent/{session_id}   # Real-time intent stream
ws://host:8091/v1/stream/features/{session_id}  # Real-time feature stream (opt-in)
ws://host:8091/v1/stream/raw/{session_id}        # Raw signal stream (consent-gated)
```

### Configuration

```yaml
# hanzo-bci.yaml
server:
  http_port: 8090
  ws_port: 8091
  tls:
    enabled: true
    cert_file: /etc/hanzo/bci/tls.crt
    key_file: /etc/hanzo/bci/tls.key

acquisition:
  ring_buffer_seconds: 10
  lsl_discovery: true
  bci2000_operator_port: 3999
  bluetooth_scan: true
  bluetooth_scan_interval_seconds: 30

preprocessing:
  notch_frequencies: [50, 60]
  eeg_bandpass: [0.5, 45.0]
  ecog_bandpass: [0.5, 200.0]
  spike_bandpass: [300, 6000]
  artifact_threshold_uv: 100
  artifact_channel_rejection_ratio: 0.3
  car_reference: true
  eog_correction: true

decoding:
  engine_grpc_address: "localhost:8080"
  default_motor_imagery_model: "eegnet-4class-v3"
  default_speech_model: "transformer-speech-v2"
  adaptive_calibration: true
  adaptation_rate: 0.01
  confidence_threshold: 0.6

privacy:
  raw_data_storage: false          # Must be explicitly enabled per session
  feature_logging: false
  intent_logging: true             # Decoded intents only
  data_retention_days: 90
  encryption_key_source: "kms"     # HIP-0027
  audit_log_retention: "indefinite"

pubsub:
  broker_address: "localhost:8056"
  topic_prefix: "bci"
  raw_topics_enabled: false

closed_loop:
  enabled: false                   # Requires explicit clinical configuration
  max_loop_latency_ms: 10
  gpu_stream_dedicated: true
```

## Backwards Compatibility

This is a new standard. No backwards compatibility concerns exist. The HAL's support for BCI2000 and LSL ensures compatibility with existing BCI research infrastructure.

## Security Considerations

1. **Raw neural signals must never be exposed without consent.** The default configuration disables all raw data topics and storage. Enabling raw data requires a consent token issued through the `/v1/data/consent` endpoint, which records the user's informed consent including a plain-language description of what data will be stored and for how long.

2. **Decoder model integrity.** A compromised decoder model could misinterpret or fabricate neural intents. All decoder models are cryptographically signed. The service verifies model signatures against Hanzo's public key before loading. Custom models require explicit trust configuration.

3. **Closed-loop stimulation safety.** Incorrect stimulation parameters can cause tissue damage or seizures. The stimulation subsystem enforces hardware-level charge density limits (30 uC/cm^2 per phase) and requires a clinical approval flag that can only be set by an authenticated clinician role. The stimulation path includes a hardware watchdog that cuts power if software fails to send a heartbeat within 100 ms.

4. **Side-channel attacks.** Neural data processed on shared GPU infrastructure could theoretically leak information through GPU memory side channels. For high-security deployments, the BCI service supports dedicated GPU isolation via NVIDIA MIG (Multi-Instance GPU) partitioning.

## Test Vectors

### Motor Imagery Decoding

```yaml
Input:
  device: simulated_eeg_64ch
  sample_rate: 1024
  paradigm: motor_imagery_4class
  trial_duration_s: 4
  classes: [left_hand, right_hand, feet, tongue]

Expected:
  accuracy: >= 0.85 (4-class)
  inference_latency_ms: < 50
  false_positive_rate: < 0.05
  calibration_trials: 40 (10 per class)
```

### Speech Decoding

```yaml
Input:
  device: simulated_ecog_128ch
  sample_rate: 2048
  paradigm: overt_speech
  vocabulary: 50_word_set

Expected:
  word_error_rate: <= 0.15
  inference_latency_ms: < 200
  words_per_minute: >= 30
```

### Closed-Loop Latency

```yaml
Input:
  device: simulated_ecog_64ch
  paradigm: seizure_detection
  loop_type: closed_loop

Expected:
  sense_to_stimulate_ms: < 10
  detection_sensitivity: >= 0.95
  detection_specificity: >= 0.90
  false_stimulation_rate: < 0.01 per hour
```

## Reference Implementation

The reference implementation is at [github.com/hanzoai/bci](https://github.com/hanzoai/bci). It is structured as:

```
bci/
├── cmd/
│   └── hanzo-bci/          # Binary entrypoint
│       └── main.py
├── hanzo_bci/
│   ├── hal/                # Hardware Abstraction Layer
│   │   ├── device.py       # BCIDevice protocol
│   │   ├── lsl_driver.py   # LSL inlet adapter
│   │   ├── bci2000.py      # BCI2000 operator adapter
│   │   ├── bluetooth.py    # Consumer device Bluetooth drivers
│   │   └── simulator.py    # Simulated device for testing
│   ├── preprocess/         # Signal preprocessing
│   │   ├── pipeline.py     # Preprocessing pipeline orchestrator
│   │   ├── filters.py      # Notch, bandpass, CAR
│   │   ├── artifacts.py    # Artifact detection and rejection
│   │   └── ica.py          # ICA for EOG correction
│   ├── features/           # Feature extraction
│   │   ├── csp.py          # Common Spatial Patterns
│   │   ├── spectral.py     # FFT, multi-taper, band power
│   │   ├── spikes.py       # Spike detection and binning
│   │   └── highgamma.py    # High-gamma analytic amplitude
│   ├── decoders/           # AI decoder models
│   │   ├── eegnet.py       # EEGNet for motor imagery
│   │   ├── transformer.py  # Transformer for speech
│   │   ├── kalman.py       # Kalman filter for cursor control
│   │   └── adaptive.py     # Online adaptation wrapper
│   ├── closedloop/         # Closed-loop subsystem
│   │   ├── controller.py   # Real-time control loop
│   │   ├── policy.py       # Stimulation decision policy
│   │   └── safety.py       # Hardware safety limits
│   ├── api/                # REST and WebSocket endpoints
│   │   ├── routes.py       # FastAPI route definitions
│   │   └── ws.py           # WebSocket handlers
│   ├── privacy/            # Neural data governance
│   │   ├── consent.py      # Consent token management
│   │   ├── audit.py        # Immutable audit log
│   │   └── encryption.py   # AES-256-GCM per-user encryption
│   └── storage/            # BIDS-compliant data storage
│       ├── bids.py         # BIDS format writer
│       └── nwb.py          # NWB format for intracortical data
├── models/                 # Pre-trained decoder weights (ONNX)
│   ├── eegnet-4class-v3.onnx
│   ├── transformer-speech-v2.onnx
│   └── seizure-detector-v1.onnx
├── tests/
│   ├── test_hal.py
│   ├── test_preprocess.py
│   ├── test_decoders.py
│   ├── test_closedloop.py
│   └── test_privacy.py
├── pyproject.toml
├── Dockerfile
├── compose.yml
└── hanzo-bci.yaml          # Default configuration
```

## Future Extensions

1. **Federated decoder training.** Train decoder models across multiple users without sharing raw neural data, using federated learning techniques. This addresses both the privacy constraint (neural data never leaves the device) and the personalization challenge (each user's brain is different).

2. **Neural-to-text foundation model.** A large pre-trained transformer that maps arbitrary neural signals to text, analogous to how speech-to-text models generalize across speakers. Requires a large multi-subject neural dataset, likely achievable with ECoG data from epilepsy monitoring cohorts (with consent).

3. **Bi-directional neural interfaces.** Extend beyond decoding to encoding: translate AI-generated content into neural stimulation patterns that convey information directly to the brain. This is the "write" side of the brain-computer interface, currently in early research for visual and somatosensory prosthetics.

4. **Neural authentication.** Use brain-specific signal patterns (brainprints) as a biometric authentication factor. Unlike fingerprints, brainprints are difficult to steal or replicate and can be changed by the user (by thinking different thoughts during enrollment).

5. **Multi-brain collaboration.** Enable multiple BCI users to share a control space, pooling neural intent for collaborative tasks. This has applications in shared cursor control, collaborative decision-making, and brain-to-brain communication.

## References

1. Lawhern, V.J., et al. "EEGNet: a compact convolutional neural network for EEG-based brain-computer interfaces." *Journal of Neural Engineering*, 15(5), 2018.
2. Willett, F.R., et al. "A high-performance speech neuroprosthesis." *Nature*, 620, 1031-1036, 2023.
3. Moses, D.A., et al. "Neuroprosthesis for decoding speech in a paralyzed person with anarthria." *New England Journal of Medicine*, 385, 217-227, 2021.
4. Takagi, Y., & Nishimoto, S. "High-resolution image reconstruction with latent diffusion models from human brain activity." *CVPR*, 2023.
5. Schalk, G., et al. "BCI2000: A general-purpose brain-computer interface system." *IEEE Transactions on Biomedical Engineering*, 51(6), 1034-1043, 2004.
6. Kothe, C., & Makeig, S. "Lab Streaming Layer." https://labstreaminglayer.org/
7. Gorgolewski, K.J., et al. "The brain imaging data structure." *Scientific Data*, 3, 160044, 2016.
8. Ienca, M., & Andorno, R. "Towards new human rights in the age of neuroscience and neurotechnology." *Life Sciences, Society and Policy*, 13(1), 5, 2017.
9. Hochberg, L.R., et al. "Reach and grasp by people with tetraplegia using a neurally controlled robotic arm." *Nature*, 485, 372-375, 2012.
10. Musk, E., & Neuralink. "An integrated brain-machine interface platform with thousands of channels." *Journal of Medical Internet Research*, 21(10), e16194, 2019.

## Copyright

Copyright 2026 Hanzo AI Inc. All rights reserved. This document is licensed under the Hanzo Improvement Proposal License.
