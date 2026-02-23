---
hip: 0080
title: Robotics & Embodied AI Integration Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-9, HIP-10, HIP-15
---

# HIP-80: Robotics & Embodied AI Integration Standard

## Abstract

This proposal defines the standard for integrating robotic systems and embodied AI agents into the Hanzo ecosystem. The standard bridges the Robot Operating System 2 (ROS2) middleware with the Hanzo Agent SDK (HIP-9) and Model Context Protocol (HIP-10), enabling LLM-powered agents to perceive physical environments through cameras and sensors, plan tasks in natural language, and execute actions on real or simulated robots. It covers perception pipelines, motion planning via MoveIt2, autonomous navigation via Nav2, URDF/SDF robot model support, NVIDIA Isaac integration for GPU-accelerated simulation, safety protocols compliant with ISO 13482, teleoperation with AI assistance, and digital twin simulation before physical deployment.

**Repository**: [github.com/hanzoai/robotics](https://github.com/hanzoai/robotics)
**PyPI**: `hanzoai-robotics`
**Port**: 8080 (Robotics API Gateway)

## Motivation

Robotics is the final frontier for AI agents. Today's LLMs can reason, plan, write code, and operate computers (HIP-15), but they cannot interact with the physical world. Meanwhile, the robotics community has mature middleware (ROS2), powerful motion planners (MoveIt2), and robust navigation stacks (Nav2), but these systems lack natural language understanding, multi-modal reasoning, and adaptive planning.

The gap manifests in five concrete problems:

1. **Task specification is brittle**. Industrial robots are programmed in domain-specific languages (URScript, KRL, RAPID). Every new task requires a robotics engineer to write explicit waypoints and state machines. An LLM that understands "pick up the red cup and place it on the shelf" could replace thousands of lines of procedural code with a single instruction.

2. **Perception is disconnected from reasoning**. Object detection models produce bounding boxes, but they do not understand semantic meaning. An LLM can interpret "there is a cup near the edge of the table, a plate behind it" and reason about spatial relationships, affordances, and risks.

3. **Error recovery requires human intervention**. When a robot drops an object, traditional systems halt and wait for a human. An LLM-powered agent can observe the failure, reason about what went wrong, and generate a recovery plan autonomously.

4. **No unified agent protocol for physical robots**. The Agent SDK (HIP-9) orchestrates digital agents. MCP (HIP-10) gives agents tools for file systems, browsers, and computers. But no standard exists for agents to control joints, read sensors, query SLAM maps, or trigger emergency stops.

5. **Simulation and reality are disconnected**. Engineers develop in simulation and deploy to hardware using different interfaces. A unified standard ensures the same agent code works identically in both.

## Design Philosophy

### Why LLMs for Robotics

Language is the most natural task interface ever invented. Humans coordinate physical work through language daily: "hand me the wrench," "move that box to the corner," "be careful, the floor is wet." LLMs bring three capabilities that traditional robot programming lacks:

- **Common-sense reasoning**: An LLM knows that cups contain liquid, that knives are sharp, that fragile items need gentle handling. This knowledge does not need to be hand-coded per object.
- **Multi-modal understanding**: Vision-language models (HIP-3, Jin architecture) jointly process camera images and natural language to build scene understanding beyond bounding boxes.
- **Adaptive replanning**: When a plan fails, an LLM observes the current state, compares it to the goal, and generates a new plan. Traditional planners require failure modes to be anticipated at design time.

### Why ROS2 Over Custom Middleware

ROS2 is the de facto standard in robotics middleware. Building on custom middleware would mean rewriting hardware drivers for every robot and sensor, reimplementing solved problems (tf2 transforms, DDS discovery, time synchronization), and isolating from the ecosystem's motion planners, navigation stacks, and SLAM algorithms.

ROS2 also provides real-time communication guarantees via DDS quality-of-service policies. Custom HTTP/WebSocket protocols cannot offer deterministic message delivery under 1ms latency.

### Why Hanzo Agents as Robot Controllers

The Agent SDK (HIP-9) already provides architecture for agents that reason, plan, use tools, maintain memory, and collaborate:

- **Tool use is natural**. Moving a robot arm is just another MCP tool call: `joint_control(positions=[...])`. Reading a camera is `camera_capture(camera_id="wrist_cam")`.
- **Memory enables learning**. Episodic memory lets a robot agent recall "the last time I grasped the bottle at this angle, it slipped."
- **Multi-agent orchestration scales to fleets**. A warehouse with 50 robots is a multi-agent coordination problem that the Agent SDK handles directly.

## Specification

### Architecture Overview

```
+-------------------------------------------------------------------+
|                     Hanzo Agent (HIP-9)                           |
|              (LLM reasoning + task planning)                      |
+-------------------------------------------------------------------+
|                     MCP Protocol (HIP-10)                         |
|         (robotics tools + perception + control)                   |
+----------+-----------+-----------+----------+---------------------+
| camera   | joint     | nav       | slam     | gripper   | sensor  |
| capture  | control   | goal      | query    | control   | read    |
+----------+-----------+-----------+----------+---------------------+
|               Hanzo Robotics Bridge (Port 8080)                   |
|          (REST API + WebSocket + ROS2 bridge node)                |
+-------------------------------------------------------------------+
|                        ROS2 Middleware                             |
|              (DDS transport + tf2 + lifecycle)                     |
+----------+-----------+-----------+----------+---------------------+
| MoveIt2  | Nav2      | SLAM      | Percep.  | Isaac     | Gazebo  |
| (motion) | (nav)     | (mapping) | (vision) | (GPU sim) | (sim)   |
+----------+-----------+-----------+----------+---------------------+
|              Hardware / Simulation Interface                       |
|        (robot drivers, cameras, LiDAR, force-torque)              |
+-------------------------------------------------------------------+
```

### ROS2 Bridge Node

The bridge translates between MCP tool calls (JSON-RPC over WebSocket) and ROS2 topics, services, and actions. It runs as a standard ROS2 node exposing an HTTP/WebSocket API on port 8080.

```python
import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from sensor_msgs.msg import Image, JointState
from nav2_msgs.action import NavigateToPose
from moveit_msgs.action import MoveGroup

class HanzoRoboticsBridge(Node):
    """
    ROS2 node bridging Hanzo MCP tools to the robot.
    Subscribes to sensor topics, exposes action clients for
    motion planning and navigation, serves the MCP API.
    """
    def __init__(self):
        super().__init__('hanzo_robotics_bridge')

        # Sensor subscriptions
        self.camera_sub = self.create_subscription(
            Image, '/camera/color/image_raw', self.on_camera_frame, 10)
        self.joint_sub = self.create_subscription(
            JointState, '/joint_states', self.on_joint_state, 10)

        # Planner action clients
        self.moveit_client = ActionClient(self, MoveGroup, '/move_action')
        self.nav2_client = ActionClient(self, NavigateToPose, '/navigate_to_pose')

        self.latest_frame = None
        self.latest_joints = None
        self.emergency_stop_active = False
        self.get_logger().info('Hanzo Robotics Bridge ready on port 8080')
```

### MCP Tools for Robotics

All robotics capabilities are exposed as MCP tools (HIP-10). Any MCP-compatible agent can control a robot without custom integration.

```yaml
MCP Tool: camera_capture
  Description: Capture image from robot camera
  Parameters:
    camera_id: string        # "wrist_cam", "head_cam", "depth_cam"
    format: string           # "jpeg", "png", "raw" (default: "jpeg")
    resolution: [int, int]   # Optional downscale [width, height]
  Returns:
    image: string            # Base64-encoded image
    width: int
    height: int
    timestamp: float
    frame_id: string         # ROS2 tf2 frame identifier

MCP Tool: joint_control
  Description: Command robot joint positions or velocities
  Parameters:
    positions: float[]       # Target joint angles in radians
    velocities: float[]      # Optional velocity limits per joint
    duration: float          # Time to reach target (seconds)
    blocking: bool           # Wait for completion (default: true)
  Returns:
    success: bool
    final_positions: float[]
    error: string | null

MCP Tool: gripper_control
  Description: Open or close robot end-effector
  Parameters:
    action: string           # "open", "close", "set_position"
    position: float          # 0.0 (closed) to 1.0 (open)
    force: float             # Grip force in Newtons
  Returns:
    success: bool
    position: float
    gripping: bool           # True if object detected

MCP Tool: motion_plan
  Description: Plan and execute motion via MoveIt2
  Parameters:
    target_pose: {x, y, z, qx, qy, qz, qw}  # End-effector goal
    frame_id: string         # Reference frame (default: "base_link")
    planner_id: string       # MoveIt2 planner (default: "RRTConnect")
    max_velocity: float      # Velocity scaling 0.0-1.0 (default: 0.5)
    execute: bool            # Plan only or plan+execute (default: true)
  Returns:
    success: bool
    trajectory: object
    planning_time: float

MCP Tool: nav_goal
  Description: Send autonomous navigation goal via Nav2
  Parameters:
    x: float                 # Target X (meters, map frame)
    y: float                 # Target Y (meters, map frame)
    theta: float             # Target orientation (radians)
    frame_id: string         # Reference frame (default: "map")
  Returns:
    success: bool
    final_pose: {x, y, theta}
    distance_traveled: float

MCP Tool: slam_query
  Description: Query SLAM map and robot localization
  Parameters:
    query_type: string       # "pose", "map", "landmarks", "path_exists"
    target: {x, y}           # For path_exists queries
  Returns:
    robot_pose: {x, y, theta, frame_id}
    map_data: string         # Base64-encoded occupancy grid
    landmarks: [{id, x, y, label}]

MCP Tool: sensor_read
  Description: Read from robot sensors
  Parameters:
    sensor_id: string        # "imu", "force_torque", "lidar", "joint_states"
    duration: float          # Sampling duration (default: 0)
  Returns:
    readings: object
    timestamp: float
    frame_id: string

MCP Tool: emergency_stop
  Description: Immediately halt all robot motion
  Parameters:
    reason: string
  Returns:
    stopped: bool
    timestamp: float
```

### LLM-Powered Task Planning

The task planner converts natural language into executable robot action sequences via a three-stage pipeline: decompose, ground, execute.

```
"Pick up the red cup and place it on the shelf"
    |
    v  Stage 1: Decompose (LLM reasoning)
["locate red cup", "approach", "grasp", "move to shelf", "place"]
    |
    v  Stage 2: Ground (perception)
{object: "cup", color: "red", pose: {x: 0.4, y: 0.2, z: 0.1}}
    |
    v  Stage 3: Execute (motion + control)
motion_plan(target_pose=pre_grasp) -> gripper_control(close) -> ...
```

```python
class RobotTaskPlanner:
    """Converts natural language to robot action sequences."""

    def __init__(self, agent, mcp_client):
        self.agent = agent
        self.mcp = mcp_client

    async def execute_instruction(self, instruction: str) -> TaskResult:
        # Stage 1: LLM decomposes instruction into sub-tasks
        plan = await self.agent.reason(
            prompt=f"""Decompose this robot instruction into action steps.
            Available tools: camera_capture, motion_plan, joint_control,
            gripper_control, nav_goal, sensor_read, slam_query.
            Instruction: {instruction}""",
            response_format="json"
        )

        # Stages 2-3: Ground each step with perception, then execute
        for step in plan.steps:
            scene = await self.mcp.execute("camera_capture",
                {"camera_id": "wrist_cam"})
            grounded = await self.agent.reason(
                prompt=f"Given this image, determine parameters for: {step}",
                images=[scene.image]
            )
            result = await self.mcp.execute(
                grounded.tool_name, grounded.parameters)
            if not result.success:
                recovery = await self.plan_recovery(step, result)
                if not recovery.success:
                    return TaskResult(success=False, error=recovery.error)

        return TaskResult(success=True)
```

### Perception Pipeline

The perception pipeline transforms raw sensor data into structured scene understanding.

```
Camera Frame (RGB-D)
  -> Object Detection (YOLO/SAM, GPU-accelerated)
  -> 6-DoF Pose Estimation (depth + detection)
  -> Scene Graph Construction (spatial relationships)
  -> Natural Language Description (for LLM reasoning)
```

```python
class PerceptionPipeline:
    """Transforms camera frames into structured scene understanding."""

    async def perceive(self, rgb_frame, depth_frame) -> SceneGraph:
        detections = await self.detector.detect(rgb_frame)
        objects = []
        for det in detections:
            pose = await self.pose_estimator.estimate(
                rgb_frame, depth_frame, det.bbox)
            objects.append(SceneObject(
                label=det.label, confidence=det.confidence,
                pose=pose, properties=det.attributes))

        graph = self.build_scene_graph(objects)
        graph.description = self.describe_scene(graph)
        return graph

    def describe_scene(self, graph: SceneGraph) -> str:
        """Generate natural language for LLM consumption."""
        lines = [f"Scene contains {len(graph.objects)} objects:"]
        for obj in graph.objects:
            rels = ", ".join(f"{r.type} {r.target.label}"
                            for r in graph.get_relations(obj.id))
            lines.append(
                f"- {obj.label} ({obj.properties.get('color', '?')}) "
                f"at ({obj.pose.x:.2f}, {obj.pose.y:.2f}, {obj.pose.z:.2f})"
                f"{', ' + rels if rels else ''}")
        return "\n".join(lines)
```

### URDF/SDF Robot Model Support

Both URDF and SDF formats are supported for robot kinematics, dynamics, and geometry. Models are loaded at bridge startup and consumed by MoveIt2 for planning and by the perception pipeline for self-collision checking.

```yaml
# robotics_config.yaml
robot:
  name: "hanzo_manipulator"
  model_format: "urdf"                    # "urdf" or "sdf"
  model_path: "/models/hanzo_arm.urdf"
  moveit:
    srdf_path: "/config/hanzo_arm.srdf"
    kinematics_solver: "KDLKinematicsPlugin"
    default_planner: "RRTConnect"
    planning_time: 5.0
  joint_limits:
    joint_1: { min: -3.14, max: 3.14, velocity: 2.0, effort: 100.0 }
    joint_2: { min: -2.09, max: 2.09, velocity: 2.0, effort: 100.0 }
  end_effector:
    type: "parallel_gripper"
    link: "gripper_link"
    max_opening: 0.08
    max_force: 40.0
```

### MoveIt2 Integration

MoveIt2 handles motion planning with AI-guided optimization. The LLM does not compute trajectories -- it specifies goals and constraints, which the bridge translates into MoveIt2 planning requests.

```python
class MoveIt2Planner:
    """The LLM specifies WHAT to do; MoveIt2 computes HOW."""

    async def plan_to_pose(self, target_pose: Pose,
                           constraints: list[str] | None = None,
                           planner_id: str = "RRTConnect") -> MotionPlan:
        """
        constraints accepts natural language translated to MoveIt2:
        - "keep end-effector upright" -> orientation constraint
        - "avoid the left side" -> position constraint
        - "move slowly near the table" -> velocity constraint region
        """
        goal = MoveGroup.Goal()
        goal.request.group_name = self.planning_group
        goal.request.planner_id = planner_id
        goal.request.goal_constraints = [self.pose_to_constraint(target_pose)]
        goal.request.path_constraints = self.translate_constraints(constraints)

        result = await self.moveit_client.send_goal_async(goal)
        return MotionPlan(
            success=result.error_code.val == 1,
            trajectory=result.planned_trajectory,
            planning_time=result.planning_time)
```

### Nav2 Integration

Nav2 handles autonomous navigation for mobile robots. The LLM sends goals and dynamically replans when obstacles are encountered.

```python
class Nav2Controller:
    """LLM-guided autonomous navigation with replanning."""

    async def navigate_to(self, x: float, y: float, theta: float,
                          frame_id: str = "map") -> NavigationResult:
        goal = NavigateToPose.Goal()
        goal.pose.header.frame_id = frame_id
        goal.pose.pose.position.x = x
        goal.pose.pose.position.y = y
        goal.pose.pose.orientation = yaw_to_quaternion(theta)
        result = await self.nav2_client.send_goal_async(goal)
        return NavigationResult(success=result.status == GoalStatus.STATUS_SUCCEEDED)

    async def navigate_with_replanning(self, agent, destination: str):
        """If Nav2 fails, the LLM reasons about alternatives."""
        slam = await self.mcp.execute("slam_query", {"query_type": "map"})
        goal = await agent.reason(
            prompt=f"Determine (x,y,theta) for: '{destination}'",
            context={"map": slam, "pose": self.get_pose()})

        result = await self.navigate_to(goal.x, goal.y, goal.theta)
        if not result.success:
            cam = await self.mcp.execute("camera_capture", {"camera_id": "front_cam"})
            new_goal = await agent.reason(
                prompt=f"Navigation failed. Suggest alternative route.",
                images=[cam.image])
            result = await self.navigate_to(new_goal.x, new_goal.y, new_goal.theta)
        return result
```

### NVIDIA Isaac Integration

NVIDIA Isaac provides GPU-accelerated perception, simulation, and synthetic data generation for three purposes:

1. **Isaac Sim / Omniverse**: High-fidelity physics simulation for digital twin testing
2. **Isaac Perceptor**: GPU-accelerated object detection and pose estimation
3. **Isaac Manipulator**: Accelerated motion planning with cuMotion

```yaml
Isaac Integration:
  Simulation:
    engine: "isaac_sim"
    scene_path: "/worlds/warehouse.usd"
    physics_dt: 0.001                    # 1kHz physics
    render_dt: 0.016                     # 60 FPS
  Perception:
    detector: "isaac_perceptor"
    model: "dope"                        # Deep Object Pose Estimation
  Motion:
    planner: "cumotion"                  # GPU-accelerated planning
    trajectory_dt: 0.02                  # 50Hz output
```

### Digital Twin Simulation

Before deploying to physical hardware, all robot agent behaviors MUST be validated in simulation. The same MCP tools work in simulation and on hardware -- only the ROS2 bridge target changes.

```
Workflow: Define task -> Sim validates -> Record for review -> Deploy to hardware -> Monitor
```

```python
class DigitalTwin:
    """Same agent code works in Gazebo, Isaac Sim, and on hardware."""

    def __init__(self, simulator: str = "gazebo"):
        self.simulator = simulator  # "gazebo" or "isaac_sim"

    async def run_task(self, agent, instruction: str) -> SimResult:
        """Run task in simulation, collect metrics for validation."""
        self.reset_metrics()
        result = await agent.execute_instruction(instruction)
        return SimResult(
            success=result.success,
            collisions=self.collision_count,
            elapsed_time=self.elapsed,
            trajectory=self.recorded_trajectory)
```

### Teleoperation with AI Assistance

For tasks where full autonomy is not yet safe, the standard supports human-in-the-loop control with AI suggestions across four escalating modes:

| Mode | Human Role | AI Role |
|------|-----------|---------|
| Direct Control | Full control | Safety monitoring only |
| Shared Control | Sets direction | Handles fine motion |
| Supervised Autonomy | Can intervene anytime | Executes plan |
| Full Autonomy | Reviews after | Executes independently |

```python
class TeleoperationSession:
    """Human-in-the-loop robot control with AI assistance."""

    async def run(self):
        while self.active:
            human_cmd = await self.get_human_input()
            scene = await self.bridge.perceive()
            ai_suggestion = await self.agent.reason(
                prompt=f"Operator is trying to {human_cmd.intent}. "
                       f"Suggest optimal motion for current scene.",
                context={"scene": scene, "command": human_cmd})

            if self.mode == "direct_control":
                await self.bridge.execute(human_cmd)
                if ai_suggestion.has_safety_warning:
                    self.display_warning(ai_suggestion.warning)
            elif self.mode == "shared_control":
                blended = self.blend_commands(human_cmd, ai_suggestion)
                await self.bridge.execute(blended)
            elif self.mode == "supervised_autonomy":
                cmd = human_cmd if self.human_override else ai_suggestion.command
                await self.bridge.execute(cmd)
```

## Safety

### Real-Time Constraints

Physical robot control has hard real-time requirements that LLM inference cannot meet. The standard enforces strict separation:

| Layer | Latency Requirement | Runs On |
|-------|-------------------|---------|
| Emergency stop | < 1ms | Hardware/FPGA |
| Joint servo loop | < 1ms | Real-time controller |
| Collision avoidance | < 10ms | ROS2 real-time node |
| Motion planning | < 5s | MoveIt2 (non-RT) |
| LLM task planning | < 30s | Hanzo Agent (non-RT) |

The LLM NEVER directly commands joint torques or velocities in real-time. It sets goals; the real-time controller executes them safely.

### Emergency Stop Protocol

```python
class EmergencyStopManager:
    """Multi-layer e-stop. Any layer triggers; all must clear to resume."""

    STOP_SOURCES = [
        "hardware_button",      # Physical e-stop (highest priority)
        "safety_controller",    # Real-time collision/force monitoring
        "agent_decision",       # LLM detects unsafe situation
        "operator_command",     # Human teleoperator
        "watchdog_timeout",     # Communication loss with bridge
    ]

    async def trigger_stop(self, source: str, reason: str):
        await self.hardware_stop()           # < 1ms via hardware
        await self.cancel_all_goals()        # Cancel MoveIt2/Nav2
        self.log_emergency_stop(source, reason)
        await self.notify_all(source, reason)

    async def request_resume(self, operator_id: str) -> bool:
        """An LLM cannot autonomously resume after e-stop."""
        if self.hardware_estop_active:
            return False  # Physical button must be manually released
        return await self.request_operator_confirmation(
            operator_id, message="Confirm safe to resume")
```

### ISO 13482 Compliance

For service robots operating near humans, the standard requires ISO 13482 compliance:

```yaml
ISO 13482 Checklist:
  Protective Measures:
    - Force/torque limiting on all joints
    - Speed reduction in human-proximate zones
    - Soft collision response (compliant control)
    - Minimum safe distances enforced by perception
  Safety Functions:
    - Emergency stop (SIL 2 minimum)
    - Speed monitoring (SIL 1 minimum)
    - Force monitoring (SIL 1 minimum)
    - Workspace restriction (virtual walls)
  Documentation:
    - Safety manual, risk assessment, validation results, audit schedule
```

### Safety Memory

The agent maintains persistent safety memory recording near-misses and emergency stops. Before planning any motion, the agent queries this memory to anticipate known hazards.

```python
class SafetyMemory:
    async def check_safety(self, planned_action) -> SafetyCheck:
        history = await self.agent.memory.recall(
            query=f"Safety events near ({planned_action.target.x}, "
                  f"{planned_action.target.y})")
        if history:
            return SafetyCheck(proceed=False,
                reason=f"Previous event: {history[0]}",
                suggestion="Use reduced speed and force limits")
        return SafetyCheck(proceed=True)
```

## Implementation

### Configuration

```bash
# Bridge
HANZO_ROBOTICS_PORT=8080
HANZO_ROBOTICS_ROS_DOMAIN_ID=0
HANZO_ROBOTICS_URDF_PATH=/models/robot.urdf
HANZO_ROBOTICS_MOVEIT_CONFIG=/config/moveit/

# Safety
HANZO_ROBOTICS_MAX_VELOCITY=1.0        # m/s
HANZO_ROBOTICS_MAX_FORCE=50.0          # N
HANZO_ROBOTICS_ESTOP_TIMEOUT=0.1       # seconds
HANZO_ROBOTICS_HUMAN_PROXIMITY_SPEED=0.25

# Simulation
HANZO_ROBOTICS_SIM_BACKEND=gazebo      # "gazebo" or "isaac_sim"
HANZO_ROBOTICS_SIM_HEADLESS=false

# Perception
HANZO_ROBOTICS_DETECTOR=yolo           # "yolo", "sam", "isaac_perceptor"
HANZO_ROBOTICS_DETECTOR_DEVICE=cuda:0
```

### Deployment

```yaml
# compose.yml
services:
  robotics-bridge:
    image: hanzoai/robotics:latest
    ports:
      - "8080:8080"
    environment:
      - ROS_DOMAIN_ID=0
      - HANZO_ROBOTICS_URDF_PATH=/models/robot.urdf
    volumes:
      - ./models:/models
      - ./config:/config
    network_mode: host         # Required for ROS2 DDS discovery
    devices:
      - /dev/video0:/dev/video0
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

## Compatibility

### Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| HIP-3 (Jin Architecture) | Vision-language models for scene understanding |
| HIP-9 (Agent SDK) | Agents control robots via the Agent SDK tool interface |
| HIP-10 (MCP) | Robotics capabilities exposed as MCP tools |
| HIP-15 (Computer Control) | Computer control for robot workstation UIs |
| HIP-19 (Tensor Operations) | GPU tensor operations for perception models |
| HIP-50 (Edge Computing) | Edge deployment for latency-sensitive perception |

### Supported Robot Platforms

| Platform | Type | ROS2 Driver | Status |
|----------|------|------------|--------|
| Universal Robots (UR5e, UR10e) | Arm | ur_driver | Tested |
| Franka Emika Panda | Arm | franka_ros2 | Tested |
| Boston Dynamics Spot | Mobile | spot_ros2 | Planned |
| Clearpath Husky | Mobile base | clearpath_ros2 | Planned |
| Unitree Go2 | Quadruped | unitree_ros2 | Planned |
| Custom (URDF/SDF) | Any | ros2_control | Tested |

## Implementation Roadmap

### Phase 1: Core Bridge (Q1 2026)
- ROS2 bridge node with MCP tool interface
- Camera capture and joint control tools
- URDF loading and basic MoveIt2 integration
- Gazebo simulation support, emergency stop protocol

### Phase 2: Perception + Planning (Q2 2026)
- Full perception pipeline (detection, pose, scene graph)
- LLM-powered task planning from natural language
- Nav2 integration, NVIDIA Isaac Perceptor integration

### Phase 3: Teleoperation + Safety (Q3 2026)
- Teleoperation with AI assistance (all four modes)
- ISO 13482 compliance tooling, safety memory
- Isaac Sim digital twin integration

### Phase 4: Fleet + Production (Q4 2026)
- Multi-robot orchestration via Agent SDK
- Production monitoring, edge deployment
- Sim-to-real transfer tooling

## References

1. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
2. [HIP-10: MCP Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)
3. [HIP-15: Computer Control Standard](./hip-0015-computer-control-standard.md)
4. [ROS2 Documentation](https://docs.ros.org/en/rolling/)
5. [MoveIt2 Documentation](https://moveit.picknik.ai/)
6. [Nav2 Documentation](https://docs.nav2.org/)
7. [NVIDIA Isaac SDK](https://developer.nvidia.com/isaac-sdk)
8. [NVIDIA Isaac Sim](https://developer.nvidia.com/isaac-sim)
9. [ISO 13482:2014](https://www.iso.org/standard/53820.html)
10. [URDF Specification](http://wiki.ros.org/urdf/XML)
11. [SDF Specification](http://sdformat.org/spec)
12. [Gazebo Simulation](https://gazebosim.org/)
13. [Robotics Repository](https://github.com/hanzoai/robotics)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
