---
hip: 0083
title: Sensor Fusion & SLAM Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
---

# HIP-83: Sensor Fusion & SLAM Standard

## Abstract

This proposal defines the sensor fusion and SLAM (Simultaneous Localization and
Mapping) standard for the Hanzo ecosystem. Hanzo Fusion provides a unified
framework for combining data from heterogeneous sensors -- LiDAR, cameras,
IMUs, GPS/GNSS receivers, radar, ultrasonic rangefinders, and wheel odometry --
into a coherent estimate of an agent's pose and a persistent map of its
environment. It implements classical Bayesian fusion (extended Kalman filters,
unscented Kalman filters, particle filters), modern factor graph optimization
(pose graph SLAM, bundle adjustment), and AI-enhanced methods (learned feature
extraction, neural radiance fields, Gaussian splatting) under a single API.

Every Hanzo service that operates in physical or simulated 3D space -- robotic
platforms (HIP-0080), autonomous vehicles, spatial AI applications, augmented
reality systems, and digital twins (HIP-0082) -- MUST use Hanzo Fusion for
localization and mapping rather than embedding ad hoc sensor processing.

**Repository**: [github.com/hanzoai/fusion](https://github.com/hanzoai/fusion)
**Port**: 8083 (HTTP API), 8084 (gRPC streaming)
**Binary**: `hanzo-fusion`
**Container**: `ghcr.io/hanzoai/fusion:latest`

## Motivation

Autonomous systems perceive the world through sensors. A delivery robot has
LiDAR for obstacle detection, cameras for lane following, an IMU for
orientation, wheel encoders for dead reckoning, and GPS for global positioning.
A warehouse drone has stereo cameras, a downward-facing depth sensor, and an
IMU. An AR headset has SLAM cameras, an IMU, and optionally depth sensors.

Each of these platforms faces the same fundamental problem: no single sensor is
reliable in all conditions, and the raw output of any individual sensor is
insufficient for safe autonomous operation. This is not a theoretical concern.
It is the central engineering reality of every robotics and spatial AI project:

1. **GPS fails indoors and in urban canyons.** GPS accuracy degrades to 10-50
   meters between tall buildings and is completely unavailable inside
   warehouses, tunnels, and underground facilities. A robot that relies solely
   on GPS will lose localization the moment it enters a building.

2. **LiDAR fails in rain, fog, and dust.** Water droplets and particulates
   scatter laser pulses, producing phantom returns and reducing effective range
   from 100 meters to 20 meters or less. A vehicle that relies solely on LiDAR
   will lose depth perception in adverse weather.

3. **Cameras fail in darkness and direct sunlight.** A monocular camera
   produces no useful features in a dark warehouse at 3 AM. A stereo camera
   loses depth accuracy when the sun is directly in frame. Visual SLAM systems
   that rely solely on cameras will lose tracking under lighting extremes.

4. **IMUs drift without bound.** An inertial measurement unit provides
   high-frequency acceleration and angular velocity, but integrating these
   signals accumulates error continuously. After 60 seconds of pure IMU
   integration, position error can exceed 100 meters. An IMU alone is useless
   for localization beyond a few seconds.

5. **Wheel odometry slips.** Wheel encoders assume no-slip contact with the
   ground. On wet floors, gravel, carpet transitions, or inclines, wheels slip
   and the odometry diverges from reality. A robot that trusts wheel odometry
   on a wet warehouse floor will believe it is meters from where it actually is.

The solution is sensor fusion: combining multiple imperfect sensors so that the
strengths of each compensate for the weaknesses of the others. GPS provides
global position when available; when GPS is lost indoors, LiDAR SLAM and visual
odometry maintain position; when cameras fail in darkness, LiDAR and IMU carry
the estimate; when LiDAR degrades in dust, cameras and radar fill the gap. The
fused estimate is always more accurate and more robust than any individual
sensor.

This is well-understood theory. The problem is engineering practice:

6. **Every team rebuilds sensor fusion from scratch.** A robotics team at Hanzo
   building a delivery robot writes its own EKF. Another team building a drone
   writes a different EKF with different state representations. A third team
   building an AR application writes a visual-inertial odometry pipeline with
   incompatible coordinate conventions. Each team spends 3-6 months on
   infrastructure that is identical in principle but incompatible in practice.

7. **Classical SLAM fails in dynamic environments.** Traditional visual SLAM
   (ORB-SLAM, LSD-SLAM) assumes a static world. When people walk through the
   scene, when doors open and close, when objects are moved, classical feature
   matching produces incorrect correspondences and the map corrupts. Production
   environments are never static.

8. **Map representations are fragmented.** One team stores maps as occupancy
   grids. Another uses point clouds. A third uses signed distance fields. A
   fourth uses neural implicit surfaces. There is no standard map exchange
   format, no way to share maps between systems, and no connection between
   the mapping pipeline and the digital twin system (HIP-0082) that needs
   those maps for simulation.

9. **Sensor data has no standard storage format.** LiDAR scans arrive as
   vendor-specific binary formats. Camera images arrive as ROS messages, raw
   buffers, or compressed streams. IMU data arrives as custom structs. Without
   a standard sensor data format, replay, debugging, and offline processing
   require per-project data converters.

10. **No connection between perception and AI training.** The sensor data that
    robots collect during operation is exactly the training data that AI models
    need for learning navigation policies, object detection, and scene
    understanding. But without a standard data pipeline, this data is logged
    ad hoc (if at all) and never reaches the ML training infrastructure
    (HIP-0057).

Hanzo Fusion eliminates this redundancy by providing a single, well-tested
sensor fusion and SLAM framework that every spatial AI project in the ecosystem
uses. It standardizes sensor interfaces, state estimation algorithms, map
representations, and data formats so that work done on one project benefits
every other project.

## Design Philosophy

This section explains the reasoning behind each major architectural decision.
Understanding the *why* matters more than the *what* -- the *what* will evolve
as sensor technology and AI capabilities advance; the *why* should remain stable.

### Why Multi-Sensor Fusion Is Non-Negotiable

Some robotics teams begin with a single sensor -- typically a LiDAR or a stereo
camera -- and plan to "add fusion later." This is a mistake that we encode in
the standard to prevent.

Single-sensor systems are brittle. They work in the lab, they work in the demo,
and they fail in production the first time conditions deviate from the lab
setup. The failure is not graceful degradation; it is complete loss of
localization, which for an autonomous vehicle means stopping in the middle of a
road, and for a delivery robot means driving into a wall.

Multi-sensor fusion has a cost: calibration complexity, synchronization
requirements, and computational overhead. But this cost is constant and
understood. The cost of single-sensor failure in production is unbounded and
unpredictable. We pay the constant cost upfront.

**Decision**: Hanzo Fusion requires a minimum of two sensor modalities for any
autonomous operation mode. A system with only one sensor type may use Fusion
for data processing but MUST NOT claim localization reliability.

### Why AI-Enhanced SLAM over Pure Classical Methods

Classical SLAM algorithms -- ORB-SLAM3, Cartographer, LOAM -- are mature,
well-understood, and produce excellent results in controlled environments. We
do not discard them. We augment them with learned components for the cases
where classical methods systematically fail:

**Dynamic environments.** Classical feature matching treats every pixel
equally. When a person walks through the scene, their features are matched
across frames, producing incorrect motion estimates. Learned feature
extractors (SuperPoint, R2D2) can be trained to ignore dynamic objects.
Learned outlier rejection (SuperGlue) identifies and discards incorrect
matches that geometric verification (RANSAC) misses. The result is SLAM
that continues to work in environments with people, vehicles, and moving
objects.

**Featureless environments.** Classical visual SLAM requires texture:
corners, edges, gradients. A white hallway with uniform lighting has no
features to track. Learned depth estimation (from monocular images) and
learned visual odometry provide motion estimates in featureless environments
where classical methods produce no output at all.

**Loop closure at scale.** Classical loop closure uses bag-of-words (DBoW2)
to recognize previously visited places. This fails when appearance changes
significantly: the same corridor looks different at 9 AM under fluorescent
lights versus 6 PM under emergency lighting. Learned place recognition
(NetVLAD, CosPlace) encodes scenes as high-dimensional vectors that are
robust to lighting, viewpoint, and seasonal changes.

**3D reconstruction quality.** Classical mapping produces sparse point clouds
or noisy meshes. Neural Radiance Fields (NeRFs) and 3D Gaussian splatting
produce photorealistic 3D reconstructions from the same camera data. These
reconstructions serve dual purposes: navigation (dense maps for path
planning) and visualization (digital twins via HIP-0082).

**Decision**: Classical SLAM algorithms are the default runtime backend.
AI-enhanced components are optional modules that can be enabled per-sensor
or per-environment. The system MUST function with classical methods alone so
that it operates on hardware without GPU acceleration.

### Why Standardize Map Representations

A map is only useful if other systems can read it. Today, every SLAM system
produces maps in its own format. ORB-SLAM saves maps as binary archives of
keyframes and map points. Cartographer saves maps as protobuf-serialized
submaps. Occupancy grid maps are saved as PGM images with YAML metadata.
Point clouds are saved as PCD, PLY, or LAS files. None of these formats
carry the metadata that downstream systems need: coordinate frame, creation
timestamp, sensor configuration, uncertainty estimates, semantic labels.

Hanzo Fusion defines a standard map container format (FusionMap) that wraps
any geometric representation with the metadata required for interoperability.
A FusionMap carries:

- The geometric data (point cloud, occupancy grid, mesh, neural implicit)
- The coordinate frame and datum
- The sensor configuration that produced it
- Per-element uncertainty estimates
- Semantic labels (floor, wall, obstacle, traversable, unknown)
- A unique identifier and version for map updates
- Provenance: which sensor data, which algorithm, which parameters

This container is the interface between Fusion and every downstream consumer:
path planners (HIP-0080), digital twins (HIP-0082), computer vision
pipelines (HIP-0081), and human operators viewing maps in a web UI.

**Decision**: All maps produced by Fusion are serialized as FusionMap. Legacy
formats (PCD, PLY, PGM) are supported for import/export but are not the
canonical storage format.

### Why Factor Graphs over Filtering Alone

Kalman filters (EKF, UKF) and particle filters are the traditional tools for
sensor fusion. They are fast, they run in constant memory, and they are
well-suited for real-time state estimation. Hanzo Fusion supports them as
the real-time frontend.

But filters are suboptimal for SLAM. A Kalman filter marginalizes out past
states: once a measurement is processed, the information it carried is
compressed into the current state estimate and covariance. This is correct
for tracking a single object, but for SLAM, past states matter. When a robot
recognizes that it has returned to a previously visited location (loop
closure), the correct response is to retroactively adjust all poses along the
loop. A Kalman filter cannot do this because past poses have been discarded.

Factor graph optimization (as implemented by GTSAM, Ceres, g2o) retains all
poses and all measurements as nodes and edges in a graph. When a loop closure
is detected, it is added as a new edge, and the entire graph is re-optimized.
This produces globally consistent maps. The cost is computation: full graph
optimization is O(n) in the number of poses, which for long-running systems
can be millions. Incremental solvers (iSAM2 in GTSAM) reduce this to
near-constant time for each new measurement by exploiting the sparse structure
of the graph.

**Decision**: Hanzo Fusion uses a two-tier architecture. The real-time
frontend is a filter (EKF or UKF, configurable) that produces pose estimates
at sensor rate (100-1000 Hz). The optimization backend is a factor graph
(GTSAM) that runs at keyframe rate (1-10 Hz) and produces globally consistent
maps. The frontend estimate is corrected by the backend when optimization
completes.

### Why Separation of Sensor Drivers and Fusion Core

Sensor hardware is diverse and changes rapidly. A LiDAR from Velodyne produces
data in a different format than one from Ouster or Livox. A stereo camera from
Intel RealSense has different intrinsics and distortion models than one from
Stereolabs ZED. Tightly coupling the fusion algorithm to specific sensor
hardware creates a system that must be rewritten for every new sensor.

Hanzo Fusion defines a standard sensor interface: each sensor type has a
message schema (IMU, PointCloud, Image, GNSS, WheelOdometry, Radar) with
required fields, units, and coordinate conventions. Sensor drivers translate
hardware-specific data into these standard messages. The fusion core never
sees hardware-specific data.

This separation means:
- Adding a new LiDAR model requires writing a driver (50-200 lines), not
  modifying the fusion algorithm.
- Sensor drivers can be tested independently with recorded data.
- The fusion core can be tested with synthetic data without any hardware.
- Teams can swap sensors without changing their fusion configuration.

**Decision**: Sensor drivers are separate packages (one per hardware family).
The fusion core depends only on the standard message interfaces, never on
driver packages.

## Specification

### Sensor Message Types

All sensor data flowing into Fusion MUST conform to one of the following
message types. Timestamps are nanoseconds since Unix epoch. All spatial
measurements are in SI units (meters, radians, meters/second, radians/second).

#### IMU Message

```protobuf
message ImuMessage {
  uint64 timestamp_ns = 1;
  string frame_id = 2;
  Vector3 linear_acceleration = 3;  // m/s^2, body frame
  Vector3 angular_velocity = 4;     // rad/s, body frame
  Matrix3x3 acceleration_covariance = 5;
  Matrix3x3 gyroscope_covariance = 6;
}
```

#### Point Cloud Message

```protobuf
message PointCloudMessage {
  uint64 timestamp_ns = 1;
  string frame_id = 2;
  repeated Point3 points = 3;          // x, y, z in meters
  repeated float intensities = 4;       // optional, 0.0-1.0
  repeated uint32 ring_ids = 5;         // optional, LiDAR ring index
  repeated uint64 point_timestamps = 6; // optional, per-point time
}
```

#### Image Message

```protobuf
message ImageMessage {
  uint64 timestamp_ns = 1;
  string frame_id = 2;
  uint32 width = 3;
  uint32 height = 4;
  string encoding = 5;  // "rgb8", "bgr8", "mono8", "depth16", "depth32f"
  bytes data = 6;
  CameraIntrinsics intrinsics = 7;
  DistortionModel distortion = 8;
}
```

#### GNSS Message

```protobuf
message GnssMessage {
  uint64 timestamp_ns = 1;
  double latitude = 2;   // WGS84 degrees
  double longitude = 3;  // WGS84 degrees
  double altitude = 4;   // meters above ellipsoid
  GnssFixType fix_type = 5;  // NO_FIX, FIX_2D, FIX_3D, RTK_FLOAT, RTK_FIXED
  Matrix3x3 position_covariance = 6;
  uint32 satellites_used = 7;
  float hdop = 8;
}
```

#### Wheel Odometry Message

```protobuf
message WheelOdometryMessage {
  uint64 timestamp_ns = 1;
  string frame_id = 2;
  double left_distance = 3;   // meters, cumulative
  double right_distance = 4;  // meters, cumulative
  double wheel_separation = 5; // meters
  double wheel_radius = 6;     // meters
}
```

#### Radar Message

```protobuf
message RadarMessage {
  uint64 timestamp_ns = 1;
  string frame_id = 2;
  repeated RadarTarget targets = 3;
}

message RadarTarget {
  float range = 1;          // meters
  float azimuth = 2;        // radians
  float elevation = 3;      // radians
  float radial_velocity = 4; // m/s, positive = moving away
  float rcs = 5;            // radar cross section, dBsm
}
```

### State Representation

The fusion core estimates the following state vector at each timestep:

```
State = {
  position:       [x, y, z]           // meters, world frame
  orientation:    [qw, qx, qy, qz]   // unit quaternion, world frame
  velocity:       [vx, vy, vz]        // m/s, world frame
  accel_bias:     [bax, bay, baz]     // m/s^2, IMU bias
  gyro_bias:      [bgx, bgy, bgz]    // rad/s, IMU bias
  gravity:        [gx, gy, gz]        // m/s^2, estimated gravity vector
}
```

This is a 22-dimensional state (position 3, quaternion 4, velocity 3,
accel bias 3, gyro bias 3, gravity 3, with quaternion constrained to unit
norm yielding 21 degrees of freedom). The state representation is fixed;
sensor-specific parameters (wheel radius, camera extrinsics) are stored in
the calibration, not the state vector.

### Fusion Pipeline Architecture

```
Sensor Drivers          Frontend (Real-time)        Backend (Optimization)
+----------+
| LiDAR    |---+
+----------+   |       +------------------+         +-------------------+
| Camera   |---+------>| EKF / UKF        |-------->| Factor Graph      |
+----------+   |       | (100-1000 Hz)    |         | (iSAM2, 1-10 Hz) |
| IMU      |---+       | State prediction |         | Pose graph SLAM   |
+----------+   |       | Meas. update     |         | Loop closure      |
| GPS/GNSS |---+       +--------+---------+         | Map optimization  |
+----------+   |                |                    +--------+----------+
| Radar    |---+                v                             |
+----------+   |       +------------------+                   |
| Wheels   |---+       | Pose @ sensor Hz |                   v
+----------+           +------------------+          +------------------+
                                                     | FusionMap output |
                                                     +------------------+
```

Data flows left to right. Sensor drivers produce standard messages. The
frontend filter consumes messages in timestamp order, performing prediction
(IMU propagation) and measurement updates (LiDAR, camera, GPS, etc.). The
frontend outputs a pose estimate at the highest sensor rate.

At keyframe intervals (configurable, default 1 Hz), the frontend emits a
keyframe to the backend. The backend inserts the keyframe as a node in the
factor graph, adds measurement factors (odometry between keyframes, loop
closure constraints, GPS priors), and runs incremental optimization. The
optimized trajectory is fed back to the frontend to correct drift.

### Filter Configuration

The frontend filter is selected by configuration:

```yaml
fusion:
  frontend:
    type: ekf         # ekf | ukf | particle
    predict_rate: 200  # Hz, IMU propagation rate
    covariance:
      initial_position: [0.1, 0.1, 0.1]    # meters, diagonal
      initial_orientation: [0.01, 0.01, 0.01] # radians, diagonal
      initial_velocity: [0.1, 0.1, 0.1]     # m/s, diagonal
      process_noise_accel: 0.1               # m/s^2
      process_noise_gyro: 0.01               # rad/s
      accel_bias_random_walk: 0.001          # m/s^2/sqrt(Hz)
      gyro_bias_random_walk: 0.0001          # rad/s/sqrt(Hz)

  sensors:
    imu:
      topic: /sensors/imu
      rate: 200          # Hz
      body_frame: imu_link
    lidar:
      topic: /sensors/lidar
      rate: 10           # Hz
      body_frame: lidar_link
      type: velodyne_vlp16
    camera_left:
      topic: /sensors/camera/left
      rate: 30           # Hz
      body_frame: camera_left_link
      type: stereo_left
    camera_right:
      topic: /sensors/camera/right
      rate: 30           # Hz
      body_frame: camera_right_link
      type: stereo_right
    gnss:
      topic: /sensors/gnss
      rate: 5            # Hz
      body_frame: gnss_link
    wheels:
      topic: /sensors/wheels
      rate: 50           # Hz
      body_frame: base_link
```

#### EKF (Extended Kalman Filter)

The EKF linearizes the nonlinear motion model around the current state
estimate. It is the fastest option (O(n^2) in state dimension, which at
22 dimensions is negligible) and sufficient for most ground robots and
drones operating in environments with frequent sensor updates.

**When to use**: Ground robots, drones with GPS, environments where loop
closure is not required.

#### UKF (Unscented Kalman Filter)

The UKF avoids linearization by propagating sigma points through the
nonlinear model. It provides better accuracy than the EKF for highly
nonlinear systems (aggressive maneuvers, high angular rates) at
approximately 3x the computational cost.

**When to use**: Aggressive drone flight, high-speed vehicles, systems
with large orientation changes between updates.

#### Particle Filter

The particle filter maintains a set of weighted hypotheses (particles),
each representing a possible state. It handles arbitrary nonlinear systems
and multimodal distributions (e.g., a robot that is uncertain whether it
is in corridor A or corridor B). The cost is O(N) in particle count,
typically 500-5000 particles.

**When to use**: Global localization (kidnapped robot problem),
environments with symmetry, initial localization from an unknown position.

### Factor Graph Backend

The optimization backend uses GTSAM's iSAM2 incremental solver. The factor
graph contains:

**Pose nodes**: Each keyframe is a node with a 6-DOF pose (SE3).

**Odometry factors**: Between consecutive keyframes, an odometry factor
encodes the relative motion estimated by the frontend filter. The
information matrix is derived from the frontend's covariance propagation.

**GPS factors**: When GNSS fix is available, a unary factor constrains the
keyframe position to the GPS measurement with the reported covariance.

**Loop closure factors**: When the system detects that the current
observation matches a previously visited location, a relative pose factor
is added between the current keyframe and the matched historical keyframe.

**Gravity factors**: A gravity prior factor constrains the estimated gravity
vector to magnitude 9.81 m/s^2.

**Landmark factors**: For visual SLAM, 3D landmarks observed from multiple
keyframes produce projection factors that constrain both keyframe poses and
landmark positions.

```python
# Factor graph construction (Python API)
from hanzo.fusion import FactorGraph, Pose3, Point3

graph = FactorGraph()

# Add odometry between keyframes
graph.add_between_factor(
    key_from=X(0), key_to=X(1),
    measurement=Pose3(R, t),
    noise=odometry_covariance
)

# Add GPS measurement
graph.add_gps_factor(
    key=X(1),
    measurement=Point3(lat, lon, alt),
    noise=gps_covariance
)

# Add loop closure
graph.add_between_factor(
    key_from=X(42), key_to=X(1),
    measurement=Pose3(R_loop, t_loop),
    noise=loop_closure_covariance
)

# Optimize
result = graph.optimize()  # iSAM2 incremental
trajectory = [result.at(X(i)) for i in range(num_keyframes)]
```

### SLAM Modes

Hanzo Fusion supports four SLAM modes, each using different sensor
combinations and algorithms.

#### LiDAR SLAM

Uses 3D LiDAR point clouds for scan matching and map building.

**Algorithm**: Iterative Closest Point (ICP) variants for scan-to-scan and
scan-to-map matching. GICP (Generalized ICP) is the default for its
robustness to partial overlap. NDT (Normal Distributions Transform) is
available for large-scale outdoor mapping.

**Map representation**: Voxelized point cloud. Default voxel size is 0.1m
for indoor and 0.5m for outdoor. Stored as an octree for efficient
nearest-neighbor queries and spatial indexing.

**Loop closure**: Scan context descriptors for global place recognition.
ICP refinement for relative pose estimation.

**Typical accuracy**: 1-5 cm in structured indoor environments. 10-50 cm
outdoors depending on geometry.

#### Visual SLAM

Uses monocular, stereo, or RGB-D cameras for feature tracking and mapping.

**Feature extraction**: ORB features (classical, default) or SuperPoint
(learned, optional). ORB runs on CPU at 30 fps for 640x480 images.
SuperPoint requires GPU but provides superior performance in low-texture
and changing-lighting conditions.

**Feature matching**: Brute-force matching with ratio test (classical) or
SuperGlue (learned, optional). SuperGlue handles wide baselines and
repetitive textures where classical matching fails.

**Map representation**: Sparse 3D landmark map (classical) or dense point
cloud from depth estimation (AI-enhanced). Dense maps integrate with
computer vision pipelines (HIP-0081) for semantic labeling.

**Loop closure**: DBoW2 bag-of-words (classical) or NetVLAD/CosPlace
(learned). Learned methods are recommended for environments with lighting
variation.

**Typical accuracy**: 1-10 cm with stereo cameras in textured environments.
Degrades in textureless, dark, or highly dynamic scenes.

#### Visual-Inertial Odometry (VIO)

Tightly couples camera and IMU measurements for robust odometry without
a LiDAR.

**Algorithm**: MSCKF (Multi-State Constraint Kalman Filter) for the
real-time frontend. Keyframe-based optimization in the backend. The tight
coupling means IMU predictions carry the estimate through frames where
visual tracking fails (motion blur, temporary occlusion).

**When to use**: Drones, AR/VR headsets, and any system where LiDAR is
too heavy or too expensive. VIO provides 6-DOF odometry from a camera and
an IMU -- two sensors that together weigh under 50 grams and cost under
$100.

**Typical accuracy**: 0.1-1% of distance traveled. A robot that travels
100 meters accumulates 0.1-1 meter of drift. Backend loop closure
eliminates this drift when revisiting known locations.

#### Multi-Modal SLAM

The full pipeline: LiDAR, cameras, IMU, GPS, radar, and wheel odometry
fused in a single factor graph. This is the default mode for production
autonomous systems.

**Architecture**: All sensor frontends (LiDAR scan matching, visual
feature tracking, IMU preintegration, GPS, wheel odometry) produce factors
that are inserted into a single unified factor graph. The graph optimizer
finds the trajectory that best satisfies all constraints simultaneously.

**Degraded mode**: When a sensor fails (GPS lost indoors, camera blinded
by sun, LiDAR degraded by rain), the corresponding factors stop being
added. The remaining sensors continue to constrain the graph. The system
degrades smoothly rather than failing catastrophically.

**Typical accuracy**: 1-5 cm in environments where at least two modalities
are operational. The combined system is always more accurate than any
single-sensor mode.

### AI-Enhanced Components

These modules are optional and require GPU acceleration. Each can be
enabled independently.

#### Learned Feature Extraction

Replaces ORB with SuperPoint for visual SLAM feature detection. SuperPoint
is a self-supervised CNN that detects keypoints and computes descriptors
jointly. Benefits:

- **Repeatability**: Same physical point produces the same detection under
  viewpoint and lighting changes. ORB detections drift with illumination.
- **Textureless regions**: SuperPoint detects features on walls and floors
  where ORB finds nothing.
- **GPU performance**: 5 ms per 640x480 frame on an NVIDIA Jetson Orin,
  versus 15 ms for ORB on the same hardware. The neural network is faster
  than the handcrafted algorithm.

#### Neural Radiance Fields (NeRFs)

Builds a neural 3D scene representation from camera images. The NeRF
encodes scene geometry and appearance in a multi-layer perceptron (MLP).
Given a camera pose, the NeRF renders a photorealistic image of the scene
from that viewpoint.

**Use in SLAM**: NeRF provides dense depth supervision. While visual SLAM
produces a sparse feature map, NeRF produces dense geometry for every pixel.
This dense geometry feeds into path planning (HIP-0080) and digital twin
construction (HIP-0082).

**Training**: Incremental. As the robot collects new images, the NeRF is
updated online. Instant-NGP hash encoding enables sub-second updates on
consumer GPUs.

**Storage**: A trained NeRF for a 100m^2 room is approximately 50 MB
(hash table + MLP weights). This is orders of magnitude smaller than the
equivalent dense point cloud (500 MB+).

#### 3D Gaussian Splatting

An alternative to NeRF for real-time 3D reconstruction. Represents the
scene as a collection of 3D Gaussians, each with position, covariance,
color, and opacity. Rendering is rasterization-based (not ray marching),
achieving 100+ fps at 1080p resolution.

**Advantages over NeRF**:
- 10-100x faster rendering (rasterization vs. ray marching)
- Explicit geometry (Gaussians have positions) vs. implicit (MLP weights)
- Easier to edit: add, remove, or move individual Gaussians

**Advantages of NeRF over Gaussians**:
- More compact representation for large scenes
- Better handling of specular and transparent surfaces
- More mature tooling and research ecosystem

**Decision**: Fusion supports both. Gaussian splatting is the default for
real-time applications (AR, teleoperation). NeRF is the default for
offline high-fidelity reconstruction.

### Point Cloud Processing

Fusion includes a point cloud processing pipeline integrated with the
PCL (Point Cloud Library) ecosystem.

**Voxel grid downsampling**: Reduces point density for efficient
processing. Configurable voxel size (default 0.05m indoor, 0.2m outdoor).

**Statistical outlier removal**: Removes isolated points that are likely
sensor noise. Points with fewer than K neighbors within radius R are
discarded (default K=10, R=0.5m).

**Ground plane segmentation**: RANSAC-based plane fitting to separate
ground points from obstacles. Essential for ground robots that need to
distinguish traversable surfaces from walls and objects.

**Octree spatial indexing**: Hierarchical spatial index for O(log n)
nearest-neighbor queries. Used by ICP scan matching and loop closure
detection. Memory-efficient for sparse outdoor point clouds.

**Normal estimation**: Per-point surface normals computed from local
neighborhoods. Required by GICP and NDT scan matching algorithms.

### Map Representations

Fusion supports multiple map representations, all serializable to the
FusionMap container format.

#### Occupancy Grid

A 2D or 3D grid where each cell stores the probability of occupancy
(0.0 = free, 1.0 = occupied, 0.5 = unknown). Updated via ray casting:
cells along a sensor ray are marked free; the cell at the ray endpoint
is marked occupied.

**Resolution**: Configurable, default 0.05m (2 cm) for indoor, 0.2m for
outdoor. A 100m x 100m building at 0.05m resolution is 2000x2000 = 4M
cells, consuming 4 MB of memory for a 2D grid.

**Use case**: Path planning for ground robots. The occupancy grid directly
answers "can the robot drive here?" for every cell.

#### Signed Distance Field (SDF)

Each voxel stores the signed distance to the nearest surface. Positive
values are outside surfaces, negative values are inside, and zero
crossings define the surface boundary.

**Resolution**: Typically 0.02-0.05m. A 10m x 10m x 3m room at 0.02m is
500x500x150 = 37.5M voxels. Stored as a truncated SDF (TSDF) with a
truncation distance of 3x voxel size to reduce memory.

**Use case**: Dense 3D reconstruction for manipulation, collision checking,
and mesh extraction (marching cubes). Integrates with digital twin
systems (HIP-0082) for simulation environments.

#### Neural Implicit Surface

A neural network (typically a small MLP) that maps 3D coordinates to
signed distance values. Equivalent to an SDF but with adaptive resolution:
the network allocates capacity to complex geometry and uses less capacity
for empty space.

**Storage**: 5-50 MB for a room-scale scene, versus 500 MB+ for an
equivalent voxelized SDF.

**Use case**: Compact map storage for cloud upload, map sharing between
robots, and long-term map databases.

### Calibration

Sensor fusion requires precise knowledge of the geometric and temporal
relationship between sensors. Fusion provides built-in calibration
procedures.

**Extrinsic calibration**: The 6-DOF transform (rotation + translation)
between each sensor and the robot body frame. Computed from a calibration
target (checkerboard for cameras, planar target for LiDAR-camera) or via
hand-eye calibration during robot motion.

**Intrinsic calibration**: Camera-specific parameters (focal length,
principal point, distortion coefficients). Computed from multiple views
of a calibration pattern. Stored in the camera's CameraIntrinsics message.

**Temporal calibration**: The time offset between sensor clocks. Computed
by correlating high-frequency signals (e.g., the angular velocity from
gyroscope should match the rotational motion visible in camera images).
Typical offsets are 1-50 ms.

**Calibration storage**: Calibration results are stored as YAML files in
a standard format and can be loaded by any Fusion instance.

```yaml
calibration:
  imu_to_body:
    rotation: [1.0, 0.0, 0.0, 0.0]  # quaternion wxyz
    translation: [0.0, 0.0, 0.0]     # meters
    time_offset_ns: 0

  lidar_to_body:
    rotation: [0.707, 0.0, 0.707, 0.0]
    translation: [0.1, 0.0, 0.3]
    time_offset_ns: -5000000  # -5ms

  camera_left_to_body:
    rotation: [0.5, -0.5, 0.5, -0.5]
    translation: [0.05, 0.06, 0.1]
    time_offset_ns: -12000000  # -12ms
    intrinsics:
      fx: 458.654
      fy: 457.296
      cx: 367.215
      cy: 248.375
      distortion_model: equidistant
      distortion_coeffs: [-0.28340, 0.07395, 0.00019, 0.00001]
```

### API Endpoints

Fusion exposes both a REST API (port 8083) and a gRPC streaming API
(port 8084).

#### REST API (Port 8083)

```
POST /v1/sessions                  Create a new fusion session
GET  /v1/sessions/{id}             Get session state and status
DELETE /v1/sessions/{id}           Terminate a session

POST /v1/sessions/{id}/sensors     Register a sensor with calibration
GET  /v1/sessions/{id}/pose        Get current pose estimate
GET  /v1/sessions/{id}/trajectory  Get full trajectory history
GET  /v1/sessions/{id}/map         Get current map (FusionMap format)
GET  /v1/sessions/{id}/map?format=pcd  Export map as PCD
GET  /v1/sessions/{id}/map?format=ply  Export map as PLY

POST /v1/sessions/{id}/loop-closure    Trigger manual loop closure
POST /v1/sessions/{id}/relocalize      Relocalize against a known map
POST /v1/calibrate                     Run calibration procedure

GET  /v1/health                    Health check
GET  /v1/metrics                   Prometheus metrics
```

#### gRPC Streaming API (Port 8084)

```protobuf
service FusionService {
  // Stream sensor data into the fusion engine
  rpc StreamImu(stream ImuMessage) returns (stream PoseEstimate);
  rpc StreamPointCloud(stream PointCloudMessage) returns (stream PoseEstimate);
  rpc StreamImage(stream ImageMessage) returns (stream PoseEstimate);
  rpc StreamGnss(stream GnssMessage) returns (stream PoseEstimate);
  rpc StreamRadar(stream RadarMessage) returns (stream PoseEstimate);
  rpc StreamWheelOdometry(stream WheelOdometryMessage) returns (stream PoseEstimate);

  // Subscribe to state updates
  rpc SubscribePose(SessionId) returns (stream PoseEstimate);
  rpc SubscribeMap(SessionId) returns (stream MapUpdate);
  rpc SubscribeKeyframes(SessionId) returns (stream Keyframe);

  // Map operations
  rpc GetMap(MapRequest) returns (FusionMap);
  rpc LoadMap(FusionMap) returns (LoadMapResponse);
}
```

The gRPC streaming API is the primary interface for real-time operation.
Sensor drivers stream measurements in; the fusion engine streams pose
estimates out. The bidirectional streaming design means poses arrive at
sensor rate without polling overhead.

### Integration Points

#### Robotics (HIP-0080)

Fusion provides the localization layer for all robotic platforms. The robot
control stack (HIP-0080) subscribes to the pose stream and the map for
path planning. Fusion does not make navigation decisions; it answers
"where am I?" and "what does the world look like?" so the robot stack
can answer "where should I go?"

#### Computer Vision (HIP-0081)

Visual features extracted by the computer vision pipeline feed into
visual SLAM. Object detections (people, vehicles, dynamic obstacles) are
used to mask dynamic regions from the SLAM feature tracker. Semantic
segmentation labels are projected into the 3D map to produce semantically
annotated maps.

#### Digital Twin (HIP-0082)

FusionMaps are the primary data source for digital twin construction.
As a robot maps a physical space, the FusionMap is streamed to the digital
twin system, which renders it as an interactive 3D environment. Changes
in the physical space (moved furniture, new obstacles) are detected by
comparing new sensor data against the existing map and propagated to the
twin.

#### Timeseries (HIP-0059)

All sensor metadata -- data rates, dropped messages, covariance traces,
optimization residuals -- are published as timeseries metrics to
HIP-0059. This enables monitoring of fusion health: if the LiDAR rate
drops below expected, if the IMU bias estimate diverges, or if the
optimization residual spikes (indicating a bad loop closure), alerts
fire before the system fails.

#### ML Pipeline (HIP-0057)

Sensor data collected during operation is logged in standard formats that
the ML pipeline can ingest for training. A robot that drives 100 km
collects training data for depth estimation, object detection, place
recognition, and navigation policies. Fusion provides the ground-truth
trajectory labels (optimized poses) that supervised learning requires.

### Storage and Persistence

**Sensor data**: Raw sensor streams are optionally logged to Hanzo Object
Storage (HIP-0032) in the standard message format. A 10-minute session
with LiDAR (10 Hz, 300K points/scan), cameras (30 Hz, 640x480), and IMU
(200 Hz) produces approximately 2 GB of raw data.

**Maps**: FusionMaps are stored in Object Storage with versioning. Each
map update is a new version, enabling temporal queries ("what did the
warehouse look like last Tuesday?").

**Trajectories**: Optimized trajectories are stored in TimescaleDB
(HIP-0059) as timestamped pose records, enabling SQL queries over robot
motion history.

### Performance Requirements

| Metric | Requirement | Rationale |
|--------|-------------|-----------|
| Frontend latency | < 5 ms per IMU update | Real-time control requires pose at IMU rate |
| Backend latency | < 100 ms per optimization | Keyframe optimization must complete before next keyframe |
| Point cloud processing | < 50 ms per scan | 10 Hz LiDAR leaves 100 ms budget; 50% margin |
| Visual feature extraction | < 20 ms per frame | 30 fps camera leaves 33 ms; 60% margin |
| Map update latency | < 500 ms | Acceptable for path planning updates |
| Memory (indoor) | < 2 GB for 10,000 m^2 | Warehouse-scale mapping on embedded hardware |
| Memory (outdoor) | < 8 GB for 10 km trajectory | Urban-scale mapping on vehicle compute |

### Coordinate Conventions

All spatial data in Fusion follows these conventions:

- **World frame**: East-North-Up (ENU). X points east, Y points north,
  Z points up. Origin is the first keyframe position or a user-defined
  datum.
- **Body frame**: Forward-Left-Up (FLU). X points forward, Y points left,
  Z points up. Matches the ISO 8855 vehicle coordinate system.
- **Rotation representation**: Quaternion (w, x, y, z) for storage and
  API. Rotation matrices for internal computation. Euler angles are never
  used internally due to gimbal lock.
- **Units**: SI throughout. Meters, radians, seconds, m/s, rad/s, m/s^2.

## Security Considerations

Sensor data and maps can contain sensitive information: the layout of a
private building, the movement patterns of people, the location of
security cameras and access points.

- **Map access control**: FusionMaps inherit the access control of the
  session that created them. Only users with the `fusion:map:read`
  permission can access maps. Maps can be scoped to organizations via
  Hanzo IAM (HIP-0026).
- **Sensor data encryption**: Raw sensor logs stored in Object Storage
  are encrypted at rest. In-flight sensor data over gRPC uses TLS.
- **Privacy filtering**: An optional module removes human features
  (faces, license plates) from camera data before it enters the fusion
  pipeline or is logged. This is not enabled by default because it adds
  latency, but it MUST be enabled for deployments in public spaces.
- **Map redaction**: Before sharing maps externally, a redaction tool
  removes semantic labels and reduces geometric resolution to prevent
  detailed facility reconstruction.

## Backwards Compatibility

This is the first version of the Sensor Fusion & SLAM Standard. There
are no backwards compatibility constraints.

Future versions MUST maintain wire compatibility for the protobuf message
types defined in this specification. New sensor types can be added as new
message types without breaking existing drivers. The FusionMap container
format includes a version field; readers MUST reject maps with an
unrecognized version rather than silently misinterpreting them.

## Reference Implementation

The reference implementation is at
[github.com/hanzoai/fusion](https://github.com/hanzoai/fusion). It is
written in C++ for the core fusion engine (EKF, factor graph, point cloud
processing), with Python bindings (pybind11) for the API layer and
configuration. The gRPC server is implemented in C++ for minimal latency.
The REST API is a Python FastAPI wrapper around the gRPC client.

**Dependencies**:
- GTSAM 4.2+ (factor graph optimization)
- PCL 1.13+ (point cloud processing)
- OpenCV 4.8+ (image processing, feature extraction)
- Eigen 3.4+ (linear algebra)
- gRPC 1.50+ (streaming API)
- Optional: CUDA 12.0+ (AI-enhanced components)
- Optional: PyTorch 2.0+ (learned features, NeRF, Gaussian splatting)

**Build**:
```bash
git clone https://github.com/hanzoai/fusion
cd fusion
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
```

**Docker**:
```bash
docker run -p 8083:8083 -p 8084:8084 ghcr.io/hanzoai/fusion:latest
```

**Python**:
```bash
pip install hanzo-fusion
```

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
