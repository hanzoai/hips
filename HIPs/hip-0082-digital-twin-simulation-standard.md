---
hip: 0082
title: Digital Twin & Simulation Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
---

# HIP-82: Digital Twin & Simulation Standard

## Abstract

This proposal defines the Digital Twin standard for the Hanzo ecosystem. Hanzo Twin is a platform for creating, running, and synchronizing digital replicas of physical systems -- robots, warehouses, data centers, IoT sensor networks, and Hanzo's own cloud infrastructure. It provides a unified API over multiple physics simulation engines (NVIDIA PhysX/Omniverse, MuJoCo, Gazebo, PyBullet), a real-time synchronization protocol between physical assets and their digital counterparts, and a synthetic data generation pipeline for training vision and reinforcement learning models.

The core insight is that digital twins are not merely visualization tools. They are *training environments* for AI agents. A robot that will operate in a warehouse should first train in a simulated warehouse. An infrastructure change that will be deployed to Hanzo Cloud should first be tested against a simulated cluster. A reinforcement learning policy that will control a physical system should first converge in a simulated system where failures cost nothing. The digital twin platform makes simulation a first-class primitive in the Hanzo AI stack.

The system uses Universal Scene Description (USD) as its scene interchange format, integrates with the Robotics standard (HIP-0080) for robot simulation and testing, the ML Pipeline (HIP-0057) for reinforcement learning training loops, and the Timeseries Database (HIP-0059) for historical replay and what-if scenario analysis.

**Repository**: [github.com/hanzoai/twin](https://github.com/hanzoai/twin)
**Port**: 8082 (API)
**Binary**: `hanzo-twin`
**Container**: `hanzoai/twin:latest`

## Motivation

AI systems increasingly interact with the physical world. Hanzo serves customers building autonomous robots, managing IoT sensor networks, operating warehouse logistics, and running large-scale cloud infrastructure. Each of these domains shares a common problem: testing AI agents in the real world is expensive, slow, and dangerous.

1. **Physical testing destroys hardware.** A reinforcement learning agent exploring a manipulation policy will drop objects, collide with obstacles, and stress actuators beyond their limits. Each failure in the real world costs time (resetting the environment), money (replacing parts), and safety risk (to nearby humans). In simulation, a robot can crash ten thousand times per hour at zero cost. The agent learns from failures that would be catastrophic in reality. Without a simulation platform, teams either test slowly and conservatively (undertrained agents) or test aggressively and break hardware (expensive and dangerous).

2. **Real-world data collection does not scale.** Training a vision model to detect defects on a manufacturing line requires thousands of labeled images of defective parts. Collecting these images from a real line means waiting for defects to occur naturally -- which might be one per thousand units. Synthetic data generation in simulation can produce millions of labeled images with controllable defect types, lighting conditions, camera angles, and occlusion patterns. Teams that lack simulation resort to small datasets, aggressive augmentation, and models that fail on distribution shifts they never trained on.

3. **Infrastructure changes are tested in production.** When Hanzo deploys a new Kubernetes scheduler policy, a database migration, or a network topology change, the first real test happens on live infrastructure. Canary deployments mitigate blast radius, but they cannot predict emergent behaviors: cascading failures, resource contention under load, or interactions between services that were never tested together. An infrastructure digital twin can replay production traffic patterns against a simulated cluster, exposing failures before they reach real users.

4. **IoT sensor networks are opaque.** A building with 500 temperature, humidity, and occupancy sensors produces a data stream that is difficult to reason about without spatial context. Which sensor readings are anomalous? How does airflow from the HVAC system propagate through rooms? What happens if sensor #247 fails -- which downstream decisions are affected? A digital twin of the building, synchronized with live sensor data, provides spatial reasoning that flat timeseries cannot.

5. **Sim-to-real transfer is a research bottleneck.** Even teams that use simulation struggle with the gap between simulated and real physics. A policy trained in PyBullet behaves differently when deployed on a real robot because PyBullet's contact dynamics, friction models, and actuator response differ from reality. The platform must support domain randomization (varying simulation parameters to produce robust policies), multiple physics engines (to cross-validate behaviors), and systematic calibration against real-world measurements.

6. **No unified simulation API exists.** Teams building with MuJoCo use MuJoCo's API. Teams using Gazebo use the Gazebo API. Teams using Omniverse use Omniverse's API. Each engine has different scene formats, different physics parameters, different rendering pipelines, and different performance characteristics. When a team wants to compare how their robot controller behaves across engines -- a basic validation practice -- they must port their entire scene and control code. The platform must abstract over engines while preserving access to engine-specific features when fidelity demands it.

## Design Philosophy

### Why Digital Twins for AI

A digital twin is a live, synchronized replica of a physical system. This is distinct from a static simulation. The twin receives real-time data from its physical counterpart (sensor readings, actuator states, operational parameters) and maintains a model that tracks the physical system's current state. This live synchronization enables three capabilities that static simulations cannot provide:

**Predictive maintenance.** The twin runs faster than real time, projecting the physical system's state forward. If the projection shows a bearing temperature exceeding threshold in 72 hours, maintenance can be scheduled before failure occurs. Static simulations can model failure modes, but they cannot predict *when* a specific physical system will fail because they lack the current state.

**Safe exploration.** An AI agent can "fork" the twin -- take a snapshot of the current state and explore hypothetical actions. "What happens if I increase conveyor speed by 20%?" The twin simulates the consequence without affecting the physical system. If the simulation shows a jam, the agent discards that action. This is model-predictive control at the digital twin level.

**Continuous learning.** The twin accumulates a history of physical states and the corresponding simulation predictions. Discrepancies between prediction and reality are training signals. The twin's physics parameters are continuously calibrated against real-world observations, reducing the sim-to-real gap over time. This is not a one-time calibration -- it is a feedback loop that improves the twin's fidelity throughout the physical system's lifetime.

### Why Multi-Engine Architecture

No single physics engine is best for all use cases. The platform supports four engines, each with a distinct niche:

| Engine | Strength | Weakness | Best For |
|--------|----------|----------|----------|
| **NVIDIA PhysX/Omniverse** | GPU-accelerated rigid body, ray tracing | Expensive licensing, NVIDIA hardware required | High-fidelity visual simulation, synthetic data generation |
| **MuJoCo** | Fast contact dynamics, stable at high step rates | Limited visual fidelity | Reinforcement learning, robot locomotion, dexterous manipulation |
| **Gazebo** | ROS integration, sensor simulation | Slower than MuJoCo for RL workloads | ROS-based robot testing, multi-robot coordination |
| **PyBullet** | Pure Python, zero setup, free | Lower fidelity, single-threaded | Prototyping, education, quick experiments |

The platform does not hide these differences behind a lowest-common-denominator API. Instead, it provides a common scene description (USD), a common control interface (joint commands, sensor queries), and a common data output format (observations, rewards, images). Engine-specific features (Omniverse's ray-traced rendering, MuJoCo's tendon model, Gazebo's ROS bridges) are accessible through engine-specific extensions.

The practical benefit: a team develops a robot controller in PyBullet (fast iteration, no GPU needed), validates it in MuJoCo (more accurate contact physics), generates synthetic training data in Omniverse (photorealistic rendering), and tests the full ROS stack in Gazebo (sensor simulation + ROS integration). The same USD scene file works across all four engines. The same control code works across all four engines. Only the engine configuration changes.

### Why USD as Interchange Format

Universal Scene Description (USD), developed by Pixar and adopted by NVIDIA, Apple, and the broader 3D industry, is the scene interchange format for digital twins. The alternatives -- URDF (robot-specific, no material system), SDF (Gazebo-specific), MJCF (MuJoCo-specific), glTF (rendering-focused, no physics) -- are each tied to a single domain.

USD provides:

- **Hierarchical composition.** A warehouse twin is composed from shelf USD files, robot USD files, conveyor USD files, and lighting USD files. Each component is authored independently and composed via references. Updating a shelf model propagates to every warehouse scene that references it.
- **Physics schema.** USD Physics (PhysicsSchema) defines rigid bodies, joints, collision geometry, and materials in a standard way. Both Omniverse and the platform's engine adapters read physics properties directly from USD.
- **Material system.** USD's MaterialX and MDL material support enables photorealistic rendering for synthetic data generation. A material authored once renders correctly in Omniverse, Blender, and any USD-compatible renderer.
- **Time-varying data.** USD natively supports animated attributes (time samples), which is exactly what a digital twin produces: a time-varying scene state. Replaying a twin session is replaying a USD stage with time samples.

The tradeoff is complexity. USD is a large specification with a steep learning curve. But the platform abstracts over USD's complexity through its API -- users create twins via YAML configuration and interact via REST/gRPC, not by writing USD directly. USD is the internal representation, like how a database engine uses B-trees internally without exposing them to SQL users.

### Why Cloud-Hosted Simulation

Physics simulation is GPU-intensive. A single Omniverse instance rendering photorealistic synthetic data requires an A100 or H100 GPU. Running 1,000 parallel MuJoCo environments for reinforcement learning requires dozens of CPU cores. Most teams cannot justify dedicated simulation hardware that sits idle between training runs.

Cloud-hosted simulation solves this through GPU time-sharing:

- **Burst capacity.** A team that needs 1,000 parallel environments for 4 hours of RL training should not maintain hardware for 1,000 environments 24/7. The platform schedules simulation workloads on shared GPU clusters, the same clusters used for model training (HIP-0057). Simulation jobs compete for GPU time using the same fair-share scheduler.
- **Render farm.** Synthetic data generation (producing millions of labeled images) is a batch workload. The platform queues render jobs and distributes them across available GPUs, exactly like a visual effects render farm. A team submits a scene and a camera configuration; the platform returns a dataset.
- **Shared twin instances.** An infrastructure digital twin of Hanzo Cloud runs continuously, maintained by the platform team. Any engineer can query its state, fork it for what-if analysis, or inject failure scenarios. This shared twin does not require each engineer to run their own simulation instance.

## Specification

### Architecture Overview

```
                    +--------------------------------------------------+
                    |           Hanzo Twin API (8082)                   |
                    |                                                    |
                    |  +----------+ +----------+ +-----------+         |
                    |  |  Scene   | |  Sync    | | Synthetic |         |
                    |  | Manager  | | Engine   | |  Data Gen |         |
                    |  +----+-----+ +----+-----+ +-----+-----+         |
                    |       |            |              |               |
                    |  +----+------------+----+---------+----------+    |
                    |  |            Engine Abstraction Layer        |    |
                    |  +----+-------+--------+--------+-----------+    |
                    +-------|-------|--------|--------|------------------+
                            |       |        |        |
                    +-------+--+ +--+------+ +--+---+ +---+--------+
                    | Omniverse| | MuJoCo  | |Gazebo| |  PyBullet  |
                    | (PhysX)  | |         | |      | |            |
                    | [GPU]    | | [CPU]   | |[CPU] | |  [CPU]     |
                    +----------+ +---------+ +------+ +------------+
                            |       |        |        |
                    +-------+-------+--------+--------+------------+
                    |         Hanzo Object Storage (9000)           |
                    |    USD scenes / datasets / checkpoints        |
                    +----------------------------------------------+
```

**Hanzo Twin API** (port 8082) is the control plane. It manages twin definitions, schedules simulation workloads, coordinates real-time synchronization, and orchestrates synthetic data generation. It is a stateless Go service backed by PostgreSQL for metadata and Object Storage for scene files and generated datasets.

**Scene Manager** handles USD scene composition, validation, and versioning. Scenes are stored in Object Storage and referenced by twin definitions.

**Sync Engine** maintains real-time connections between physical assets (via IoT protocols: MQTT, OPC-UA, ROS topics) and their simulated counterparts. It receives sensor data from physical systems, updates the twin's state, and publishes simulation predictions back.

**Synthetic Data Generator** orchestrates GPU-accelerated rendering to produce labeled image datasets. It schedules render jobs on the shared GPU cluster and outputs datasets compatible with the ML Pipeline (HIP-0057).

**Engine Abstraction Layer** translates the platform's common API into engine-specific calls. Each engine adapter loads USD scenes, steps the simulation, reads sensor observations, and writes actuator commands using the engine's native API.

### Twin Definition Schema

A digital twin is defined declaratively as a YAML configuration that links a physical system to a simulation scene, an engine, and a synchronization policy.

```yaml
Twin Schema:
  id: string                        # UUID
  name: string                      # Human-readable name (e.g., "warehouse-east")
  organization: string              # Owning organization in Hanzo IAM
  created_at: timestamp
  updated_at: timestamp

  scene:
    uri: string                     # USD scene file in Object Storage
                                    # s3://hanzo-twin/scenes/warehouse-east/v3/root.usda
    version: integer                # Scene version (immutable per version)
    composition:                    # Component references
      - ref: "s3://hanzo-twin/assets/robot-arm-v2.usda"
        path: "/World/Robot_01"
      - ref: "s3://hanzo-twin/assets/conveyor-belt.usda"
        path: "/World/Conveyor_01"

  engine:
    type: enum                      # omniverse | mujoco | gazebo | pybullet
    config:                         # Engine-specific configuration
      step_hz: 240                  # Physics steps per second
      substeps: 4                   # Substeps per step (for stability)
      gravity: [0.0, 0.0, -9.81]
      solver_iterations: 50
      gpu_id: auto                  # GPU selection (for Omniverse)

  sync:
    mode: enum                      # realtime | batch | replay | standalone
    sources:                        # Physical data sources
      - type: mqtt
        broker: "mqtt://iot.hanzo.svc:1883"
        topic: "warehouse/east/sensors/#"
        mapping:                    # Sensor -> USD attribute mapping
          "sensor/temp_01": "/World/TempSensor_01.temperature"
          "sensor/cam_01":  "/World/Camera_01.rgb"
      - type: ros2
        topics:
          "/robot/joint_states": "/World/Robot_01/joints"
          "/robot/ee_pose":     "/World/Robot_01/end_effector.xformOp:translate"
    publish:                        # Predictions published back
      - type: mqtt
        topic: "warehouse/east/twin/predictions"
      - type: kafka
        topic: "hanzo.twin.warehouse-east"
    rate_hz: 30                     # Synchronization frequency

  domain_randomization:             # For sim-to-real transfer training
    enabled: boolean
    parameters:
      friction: { min: 0.3, max: 0.9 }
      mass_scale: { min: 0.8, max: 1.2 }
      lighting_intensity: { min: 0.5, max: 2.0 }
      camera_noise_stddev: { min: 0.0, max: 0.05 }
      actuator_delay_ms: { min: 0, max: 20 }
      gravity_perturbation: { max_angle_deg: 2.0 }

  metadata: object                  # Arbitrary key-value pairs
  tags: string[]                    # Searchable tags
```

### Engine Abstraction Layer

The abstraction layer defines a common interface that each engine adapter implements. The interface is deliberately minimal -- it covers the operations that every physics engine supports, without papering over differences that matter.

```go
// Engine is the interface that all physics engine adapters implement.
type Engine interface {
    // LoadScene loads a USD scene file and returns a simulation handle.
    LoadScene(ctx context.Context, usdPath string, config EngineConfig) (Simulation, error)

    // Capabilities returns what this engine supports.
    Capabilities() EngineCapabilities
}

// Simulation represents a loaded, running simulation instance.
type Simulation interface {
    // Step advances the simulation by one timestep.
    Step(ctx context.Context) error

    // SetJointCommand sends joint-level commands to an articulation.
    SetJointCommand(articulationPath string, cmd JointCommand) error

    // GetObservation reads sensor data from the simulation.
    GetObservation(sensorPath string) (Observation, error)

    // GetState returns the full simulation state (for checkpointing).
    GetState() (SimState, error)

    // SetState restores simulation state from a checkpoint.
    SetState(state SimState) error

    // Render produces an image from a camera sensor.
    Render(cameraPath string, params RenderParams) (Image, error)

    // Fork creates an independent copy of the simulation at its current state.
    Fork() (Simulation, error)

    // Close releases all resources.
    Close() error
}

// EngineCapabilities declares what features an engine supports.
type EngineCapabilities struct {
    RayTracing       bool    // GPU ray tracing (Omniverse only)
    SoftBody         bool    // Deformable body simulation
    Fluid            bool    // Fluid/particle simulation
    MaxStepHz        int     // Maximum stable step rate
    GPURequired      bool    // Whether a GPU is mandatory
    ROSBridge        bool    // Native ROS integration (Gazebo)
    ParallelEnvs     int     // Max parallel environments per instance
}
```

**Why `Fork`?** Forking is the mechanism for safe exploration. An AI agent considering multiple actions can fork the twin, try each action in a separate fork, observe the outcomes, and choose the best one -- all without affecting the canonical twin state. Forking is implemented via state serialization (`GetState` / `SetState`), not OS-level process forking. MuJoCo supports this natively via `mj_copyData`. For other engines, it is implemented by checkpointing to memory.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| **Twins** | | |
| `/v1/twins` | GET | List twins (filtered by org, tags, engine) |
| `/v1/twins` | POST | Create a new twin definition |
| `/v1/twins/{id}` | GET | Get twin metadata and status |
| `/v1/twins/{id}` | PATCH | Update twin configuration |
| `/v1/twins/{id}` | DELETE | Delete twin and associated resources |
| `/v1/twins/{id}/start` | POST | Start simulation (allocate engine, begin sync) |
| `/v1/twins/{id}/stop` | POST | Stop simulation (release resources) |
| `/v1/twins/{id}/state` | GET | Get current simulation state |
| `/v1/twins/{id}/fork` | POST | Fork current state into a new ephemeral twin |
| **Scenes** | | |
| `/v1/scenes` | GET | List USD scenes |
| `/v1/scenes` | POST | Upload a new scene version |
| `/v1/scenes/{id}` | GET | Get scene metadata |
| `/v1/scenes/{id}/validate` | POST | Validate USD scene against engine compatibility |
| `/v1/scenes/{id}/download` | GET | Pre-signed download URL |
| **Simulation Jobs** | | |
| `/v1/jobs` | POST | Submit a batch simulation job (RL training, chaos test) |
| `/v1/jobs/{id}` | GET | Get job status and results |
| `/v1/jobs/{id}/cancel` | POST | Cancel a running job |
| `/v1/jobs/{id}/logs` | GET | Stream job logs (SSE) |
| **Synthetic Data** | | |
| `/v1/synthdata` | POST | Submit a synthetic data generation job |
| `/v1/synthdata/{id}` | GET | Get generation job status |
| `/v1/synthdata/{id}/dataset` | GET | Download generated dataset |
| **Sync** | | |
| `/v1/twins/{id}/sync/status` | GET | Synchronization health and latency |
| `/v1/twins/{id}/sync/history` | GET | Recent sync events |
| **Infrastructure Twins** | | |
| `/v1/infra/twins` | GET | List infrastructure digital twins |
| `/v1/infra/twins/{id}/inject` | POST | Inject a failure scenario (chaos engineering) |
| `/v1/infra/twins/{id}/replay` | POST | Replay historical traffic against twin |
| **Gym (RL Interface)** | | |
| `/v1/gym/envs` | POST | Create a Gymnasium-compatible environment |
| `/v1/gym/envs/{id}/reset` | POST | Reset environment, return initial observation |
| `/v1/gym/envs/{id}/step` | POST | Take action, return observation + reward + done |

### Reinforcement Learning Integration

The platform exposes a Gymnasium-compatible (formerly OpenAI Gym) interface for reinforcement learning training. This means any RL library that works with Gymnasium -- Stable Baselines3, CleanRL, RLlib -- works with Hanzo Twin without modification.

```python
import gymnasium as gym
import hanzo_twin

# Register Hanzo Twin environment
env = hanzo_twin.make(
    twin_id="twin-warehouse-east",
    engine="mujoco",
    obs_type="dict",        # Joint positions + camera images
    action_type="joint",    # Joint-level torque commands
    step_hz=60,
    domain_randomization=True,
)

# Standard Gymnasium loop
obs, info = env.reset()
for step in range(100_000):
    action = agent.predict(obs)
    obs, reward, terminated, truncated, info = env.step(action)
    if terminated or truncated:
        obs, info = env.reset()

# Parallel environments for vectorized RL
envs = hanzo_twin.make_vec(
    twin_id="twin-warehouse-east",
    engine="mujoco",
    num_envs=64,           # 64 parallel simulations
    num_envs_per_worker=8, # 8 envs per CPU core
)
```

**Why Gymnasium and not a custom API?** Gymnasium is the standard interface for RL environments. Every RL paper published since 2016 uses it. Every RL library supports it. Defining a custom environment API would force RL researchers to write adapter code, which is friction that prevents adoption. By implementing Gymnasium's `reset()` / `step()` / `render()` contract, the platform is immediately usable with the entire RL ecosystem.

**Vectorized environments.** RL algorithms like PPO require hundreds to thousands of parallel environments to collect enough experience per training iteration. The platform runs multiple simulation instances across CPU cores (MuJoCo, PyBullet) or GPU streams (PhysX) and presents them as a single vectorized environment. This integrates with the ML Pipeline (HIP-0057) -- the vectorized environment runs as part of a training job on the GPU cluster.

### Synthetic Data Generation

The synthetic data pipeline produces labeled image datasets for training vision models. It leverages Omniverse's ray-traced rendering for photorealistic output and the scene's USD structure for automatic label generation.

```yaml
Synthetic Data Job Configuration:
  twin_id: "twin-warehouse-east"
  engine: omniverse                  # Ray tracing required
  output_dataset: "warehouse-defect-detection-v4"

  cameras:
    - path: "/World/Camera_Overhead"
      resolution: [1920, 1080]
      fov_deg: 60
    - path: "/World/Camera_Side"
      resolution: [1280, 720]
      fov_deg: 45

  labels:                            # What to annotate
    - bounding_box_2d                # 2D object detection
    - semantic_segmentation          # Per-pixel class labels
    - instance_segmentation          # Per-pixel instance IDs
    - depth                          # Depth map
    - surface_normal                 # Normal map
    - occlusion                      # Visibility percentage

  randomization:                     # Per-frame randomization
    object_placement:
      strategy: random_within_zone
      zone: "/World/ConveyorZone"
      count: { min: 5, max: 20 }
    materials:
      vary_roughness: { min: 0.1, max: 0.9 }
      vary_color_hue: { max_shift_deg: 15 }
    lighting:
      vary_intensity: { min: 0.3, max: 3.0 }
      vary_color_temperature: { min: 3000, max: 7000 }
      random_spot_lights: { count: 3 }
    camera:
      jitter_position_cm: 5.0
      jitter_rotation_deg: 3.0

  num_frames: 100_000
  frames_per_gpu: 500              # Batch size per GPU
  output_format: coco               # COCO JSON + images

  quality:
    samples_per_pixel: 256          # Ray tracing quality
    denoiser: optix                 # NVIDIA OptiX denoiser
```

The output is a versioned dataset in Object Storage, formatted for direct consumption by the ML Pipeline (HIP-0057). A synthetic data job that produces 100,000 frames at 1920x1080 with full annotations takes approximately 2 hours on 8 A100 GPUs.

### Infrastructure Digital Twins

A special class of twin simulates Hanzo's own cloud infrastructure. Rather than physics, it simulates service interactions, network topology, resource contention, and failure cascades.

```yaml
Infrastructure Twin Schema:
  name: "hanzo-cloud-twin"
  type: infrastructure

  topology:
    source: kubernetes               # Discover from live cluster
    cluster: "hanzo-k8s"
    namespaces: ["hanzo", "hanzo-ml"]
    include_network_policies: true
    include_resource_quotas: true

  traffic:
    source: timeseries               # Replay from HIP-0059
    query: |
      SELECT bucket, metric, service, avg_value
      FROM metrics_1m
      WHERE metric LIKE 'hanzo_requests_%'
        AND bucket > NOW() - INTERVAL '7 days'

  failure_injection:                 # Chaos engineering scenarios
    scenarios:
      - name: "pod-kill"
        target: "deployment/llm-gateway"
        action: kill_pod
        count: 1
      - name: "network-partition"
        target: "service/postgres"
        action: block_traffic
        duration: "30s"
      - name: "cpu-stress"
        target: "deployment/hanzo-ml"
        action: stress_cpu
        load_percent: 95
        duration: "5m"
      - name: "disk-full"
        target: "statefulset/metrics-db"
        action: fill_disk
        percent: 98

  assertions:                        # Expected behaviors
    - "llm-gateway responds within 5s during pod-kill"
    - "postgres failover completes within 30s"
    - "no data loss during network partition"
```

Infrastructure twins integrate with the Timeseries Database (HIP-0059) in two ways:

1. **Historical replay.** The twin replays real traffic patterns recorded in TimescaleDB against the simulated infrastructure. This tests whether a proposed change (new scheduler policy, resource limit adjustment, service mesh configuration) would have caused failures under last week's production load.

2. **What-if scenarios.** Engineers modify the twin's topology (add a service, change resource limits, introduce a network policy) and replay traffic to observe the effect. The results are written back to TimescaleDB as a tagged experiment, enabling comparison across what-if variants.

### Real-Time Synchronization Protocol

The sync engine maintains a bidirectional data flow between physical assets and their digital twins.

```
Physical System                    Hanzo Twin
    |                                  |
    |--- sensor data (MQTT/ROS) ------>|
    |                                  |-- update USD attributes
    |                                  |-- step simulation
    |                                  |-- compute predictions
    |<-- predictions (MQTT/Kafka) -----|
    |                                  |
    |--- sensor data ----------------->|
    |                                  |-- detect drift
    |                                  |   (prediction vs. reality)
    |                                  |-- recalibrate parameters
    |                                  |
```

**Drift detection.** The sync engine continuously compares its predictions (what the simulation expected) against incoming sensor data (what actually happened). When the discrepancy exceeds a configurable threshold, it triggers one of three responses:

1. **Auto-recalibrate.** Adjust simulation parameters (friction, mass, damping) to minimize prediction error. This uses a simple gradient-free optimizer (Nelder-Mead) over the last N seconds of prediction-reality pairs.
2. **Alert.** Publish a drift alert to Hanzo Stream (HIP-0030) for human review. This is appropriate when drift might indicate a physical change (worn bearing, loose bolt) rather than a simulation inaccuracy.
3. **Hard reset.** Overwrite the simulation state with the latest sensor readings. This is the fallback when drift has accumulated beyond what recalibration can correct.

```yaml
Sync Configuration:
  drift_detection:
    enabled: true
    window_seconds: 10
    threshold:
      position_m: 0.05          # 5cm position error triggers action
      velocity_mps: 0.1         # 10cm/s velocity error
      temperature_c: 2.0        # 2 degree temperature error
    response: auto_recalibrate  # auto_recalibrate | alert | hard_reset

  latency_budget_ms: 50         # Max sync loop latency
  buffer_size: 100              # Incoming message buffer
  reconnect_backoff_ms: [100, 500, 2000, 10000]
```

### Integration with Robotics (HIP-0080)

The Robotics standard (HIP-0080) defines robot models, control interfaces, and deployment workflows. Digital twins provide the simulation layer that HIP-0080's robots train and test in.

```
HIP-0080 (Robotics)                    HIP-0082 (Twin)
    |                                       |
    |-- robot URDF/USD model ------------>  |-- load into simulation
    |                                       |
    |-- control policy ------------------>  |-- execute in sim
    |                                       |-- return observations
    |                                       |
    |<-- trained policy ---  HIP-0057 <--  |-- RL training loop
    |                       (ML Pipeline)   |-- (vectorized envs)
    |                                       |
    |-- deploy to hardware                  |-- continue as live twin
    |-- stream sensor data ------------>    |-- real-time monitoring
```

Robot models authored in URDF (the ROS standard) are automatically converted to USD for simulation. The conversion preserves joint types, inertial properties, collision geometry, and visual meshes. A robot defined once in HIP-0080's robot registry can be instantiated in any twin scene without manual conversion.

### Configuration

```yaml
# /etc/hanzo-twin/config.yaml

server:
  host: 0.0.0.0
  port: 8082
  workers: 4

database:
  url: "postgresql://hanzo:password@postgres:5432/hanzo_twin"

storage:
  endpoint: "http://minio:9000"
  access_key: "${HANZO_STORAGE_ACCESS_KEY}"
  secret_key: "${HANZO_STORAGE_SECRET_KEY}"
  buckets:
    scenes: "hanzo-twin-scenes"
    datasets: "hanzo-twin-datasets"
    checkpoints: "hanzo-twin-checkpoints"

stream:
  brokers: "kafka:9092"
  topic_prefix: "hanzo.twin"

auth:
  iam_url: "https://hanzo.id"
  verify_tokens: true

engines:
  mujoco:
    enabled: true
    binary: "/usr/local/bin/mujoco"
    max_instances: 32
  pybullet:
    enabled: true
    max_instances: 64
  omniverse:
    enabled: false              # Requires NVIDIA GPU + license
    nucleus_url: "omniverse://nucleus.hanzo.svc"
    gpu_ids: [0, 1]
  gazebo:
    enabled: true
    ros_distro: "humble"
    max_instances: 8

scheduler:
  namespace: "hanzo-twin"
  gpu_types: ["nvidia-a100-80gb", "nvidia-h100-80gb"]
  max_concurrent_jobs: 16

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
# Create a twin from a YAML definition
hanzo-twin create --config warehouse-east.yaml

# Start a twin (allocate engine, begin simulation)
hanzo-twin start twin-warehouse-east

# Check twin status and sync health
hanzo-twin status twin-warehouse-east

# Fork a twin for what-if analysis
hanzo-twin fork twin-warehouse-east --name "what-if-faster-conveyor"

# Inject a failure into an infrastructure twin
hanzo-twin chaos inject twin-hanzo-cloud --scenario pod-kill \
  --target deployment/llm-gateway

# Submit a synthetic data generation job
hanzo-twin synthdata generate --config synthdata-config.yaml

# Submit an RL training job (integrates with HIP-0057)
hanzo-twin train --twin twin-warehouse-east --engine mujoco \
  --algo ppo --num-envs 64 --total-steps 10_000_000

# Replay historical data through an infrastructure twin
hanzo-twin replay twin-hanzo-cloud \
  --from "2026-02-20T00:00:00Z" --to "2026-02-21T00:00:00Z"

# Upload a USD scene
hanzo-twin scene upload --name "warehouse-east" --path ./scenes/warehouse/

# Validate a scene against an engine
hanzo-twin scene validate --name "warehouse-east" --engine mujoco
```

### Deployment

#### Docker (Development)

```yaml
# compose.yml
services:
  twin-api:
    image: hanzoai/twin:latest
    ports:
      - "8082:8082"
      - "9090:9090"
    environment:
      HANZO_TWIN_DATABASE_URL: "postgresql://hanzo:${DB_PASSWORD}@postgres:5432/hanzo_twin"
      HANZO_TWIN_STORAGE_ENDPOINT: "http://minio:9000"
      HANZO_TWIN_STREAM_BROKERS: "kafka:9092"
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - /tmp/mujoco_cache:/root/.mujoco

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: hanzo_twin
      POSTGRES_USER: hanzo
      POSTGRES_PASSWORD: "${DB_PASSWORD}"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hanzo -d hanzo_twin"]
      interval: 10s
```

#### Kubernetes (Production)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hanzo-twin
  namespace: hanzo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: hanzo-twin
  template:
    metadata:
      labels:
        app: hanzo-twin
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: hanzo-twin
      containers:
        - name: hanzo-twin
          image: hanzoai/twin:latest
          ports:
            - containerPort: 8082
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: HANZO_TWIN_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: hanzo-twin-secrets
                  key: database-url
          readinessProbe:
            httpGet:
              path: /ready
              port: 8082
          livenessProbe:
            httpGet:
              path: /alive
              port: 8082
          resources:
            requests:
              memory: 4Gi
              cpu: "4"
            limits:
              memory: 8Gi
              cpu: "8"
---
apiVersion: v1
kind: Service
metadata:
  name: hanzo-twin
  namespace: hanzo
spec:
  selector:
    app: hanzo-twin
  ports:
    - name: api
      port: 8082
    - name: metrics
      port: 9090
```

### Health and Metrics

```yaml
Metrics (Prometheus):
  Counters:
    hanzo_twin_simulations_total{engine, org}       # Total simulations started
    hanzo_twin_steps_total{engine, twin}             # Total physics steps executed
    hanzo_twin_synthdata_frames_total{twin}          # Synthetic images generated
    hanzo_twin_sync_messages_total{twin, direction}  # Sync messages (in/out)
    hanzo_twin_chaos_injections_total{scenario}      # Chaos scenarios executed

  Histograms:
    hanzo_twin_step_duration_seconds{engine}         # Per-step simulation latency
    hanzo_twin_sync_latency_seconds{twin}            # Sync loop latency
    hanzo_twin_render_duration_seconds{engine}       # Per-frame render time
    hanzo_twin_api_request_duration_seconds{endpoint} # API latency

  Gauges:
    hanzo_twin_active_simulations{engine}            # Running simulation instances
    hanzo_twin_gpus_allocated{gpu_type}              # GPUs in use for simulation
    hanzo_twin_sync_drift{twin, dimension}           # Current prediction-reality drift
    hanzo_twin_parallel_envs{twin}                   # Active RL environments
```

### Implementation Roadmap

**Phase 1: Core Platform (Q1 2026)**
- Twin definition schema and API
- MuJoCo and PyBullet engine adapters
- USD scene loading and validation
- Gymnasium-compatible RL interface
- CLI and Python client library

**Phase 2: Synchronization (Q2 2026)**
- Real-time sync engine (MQTT, ROS 2)
- Drift detection and auto-recalibration
- Integration with Timeseries Database (HIP-0059)
- IoT sensor twin support

**Phase 3: Synthetic Data and Rendering (Q3 2026)**
- Omniverse engine adapter (GPU ray tracing)
- Synthetic data generation pipeline
- Domain randomization framework
- Integration with ML Pipeline (HIP-0057) for dataset ingestion

**Phase 4: Infrastructure Twins and Chaos (Q4 2026)**
- Infrastructure digital twin from K8s topology discovery
- Historical traffic replay from TimescaleDB
- Chaos engineering failure injection
- What-if scenario comparison and reporting
- Gazebo engine adapter with ROS bridge
- Integration with Robotics (HIP-0080) for URDF-to-USD conversion

## Security Considerations

### Authentication and Authorization

All API endpoints require a valid Hanzo IAM bearer token. Permissions are scoped per organization:

```yaml
RBAC Roles:
  twin-admin:
    - twins: create, read, update, delete, start, stop
    - scenes: upload, read, delete
    - jobs: submit, cancel, read
    - synthdata: generate, read, delete
    - infra: inject_chaos, replay, read

  twin-operator:
    - twins: read, start, stop
    - scenes: read
    - jobs: submit, cancel (own only), read
    - synthdata: generate, read
    - infra: replay, read

  twin-viewer:
    - twins: read
    - scenes: read
    - jobs: read
    - synthdata: read
    - infra: read
```

### Simulation Isolation

Simulation instances from different organizations run in separate Kubernetes Pods with resource limits enforced. A runaway simulation (infinite loop, memory leak) cannot consume resources allocated to another organization. Network policies restrict simulation Pods to communicating only with the Twin API, Object Storage, and configured sync endpoints.

### Sync Channel Security

Real-time synchronization channels carry sensor data that may be commercially sensitive (production line throughput, robot trajectories, building occupancy). All sync channels MUST use TLS encryption. MQTT connections MUST use TLS client certificates. ROS 2 connections MUST use SROS2 (Secure ROS 2) with DDS security plugins. Kafka topics for twin events inherit the cluster's SASL/TLS configuration.

### Synthetic Data Governance

Generated datasets may contain realistic depictions of physical environments (factory floors, warehouse layouts) that constitute trade secrets. Synthetic datasets inherit the access control of their parent twin. A dataset generated from `twin-warehouse-east` (owned by org `acme`) is accessible only to members of org `acme`, enforced by Object Storage bucket policies and the Twin API's authorization layer.

### Infrastructure Twin Access

Infrastructure twins can inject failures into simulated representations of production systems. While these failures do not affect real infrastructure (the twin is a simulation), the *knowledge* gained from chaos experiments -- which services are vulnerable, which failure modes are unhandled -- is security-sensitive. Access to infrastructure twin chaos injection requires the `twin-admin` role and produces an audit log entry for every injected scenario.

## References

1. [HIP-0030: Event Streaming Standard](./hip-0030-event-streaming-standard.md)
2. [HIP-0032: Object Storage Standard](./hip-0032-object-storage-standard.md)
3. [HIP-0057: ML Pipeline & Training Standard](./hip-0057-ml-pipeline-standard.md)
4. [HIP-0059: Timeseries Database Standard](./hip-0059-timeseries-database-standard.md)
5. [HIP-0080: Robotics Standard](./hip-0080-robotics-standard.md)
6. [Universal Scene Description (USD) Specification](https://openusd.org/release/index.html)
7. [NVIDIA Omniverse Platform](https://developer.nvidia.com/omniverse)
8. [MuJoCo: Multi-Joint dynamics with Contact](https://mujoco.org/)
9. [Gazebo Simulation](https://gazebosim.org/)
10. [PyBullet Physics Engine](https://pybullet.org/)
11. [Gymnasium (formerly OpenAI Gym)](https://gymnasium.farama.org/)
12. [Domain Randomization for Transferring Deep Neural Networks from Simulation to the Real World](https://arxiv.org/abs/1703.06907)
13. [Sim-to-Real: Learning Agile Locomotion For Quadruped Robots](https://arxiv.org/abs/1804.10332)
14. [Digital Twin: Enabling Technologies, Challenges and Open Research](https://ieeexplore.ieee.org/document/8901113)
15. [Chaos Engineering: Building Confidence in System Behavior through Experiments](https://principlesofchaos.org/)
16. [USD Physics Schema](https://openusd.org/release/api/usd_physics_page_front.html)
17. [MaterialX Specification](https://www.materialx.org/)
18. [Stable Baselines3: Reliable RL Implementations](https://stable-baselines3.readthedocs.io/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
