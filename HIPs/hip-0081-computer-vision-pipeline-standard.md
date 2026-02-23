---
hip: 0081
title: Computer Vision Pipeline Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-0003, HIP-0043, HIP-0050, HIP-0057, HIP-0080
---

# HIP-81: Computer Vision Pipeline Standard

## Abstract

This proposal defines the Computer Vision Pipeline standard for the Hanzo ecosystem. Hanzo Vision provides end-to-end computer vision capabilities -- from raw sensor input to structured output -- for both real-time and batch workloads. It handles images, video streams, 3D point clouds, depth maps, and thermal/infrared data through a unified, model-agnostic pipeline architecture.

The pipeline is organized into three stages: **ingest** (decode, normalize, and route sensor data), **process** (run one or more vision models in a directed acyclic graph), and **emit** (format results and deliver them to downstream consumers). Each stage is independently scalable. The pipeline ships with a model zoo covering object detection (YOLO, DETR), segmentation (SAM2), classification (EfficientNet, ConvNeXt), OCR (PaddleOCR, TrOCR), face recognition (ArcFace), and pose estimation (RTMPose). Any model that accepts a tensor and returns structured output can be added to the zoo without modifying the pipeline itself.

The system integrates with Jin (HIP-0003) for vision-language tasks, Engine (HIP-0043) for GPU inference serving, Edge (HIP-0050) for lightweight models deployed at the network edge, ML Pipeline (HIP-0057) for training and fine-tuning vision models, and Robotics (HIP-0080) for robot perception. It is streaming-first: video frames flow through the pipeline as a continuous stream, not as discrete batch requests. This is a hard requirement for robotics, surveillance, and autonomous systems where latency budgets are measured in milliseconds, not seconds.

**Repository**: [github.com/hanzoai/vision](https://github.com/hanzoai/vision)
**Port**: 8081 (API)
**Binary**: `hanzo-vision`
**Container**: `ghcr.io/hanzoai/vision:latest`

## Motivation

### The Fragmentation Problem

Every team that needs computer vision rebuilds the same infrastructure from scratch. A robotics team writes RTSP stream decoding, frame resizing, model inference, and result serialization. A retail analytics team writes the same pipeline with different models. A content moderation team writes it again. Each implementation makes different choices about color space conversion, aspect ratio handling, batching strategy, and output format. When a better model becomes available, each team ports it independently, introducing bugs that the others already fixed.

This is not a hypothetical problem. Within the Hanzo ecosystem alone, four separate subsystems need vision capabilities:

1. **Robotics (HIP-0080)**: Robots need object detection, depth estimation, and semantic segmentation at 30+ FPS with <50ms latency. A warehouse robot that detects an obstacle 200ms late has already collided.

2. **Content moderation**: User-uploaded images need classification (NSFW detection, violence detection), OCR (text extraction for policy enforcement), and face detection (for consent verification). This runs as batch processing over millions of images per day.

3. **Video analytics**: Surveillance and monitoring systems need real-time event detection (person enters restricted area, package left unattended, smoke detected) from continuous video streams.

4. **Document processing (HIP-0016)**: Invoices, receipts, and forms need OCR, layout analysis, and table extraction. This is batch-oriented but requires high accuracy.

Each of these has different latency requirements, different model choices, and different output formats. But they all share the same core pipeline: decode input, preprocess, run model, postprocess, emit results. Hanzo Vision standardizes this core and lets each use case configure it for their specific needs.

### The Preprocessing Tax

Model inference is the glamorous part of computer vision. Preprocessing is the part that actually breaks in production.

Consider what happens before a YOLO model sees a frame from an RTSP camera stream:

1. **Decode**: The H.264/H.265 bitstream must be decoded to raw pixels. This requires hardware acceleration (NVDEC, VAAPI, VideoToolbox) to keep up with 30+ FPS per stream.
2. **Color convert**: Camera output is typically YUV (NV12 or I420). Models expect RGB or BGR. The conversion must be correct -- swapping U and V channels produces subtly wrong colors that degrade model accuracy without obvious visual artifacts.
3. **Resize**: The camera produces 1920x1080 or 3840x2160 frames. The model expects 640x640. Naive resizing distorts aspect ratio. Letterboxing preserves aspect ratio but wastes computation on padding. The resize interpolation method (bilinear, bicubic, area) affects model accuracy by up to 2% mAP on COCO.
4. **Normalize**: Pixel values must be scaled and shifted to match the model's training distribution. YOLO expects [0, 1]. ImageNet-pretrained models expect mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]. Using the wrong normalization silently degrades accuracy.
5. **Batch**: For GPU efficiency, multiple frames should be batched into a single inference call. But batching introduces latency -- waiting to fill a batch delays all frames in the batch. The optimal batch size depends on the model, GPU memory, and latency budget.
6. **Device transfer**: The preprocessed tensor must be moved to GPU memory. For video pipelines, this should happen via zero-copy DMA, not through CPU staging buffers.

Every one of these steps has been implemented incorrectly in production systems. Hanzo Vision provides a tested, GPU-accelerated preprocessing pipeline that handles these correctly for all supported input modalities. Teams configure the pipeline; they do not reimplement it.

### The Postprocessing Tax

Postprocessing is equally treacherous. A YOLO model outputs raw bounding box coordinates in the model's internal coordinate system (640x640 with letterbox padding). Converting these back to the original image coordinates requires reversing the exact letterbox transform applied during preprocessing. Getting this wrong by even one pixel at the 640x640 scale means getting it wrong by three pixels at 1920x1080. For a face recognition system drawing a crop for downstream processing, a three-pixel shift can cut off an ear and reduce recognition accuracy.

Non-maximum suppression (NMS) is another postprocessing step that teams implement differently. IoU thresholds, score thresholds, class-agnostic vs. class-aware NMS, soft-NMS vs. hard-NMS -- each choice affects the final detection quality. Hanzo Vision provides configurable postprocessing with sensible defaults that match the model zoo's evaluation benchmarks.

### Why Streaming-First

The batch-request model (send image, receive results) works for content moderation and document processing. It does not work for robots, surveillance, or autonomous systems.

A robot navigating a warehouse receives a continuous stream of depth frames at 30 FPS. It does not send HTTP requests for each frame. It needs a pipeline that ingests frames from a shared memory buffer, runs depth estimation and object detection in parallel, fuses the results, and publishes the output to a topic that the navigation planner subscribes to. The total pipeline latency -- from frame capture to result publication -- must be under 50ms.

Surveillance systems are similar. A campus with 200 cameras produces 6,000 frames per second. Each frame needs person detection and tracking. When a person enters a restricted zone, an alert must fire within 500ms. This is a streaming problem, not a request-response problem.

Hanzo Vision is designed around streams. Frames enter the pipeline from a source (camera, video file, message queue). They flow through processing stages connected by bounded buffers. Results exit the pipeline to a sink (message queue, webhook, gRPC stream). The HTTP API exists for batch use cases, but it is implemented on top of the streaming core, not the other way around.

### Why Model-Agnostic

The state of the art in computer vision changes every six months. YOLO v5 was replaced by YOLO v8, which was replaced by YOLO v11. DETR replaced Faster R-CNN for transformer-based detection. SAM replaced everything for interactive segmentation, then SAM2 replaced SAM with video support.

If the pipeline is coupled to a specific model, replacing that model means rewriting the pipeline. If the pipeline treats models as interchangeable units with defined input/output contracts, swapping YOLO for DETR requires changing one line of configuration:

```yaml
# Before
detector:
  model: yolo-v11-l
  input: [1, 3, 640, 640]
  output: detections

# After
detector:
  model: detr-resnet-50
  input: [1, 3, 800, 800]
  output: detections
```

The pipeline handles the different input resolutions, preprocessing requirements, and output formats automatically. The downstream consumer sees the same `Detection` schema regardless of which model produced it.

This is not just about convenience. It is about evaluation. When a new model claims better accuracy, you swap it into the pipeline, run the same evaluation dataset, and compare metrics end-to-end. No code changes, no new integration work, just a config change and a benchmark run.

## Design Philosophy

### Separation of Concerns: Pipeline vs. Model vs. Application

The pipeline is not a model. The pipeline is not an application. The pipeline is the infrastructure between them.

**Models** are opaque functions: they accept tensors and return tensors. They know nothing about cameras, video codecs, coordinate systems, or output formats. They are trained, evaluated, and versioned by the ML Pipeline (HIP-0057).

**Applications** are domain-specific logic: "alert when a person enters zone A," "blur all faces in this video," "extract table data from this invoice." They know nothing about GPU memory management, batch scheduling, or tensor normalization.

**The pipeline** connects models to applications. It handles everything between raw sensor input and structured application output: decoding, preprocessing, batching, inference scheduling, postprocessing, and result delivery. By owning this layer explicitly, we prevent models from accumulating preprocessing logic and applications from accumulating inference logic.

### The DAG Execution Model

Real vision applications rarely use a single model. A video analytics system might run:

1. Person detection (YOLO)
2. Face detection on each detected person crop (RetinaFace)
3. Face recognition on each detected face (ArcFace)
4. Pose estimation on each detected person crop (RTMPose)
5. Action recognition on the pose sequence (SlowFast)

Steps 2, 3, and 4 depend on step 1. Steps 3 depends on step 2. Step 5 depends on step 4. This forms a directed acyclic graph (DAG), not a linear pipeline.

Hanzo Vision models the processing pipeline as a DAG. Each node is a processing stage (model inference, preprocessing, postprocessing, filtering, fusion). Edges define data flow. The scheduler executes independent nodes in parallel and respects dependencies. This DAG is defined in YAML configuration, not in code.

```yaml
pipeline:
  name: video-analytics
  source:
    type: rtsp
    url: rtsp://camera-01.local/stream

  stages:
    - id: detect_persons
      model: yolo-v11-l
      classes: [person]
      confidence: 0.5

    - id: detect_faces
      model: retinaface-r50
      depends_on: detect_persons
      input: crops               # Run on cropped detections from previous stage

    - id: recognize_faces
      model: arcface-r100
      depends_on: detect_faces
      gallery: s3://hanzo-vision/galleries/employees/

    - id: estimate_pose
      model: rtmpose-l
      depends_on: detect_persons
      input: crops

    - id: detect_actions
      model: slowfast-r50
      depends_on: estimate_pose
      temporal_window: 32        # Frames of pose history

  sink:
    type: stream
    topic: hanzo.vision.analytics.camera-01
```

### GPU Memory as the Binding Constraint

Vision models are large. YOLO-v11-l is 49M parameters (100MB FP16). SAM2-large is 224M parameters (450MB FP16). A pipeline running five models simultaneously can consume 2-4GB of GPU memory for weights alone, before accounting for activation memory during inference.

GPU memory is the binding constraint for vision pipelines, not compute. A modern GPU (A100, H100) has enormous compute throughput but fixed memory (40GB or 80GB). The pipeline must be memory-aware:

- **Model loading**: Load models lazily, unload models that have not been used recently. A model needed only for batch processing at night should not consume GPU memory during the day.
- **Batch sizing**: Automatically determine the maximum batch size that fits in available GPU memory, accounting for all loaded models and their activation requirements.
- **Precision selection**: Use FP16 or INT8 by default. FP32 is only justified when quantization measurably degrades accuracy for the specific task.
- **TensorRT compilation**: For NVIDIA GPUs, compile ONNX models to TensorRT engines at deployment time. TensorRT fuses operations and optimizes memory layout, reducing both memory and latency by 2-5x.

### Privacy by Default

Vision systems see people. People have faces, license plates, personal belongings, and private spaces. Hanzo Vision treats privacy as a pipeline-level concern, not an application-level afterthought.

Every pipeline can declare privacy policies that apply before results leave the pipeline:

```yaml
privacy:
  face_blur:
    enabled: true
    method: gaussian          # gaussian, pixelate, solid
    kernel_size: 31
    apply_to: output_frames   # Blur faces in any output video/images

  pii_detection:
    enabled: true
    types: [license_plate, credit_card, ssn]
    action: redact            # redact, flag, log

  consent:
    enabled: true
    gallery: s3://hanzo-vision/consent/opted-in/
    action: blur_unconsented  # Blur faces not in the consent gallery

  retention:
    raw_frames: 0h            # Do not retain raw frames
    detections: 720h          # Retain detection metadata for 30 days
    face_embeddings: 0h       # Do not retain face embeddings (derive on demand)
```

Face blurring runs as a mandatory postprocessing stage when enabled. It cannot be bypassed by the application. This ensures that even if the application code is buggy or malicious, faces in output frames are blurred before they leave the pipeline. The consent gallery allows opted-in individuals (employees who consented to recognition) to be excluded from blurring.

## Specification

### Architecture Overview

```
                ┌─────────────────────────────────────────────────────┐
                │              Hanzo Vision API (:8081)                │
                │                                                     │
                │  ┌──────────┐  ┌───────────┐  ┌─────────────────┐  │
                │  │  Ingest  │  │  Process   │  │      Emit       │  │
                │  │  Manager │  │  Scheduler │  │    Dispatcher   │  │
                │  └────┬─────┘  └─────┬──────┘  └───────┬─────────┘  │
                │       │              │                  │           │
                │  ┌────┴──────────────┴──────────────────┴────────┐  │
                │  │              Pipeline Runtime                 │  │
                │  │   ┌─────────┐  ┌──────────┐  ┌────────────┐  │  │
                │  │   │ Sources │  │  Stages  │  │   Sinks    │  │  │
                │  │   │ (RTSP,  │  │  (DAG    │  │  (Stream,  │  │  │
                │  │   │  file,  │──│  of model│──│   webhook, │  │  │
                │  │   │  queue) │  │  nodes)  │  │   gRPC)    │  │  │
                │  │   └─────────┘  └──────────┘  └────────────┘  │  │
                │  └───────────────────────────────────────────────┘  │
                │       │              │                  │           │
                │  ┌────┴──┐    ┌──────┴──────┐   ┌──────┴────────┐  │
                │  │ Model │    │   Privacy   │   │  Annotation   │  │
                │  │  Zoo  │    │   Engine    │   │   Pipeline    │  │
                │  └───────┘    └─────────────┘   └───────────────┘  │
                └────────────────────┬────────────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     ┌────────┴─────────┐  ┌────────┴────────┐  ┌─────────┴──────────┐
     │  Engine (8043)   │  │  Object Storage  │  │  Stream (HIP-30)   │
     │  GPU Inference   │  │  (HIP-0032)      │  │  Event Delivery    │
     │  HIP-0043        │  │  Models/Data     │  │                    │
     └──────────────────┘  └─────────────────┘  └────────────────────┘
```

The architecture has four layers:

1. **API Layer** (port 8081): REST and gRPC endpoints for pipeline management, batch inference, and stream control. Handles authentication via Hanzo IAM.
2. **Pipeline Runtime**: The streaming execution engine. Manages source connections, DAG scheduling, buffer management, and sink delivery. One runtime instance can run multiple pipelines concurrently.
3. **Supporting Services**: Model Zoo (model registry and loading), Privacy Engine (face blurring, PII detection), and Annotation Pipeline (AI-assisted labeling).
4. **External Dependencies**: Engine (HIP-0043) for GPU-accelerated inference, Object Storage (HIP-0032) for models and training data, Stream (HIP-0030) for event delivery.

### Input Modalities

Hanzo Vision supports five input modalities through a unified `Frame` abstraction.

#### Frame Schema

```protobuf
message Frame {
  string      frame_id    = 1;   // Unique ID (UUID v7 for time-ordering)
  string      source_id   = 2;   // Source that produced this frame
  int64       timestamp   = 3;   // Capture time (nanoseconds since epoch)
  int64       sequence    = 4;   // Monotonic sequence number within source
  Modality    modality    = 5;   // Image, video, depth, pointcloud, thermal
  TensorSpec  tensor      = 6;   // Raw tensor data
  Metadata    metadata    = 7;   // Source-specific metadata (camera intrinsics, etc.)
}

enum Modality {
  IMAGE       = 0;   // Single RGB/BGR/Grayscale image
  VIDEO       = 1;   // Frame from a video stream (carries temporal context)
  DEPTH       = 2;   // Depth map (single-channel float32, meters)
  POINTCLOUD  = 3;   // 3D point cloud (Nx3 or Nx6 with normals)
  THERMAL     = 4;   // Thermal/IR image (single-channel float32, Kelvin)
}

message TensorSpec {
  repeated int64 shape  = 1;   // e.g., [1080, 1920, 3] for RGB image
  DataType       dtype  = 2;   // uint8, float16, float32
  string         layout = 3;   // HWC, CHW, NHWC, NCHW
  bytes          data   = 4;   // Raw tensor bytes (or reference to shared memory)
}
```

#### Source Types

| Source Type | Protocol | Modalities | Use Case |
|------------|----------|------------|----------|
| `rtsp` | RTSP/RTP | Video, Depth | IP cameras, depth sensors |
| `v4l2` | Video4Linux2 | Video, Thermal | USB cameras, thermal cameras |
| `ros2` | ROS 2 DDS | All | Robot sensors (HIP-0080) |
| `file` | Local/S3 | Image, Video, PointCloud | Batch processing |
| `queue` | Hanzo Stream | All | Event-driven processing |
| `grpc` | gRPC stream | All | Custom integrations |
| `shm` | Shared memory | All | Low-latency local inference |

#### Video Stream Decoding

Video decoding is GPU-accelerated where hardware is available:

| Platform | Decoder | Codecs | Throughput |
|----------|---------|--------|------------|
| NVIDIA GPU | NVDEC | H.264, H.265, VP9, AV1 | 60+ streams @ 1080p |
| Apple Silicon | VideoToolbox | H.264, H.265, ProRes | 30+ streams @ 1080p |
| Intel | VAAPI/QSV | H.264, H.265 | 40+ streams @ 1080p |
| CPU fallback | FFmpeg (libavcodec) | All | 5-10 streams @ 1080p |

The pipeline automatically selects the best available decoder. When GPU decoding is available, decoded frames remain in GPU memory, avoiding a GPU-to-CPU-to-GPU round trip for subsequent model inference.

### Model Zoo

The model zoo is a curated registry of pre-tested vision models. Each model entry includes the ONNX weights, preprocessing specification, postprocessing specification, and benchmark results on standard datasets.

#### Supported Model Families

**Object Detection**

| Model | Parameters | Input Size | COCO mAP | Latency (A100) | Use Case |
|-------|-----------|------------|----------|-----------------|----------|
| YOLO-v11-n | 2.6M | 640x640 | 39.5 | 1.2ms | Edge, real-time |
| YOLO-v11-s | 9.4M | 640x640 | 47.0 | 1.8ms | Balanced |
| YOLO-v11-m | 20.1M | 640x640 | 51.5 | 3.4ms | Accuracy-focused |
| YOLO-v11-l | 49.0M | 640x640 | 53.4 | 5.1ms | High accuracy |
| YOLO-v11-x | 56.9M | 640x640 | 54.7 | 7.8ms | Maximum accuracy |
| DETR-ResNet-50 | 41M | 800x800 | 42.0 | 12ms | Transformer-based |
| DETR-ResNet-101 | 60M | 800x800 | 43.5 | 18ms | Transformer-based |
| RT-DETR-l | 32M | 640x640 | 53.0 | 6.2ms | Real-time transformer |

**Segmentation**

| Model | Parameters | Input Size | Metric | Latency (A100) | Use Case |
|-------|-----------|------------|--------|-----------------|----------|
| SAM2-tiny | 38M | 1024x1024 | - | 8ms | Interactive, edge |
| SAM2-small | 46M | 1024x1024 | - | 12ms | Interactive |
| SAM2-base | 80M | 1024x1024 | - | 20ms | General segmentation |
| SAM2-large | 224M | 1024x1024 | - | 35ms | High quality |
| YOLO-v11-seg-l | 50M | 640x640 | 44.6 mask mAP | 6ms | Instance segmentation |

**Classification**

| Model | Parameters | Input Size | ImageNet Top-1 | Latency (A100) |
|-------|-----------|------------|----------------|-----------------|
| EfficientNet-B0 | 5.3M | 224x224 | 77.1% | 0.8ms |
| EfficientNet-B4 | 19M | 380x380 | 82.9% | 2.1ms |
| ConvNeXt-T | 28M | 224x224 | 82.1% | 1.5ms |
| ConvNeXt-B | 89M | 224x224 | 83.8% | 3.2ms |

**OCR**

| Model | Parameters | Languages | Latency (A100) | Use Case |
|-------|-----------|-----------|-----------------|----------|
| PaddleOCR-v4 | 14M | 80+ | 15ms/page | General OCR |
| TrOCR-base | 334M | English | 25ms/line | High-accuracy English |
| EasyOCR | 20M | 80+ | 20ms/page | Lightweight |
| Surya-OCR | 180M | 90+ | 30ms/page | Document-focused |

**Face Recognition**

| Model | Parameters | Embedding Dim | LFW Accuracy | Latency (A100) |
|-------|-----------|--------------|-------------|-----------------|
| ArcFace-R50 | 44M | 512 | 99.5% | 2.5ms |
| ArcFace-R100 | 65M | 512 | 99.8% | 4.0ms |
| AdaFace-R100 | 65M | 512 | 99.8% | 4.2ms |
| RetinaFace-R50 | 27M | - | - | 3.0ms |

**Pose Estimation**

| Model | Parameters | Keypoints | COCO AP | Latency (A100) |
|-------|-----------|-----------|---------|-----------------|
| RTMPose-t | 3.3M | 17 | 68.5 | 1.0ms |
| RTMPose-s | 5.5M | 17 | 72.2 | 1.3ms |
| RTMPose-m | 13.6M | 17 | 75.8 | 2.2ms |
| RTMPose-l | 27.6M | 17 | 76.5 | 3.5ms |
| RTMPose-x | 49.4M | 17 | 78.3 | 5.8ms |

#### Model Format and Optimization

All models in the zoo are stored in ONNX format as the canonical interchange representation. At deployment time, models are optimized for the target hardware:

```
ONNX (canonical)
  |
  +---> TensorRT engine    (NVIDIA GPUs: 2-5x faster than ONNX Runtime)
  +---> CoreML model       (Apple Silicon: Metal acceleration)
  +---> OpenVINO IR        (Intel CPUs/GPUs)
  +---> ONNX Runtime       (CPU fallback, cross-platform)
```

The optimization happens automatically at first load. The optimized model is cached in Object Storage (HIP-0032) keyed by model version, hardware profile, and optimization options (precision, max batch size, workspace size). Subsequent loads on the same hardware use the cached optimized model.

```yaml
model_optimization:
  precision: fp16                    # fp32, fp16, int8
  max_batch_size: 16                 # TensorRT optimization parameter
  workspace_size_mb: 2048            # TensorRT workspace
  calibration_dataset: coco-val-500  # For INT8 calibration
  cache_path: s3://hanzo-vision/model-cache/
```

### Pipeline Configuration

A pipeline is defined as a YAML document that specifies sources, processing stages, privacy policies, and sinks.

#### Complete Pipeline Example

```yaml
apiVersion: vision.hanzo.ai/v1
kind: Pipeline
metadata:
  name: warehouse-safety
  organization: hanzo
  labels:
    environment: production
    site: warehouse-01

spec:
  sources:
    - id: camera-north
      type: rtsp
      url: rtsp://10.0.1.10/stream1
      fps: 30
      decode: gpu                    # GPU-accelerated decoding

    - id: camera-south
      type: rtsp
      url: rtsp://10.0.1.11/stream1
      fps: 30
      decode: gpu

    - id: depth-sensor
      type: ros2
      topic: /realsense/depth/image_rect_raw
      modality: depth

  stages:
    - id: detect_objects
      model: yolo-v11-l
      classes: [person, forklift, pallet, hard_hat, safety_vest]
      confidence: 0.4
      nms_iou: 0.5
      device: gpu:0
      batch_size: auto               # Auto-tune based on GPU memory

    - id: detect_faces
      model: retinaface-r50
      depends_on: detect_objects
      input: crops
      filter: "class == 'person'"    # Only crop person detections
      device: gpu:0

    - id: check_ppe
      type: rule                     # Not a model -- a rule-based stage
      depends_on: detect_objects
      rules:
        - name: hard_hat_required
          condition: "person AND NOT hard_hat WITHIN 50px"
          severity: warning
        - name: vest_required
          condition: "person AND NOT safety_vest WITHIN 50px"
          severity: warning
        - name: forklift_proximity
          condition: "person WITHIN 3m OF forklift"
          severity: critical
          requires: depth-sensor      # Uses depth data for distance

    - id: estimate_depth
      model: depth-anything-v2-small
      sources: [camera-north, camera-south]
      device: gpu:1

    - id: fuse_detections
      type: fusion
      depends_on: [detect_objects, estimate_depth]
      method: project_to_3d          # Project 2D detections into 3D using depth
      camera_intrinsics: s3://hanzo-vision/calibration/warehouse-01/

  privacy:
    face_blur:
      enabled: true
      method: gaussian
      kernel_size: 31
    retention:
      raw_frames: 0h
      detections: 720h

  sinks:
    - id: alerts
      type: stream
      topic: hanzo.vision.alerts.warehouse-01
      filter: "severity IN ('warning', 'critical')"
      format: json

    - id: analytics
      type: stream
      topic: hanzo.vision.detections.warehouse-01
      format: protobuf

    - id: dashboard
      type: grpc
      endpoint: dashboard.internal:50051
      method: StreamDetections

  resources:
    gpu: 2                           # Request 2 GPUs
    memory: 16Gi
    cpu: 8
```

### Output Schemas

All pipeline stages produce structured output conforming to standard schemas. This is what makes the pipeline model-agnostic: regardless of which model produced the result, the output schema is the same.

#### Detection Schema

```protobuf
message Detection {
  string   detection_id  = 1;   // Unique ID
  string   frame_id      = 2;   // Source frame
  string   class_name    = 3;   // e.g., "person", "forklift"
  int32    class_id      = 4;   // Numeric class ID
  float    confidence    = 5;   // [0.0, 1.0]
  BBox     bbox          = 6;   // Bounding box in original image coordinates
  Mask     mask          = 7;   // Optional instance segmentation mask
  repeated Keypoint keypoints = 8;  // Optional pose keypoints
  map<string, string> attributes = 9;  // Model-specific attributes
}

message BBox {
  float x1 = 1;  // Top-left x (pixels, original image coordinates)
  float y1 = 2;  // Top-left y
  float x2 = 3;  // Bottom-right x
  float y2 = 4;  // Bottom-right y
}

message Keypoint {
  string name       = 1;   // e.g., "left_shoulder"
  float  x          = 2;   // x coordinate (pixels)
  float  y          = 3;   // y coordinate (pixels)
  float  confidence = 4;   // [0.0, 1.0]
  bool   visible    = 5;   // Whether the keypoint is visible (not occluded)
}
```

#### OCR Schema

```protobuf
message OCRResult {
  string   frame_id     = 1;
  repeated TextRegion regions = 2;
  string   full_text    = 3;    // All text concatenated in reading order
  string   language     = 4;    // Detected language (ISO 639-1)
}

message TextRegion {
  repeated Point polygon = 1;   // Bounding polygon (4+ points)
  string  text           = 2;   // Recognized text
  float   confidence     = 3;   // [0.0, 1.0]
  int32   line_number    = 4;   // Reading order line number
}
```

#### Face Recognition Schema

```protobuf
message FaceResult {
  string  frame_id       = 1;
  BBox    bbox           = 2;   // Face bounding box
  float   detection_conf = 3;
  repeated float embedding = 4; // Face embedding vector (512-dim)
  string  identity       = 5;   // Matched identity (if gallery provided)
  float   match_score    = 6;   // Similarity to matched identity [0.0, 1.0]
  FaceLandmarks landmarks = 7;  // 5-point or 68-point landmarks
}
```

### REST API

#### Batch Inference

```
POST /v1/inference
Content-Type: multipart/form-data

Parameters:
  image:    binary          (image file)
  model:    string          (model name, e.g., "yolo-v11-l")
  options:  JSON            (model-specific options)

Response:
{
  "request_id": "req_abc123",
  "model": "yolo-v11-l",
  "latency_ms": 12.3,
  "results": {
    "detections": [
      {
        "class": "person",
        "confidence": 0.92,
        "bbox": [120, 80, 350, 420]
      }
    ]
  }
}
```

#### Pipeline Management

```
POST   /v1/pipelines                  Create pipeline from YAML spec
GET    /v1/pipelines                  List pipelines
GET    /v1/pipelines/{id}             Get pipeline status
PUT    /v1/pipelines/{id}             Update pipeline (hot-reload)
DELETE /v1/pipelines/{id}             Stop and remove pipeline
POST   /v1/pipelines/{id}/start       Start a stopped pipeline
POST   /v1/pipelines/{id}/stop        Stop a running pipeline
GET    /v1/pipelines/{id}/metrics     Pipeline performance metrics
GET    /v1/pipelines/{id}/frames      Get recent processed frames (debug)
```

#### Model Management

```
GET    /v1/models                     List available models
GET    /v1/models/{name}              Model details and benchmarks
POST   /v1/models/{name}/load         Load model to GPU
POST   /v1/models/{name}/unload       Unload model from GPU
GET    /v1/models/status              GPU memory usage per model
POST   /v1/models/import              Import custom ONNX model
```

### Video Analytics

Video analytics extends the base pipeline with temporal reasoning -- understanding what happens across frames, not just within a single frame.

#### Object Tracking

The pipeline includes multi-object tracking (MOT) as a built-in stage. Tracking assigns persistent IDs to detections across frames, enabling counting, trajectory analysis, and re-identification.

```yaml
stages:
  - id: detect
    model: yolo-v11-l
    classes: [person, vehicle]

  - id: track
    type: tracker
    depends_on: detect
    algorithm: botsort             # botsort, bytetrack, ocsort
    max_age: 30                    # Frames before track is deleted
    min_hits: 3                    # Detections before track is confirmed
    iou_threshold: 0.3             # Association threshold
    reid_model: osnet-ain-x1.0    # Re-identification model (optional)
```

#### Event Detection

Events are temporal patterns defined over tracked objects:

```yaml
events:
  - name: zone_intrusion
    type: zone_crossing
    zone:
      polygon: [[100,200], [400,200], [400,500], [100,500]]
    trigger: enter                  # enter, exit, dwell
    classes: [person]
    cooldown: 30s                   # Suppress duplicate alerts

  - name: abandoned_object
    type: stationary
    duration: 300s                  # Object stationary for 5 minutes
    classes: [backpack, suitcase, bag]

  - name: crowd_formation
    type: density
    threshold: 10                   # 10+ people per 100 sq meters
    area: 100                       # Square meters (requires calibration)

  - name: anomaly
    type: anomaly_detection
    model: video-anomaly-v1
    threshold: 0.8                  # Anomaly score threshold
    temporal_window: 64             # Frames of history
```

### Integration with Jin (HIP-0003)

Jin provides vision-language models that combine visual understanding with natural language. The Vision Pipeline integrates with Jin for tasks that require both modalities:

1. **Visual question answering**: "Is anyone in this frame not wearing a hard hat?" The pipeline extracts the frame, Jin processes the image with the question, and returns a natural language answer.

2. **Image captioning**: Generate natural language descriptions of scenes for accessibility, logging, or search indexing.

3. **Open-vocabulary detection**: Instead of detecting only predefined classes, describe what to find in natural language. "Find all red objects on the conveyor belt." Jin's CLIP-based vision encoder matches the description against image regions.

4. **Grounded conversation**: Combine detection results with Jin's language model for contextual understanding. The pipeline provides structured detections; Jin reasons about them in natural language.

```yaml
stages:
  - id: detect
    model: yolo-v11-l

  - id: describe_scene
    type: jin
    depends_on: detect
    model: jin-base
    prompt: |
      Describe the warehouse scene. Note any safety concerns.
      Detected objects: {detections}
    output: text
```

### Integration with Engine (HIP-0043)

The Vision Pipeline does not run inference directly. It delegates inference to Engine (HIP-0043), which manages GPU resources, model loading, request batching, and multi-model scheduling.

The integration is transparent: the pipeline sends inference requests to Engine via gRPC, Engine returns results. From the pipeline's perspective, inference is a remote procedure call. From Engine's perspective, the Vision Pipeline is just another client.

This separation matters for resource management. A single Engine instance can serve multiple pipelines, multiple batch inference endpoints, and the LLM Gateway simultaneously. Engine handles the GPU scheduling; the Vision Pipeline handles the vision-specific preprocessing and postprocessing.

```yaml
engine:
  endpoint: engine.internal:50051    # Engine gRPC endpoint
  timeout: 100ms                     # Inference timeout
  retry:
    max_attempts: 2
    backoff: 10ms
```

### Integration with Edge (HIP-0050)

For edge-deployed vision models (security cameras at retail locations, robot onboard processors, mobile devices), the pipeline supports a lightweight Edge Runtime that runs on devices without datacenter GPUs.

Edge-deployed models are optimized for the target hardware:

| Target | Runtime | Optimization | Typical Models |
|--------|---------|-------------|----------------|
| NVIDIA Jetson | TensorRT | INT8, FP16 | YOLO-n/s, RTMPose-t/s |
| Apple Neural Engine | CoreML | FP16 | YOLO-n/s, EfficientNet |
| Qualcomm NPU | QNN | INT8 | YOLO-n, MobileNet |
| CPU (x86/ARM) | ONNX Runtime | INT8 | YOLO-n, EfficientNet-B0 |

The Edge Runtime uses the same pipeline YAML configuration as the datacenter version, but with an edge-specific resource profile. A pipeline developed and tested in the datacenter can be deployed to the edge by changing the resource section:

```yaml
resources:
  runtime: edge
  device: jetson-orin-nano
  power_budget: 15W               # Power-constrained optimization
  max_latency: 50ms               # Hard latency bound
```

### Integration with Robotics (HIP-0080)

Robot perception is the most demanding vision use case: multiple sensors, hard real-time constraints, and tight integration with control systems.

The Vision Pipeline integrates with the Robotics framework through ROS 2:

1. **Sensor input**: The pipeline subscribes to ROS 2 image, depth, and point cloud topics. It handles time synchronization across sensors using the ROS 2 message timestamp, not wall clock time.

2. **Perception output**: Detection, segmentation, and depth results are published to ROS 2 topics that the robot's navigation and manipulation planners subscribe to.

3. **Calibration**: Camera intrinsic and extrinsic parameters are loaded from ROS 2 camera_info topics or from calibration files. The pipeline uses these to project 2D detections into the robot's 3D coordinate frame.

4. **Sensor fusion**: For robots with multiple cameras and depth sensors, the pipeline fuses detections from all sensors into a single 3D world model. Overlapping fields of view produce deduplicated detections with higher confidence.

```yaml
sources:
  - id: front_camera
    type: ros2
    topic: /front_camera/image_raw
    camera_info: /front_camera/camera_info
    modality: video

  - id: front_depth
    type: ros2
    topic: /front_camera/depth/image_rect_raw
    modality: depth

  - id: lidar
    type: ros2
    topic: /velodyne_points
    modality: pointcloud

sinks:
  - id: perception
    type: ros2
    topic: /vision/detections
    message_type: vision_msgs/Detection3DArray
    frame_id: base_link            # TF frame for 3D coordinates
```

### Annotation and Labeling Pipeline

Training vision models requires labeled data. The annotation pipeline provides AI-assisted labeling that reduces human effort by 5-10x.

#### Workflow

```
Raw Images/Video
      |
      v
  AI Pre-label (run detection/segmentation models on unlabeled data)
      |
      v
  Human Review (correct AI predictions in labeling UI)
      |
      v
  Quality Check (consensus scoring, inter-annotator agreement)
      |
      v
  Export to Dataset (COCO, Pascal VOC, YOLO format)
      |
      v
  ML Pipeline (HIP-0057) for model training
```

AI-assisted labeling works by running the current best model on unlabeled data, converting its predictions to draft annotations, and presenting them to human annotators for correction. For mature models with >90% accuracy, the annotator only needs to fix the ~10% of errors, rather than drawing every bounding box from scratch.

#### Supported Export Formats

| Format | Structure | Use Case |
|--------|-----------|----------|
| COCO JSON | Single JSON with image list + annotations | Standard benchmark format |
| Pascal VOC XML | Per-image XML annotation files | Legacy compatibility |
| YOLO TXT | Per-image text files (class cx cy w h) | YOLO training |
| LabelMe JSON | Per-image JSON polygons | Segmentation labeling |
| CVAT XML | CVAT project export | CVAT interop |

### Data Format Standards

#### Image Formats

| Format | Channels | Depth | Compression | Use Case |
|--------|----------|-------|-------------|----------|
| JPEG | RGB | 8-bit | Lossy | General photography |
| PNG | RGB/RGBA | 8/16-bit | Lossless | Screenshots, synthetic |
| WebP | RGB/RGBA | 8-bit | Lossy/Lossless | Web delivery |
| TIFF | Any | 8/16/32-bit | Optional | Scientific imaging |
| EXR | Any | 16/32-bit float | Lossless | HDR, depth maps |
| NV12/I420 | YUV | 8-bit | None | Video frame decode |

#### 3D Formats

| Format | Contents | Use Case |
|--------|----------|----------|
| PLY | Points + normals + colors | Point cloud exchange |
| PCD | Points + fields | ROS/PCL standard |
| LAS/LAZ | Points + classification | LiDAR data |
| NumPy (.npy) | Raw tensor | Fast I/O |

### Metrics and Observability

The pipeline exposes Prometheus metrics on port 8081 at `/metrics`:

```
# Pipeline throughput
hanzo_vision_frames_processed_total{pipeline, source, stage}
hanzo_vision_frames_dropped_total{pipeline, source, reason}

# Latency
hanzo_vision_stage_latency_seconds{pipeline, stage, quantile}
hanzo_vision_pipeline_latency_seconds{pipeline, quantile}
hanzo_vision_inference_latency_seconds{model, quantile}

# GPU utilization
hanzo_vision_gpu_utilization{device}
hanzo_vision_gpu_memory_used_bytes{device}
hanzo_vision_gpu_memory_total_bytes{device}
hanzo_vision_model_memory_bytes{model}

# Detection quality
hanzo_vision_detections_total{pipeline, stage, class}
hanzo_vision_detection_confidence{pipeline, stage, class, quantile}

# Stream health
hanzo_vision_source_fps{pipeline, source}
hanzo_vision_source_latency_seconds{pipeline, source}
hanzo_vision_source_reconnects_total{pipeline, source}

# Privacy
hanzo_vision_faces_blurred_total{pipeline}
hanzo_vision_pii_detected_total{pipeline, type}
```

### Security Considerations

#### Access Control

All API endpoints require authentication via Hanzo IAM (HIP-0001). Pipelines are scoped to organizations. A pipeline in organization "acme" cannot access models, galleries, or streams owned by organization "hanzo."

Camera credentials (RTSP URLs with embedded passwords) are stored as Hanzo KMS secrets (HIP-0005), never in pipeline YAML. The pipeline references secrets by name:

```yaml
sources:
  - id: camera-01
    type: rtsp
    url: kms://hanzo-vision/camera-01-url    # Resolved at runtime from KMS
```

#### Model Supply Chain

Models in the zoo are signed with Ed25519 keys. The signature covers the ONNX weights, preprocessing spec, and benchmark results. The pipeline verifies signatures before loading a model. This prevents a compromised Object Storage bucket from serving a poisoned model.

Custom models uploaded via the import API undergo basic safety checks: tensor shape validation, weight distribution analysis (detecting NaN/Inf), and a test inference on a standard input. These checks do not guarantee safety but catch common corruption and basic adversarial weights.

#### Frame Data Security

Raw video frames are the most sensitive data in the pipeline. They are:

- Never written to disk unless explicitly configured (e.g., for debugging)
- Held in memory only for the duration of processing (typically <100ms)
- Encrypted in transit between pipeline components using mTLS
- Subject to the privacy policies defined in the pipeline configuration

## Backward Compatibility

This is a new standard. There are no existing Hanzo Vision deployments to maintain compatibility with.

The output schemas (Detection, OCRResult, FaceResult) are versioned. Future schema changes will be additive (new optional fields). Removing or renaming fields requires a new major schema version with a migration period.

The pipeline YAML format follows Kubernetes conventions (`apiVersion`, `kind`, `metadata`, `spec`). Future versions will increment the API version (e.g., `vision.hanzo.ai/v2`) and support conversion webhooks for automatic migration.

## Reference Implementation

The reference implementation is at [github.com/hanzoai/vision](https://github.com/hanzoai/vision).

### Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Pipeline runtime | Rust | Memory safety, zero-cost abstractions, GPU interop via cudarc |
| API server | Rust (axum) | Async, low overhead, same binary |
| Video decoding | FFmpeg + NVDEC/VAAPI bindings | Industry standard, hardware acceleration |
| Inference | ONNX Runtime + TensorRT | Cross-platform + NVIDIA optimization |
| Preprocessing | GPU kernels (CUDA/Metal) | Avoid CPU-GPU transfers |
| Streaming | gRPC streams + Hanzo Stream | Low latency + durable delivery |
| Configuration | YAML + JSON Schema validation | Human-readable, machine-validatable |

### Directory Structure

```
vision/
  cmd/
    hanzo-vision/          # Main binary entry point
  pkg/
    pipeline/              # Pipeline runtime and DAG scheduler
    source/                # Source implementations (RTSP, V4L2, ROS2, etc.)
    stage/                 # Processing stage implementations
    sink/                  # Sink implementations (Stream, gRPC, webhook)
    model/                 # Model loading, optimization, and caching
    preprocess/            # GPU-accelerated preprocessing kernels
    postprocess/           # NMS, coordinate transform, schema mapping
    privacy/               # Face blur, PII detection, consent
    tracking/              # Multi-object tracking algorithms
    annotation/            # AI-assisted labeling pipeline
    fusion/                # Multi-sensor fusion
  api/
    proto/                 # Protobuf definitions
    openapi/               # OpenAPI spec for REST endpoints
  models/
    zoo/                   # Model zoo manifests (YAML per model)
  deploy/
    docker/                # Dockerfile and compose files
    k8s/                   # Kubernetes manifests
    edge/                  # Edge deployment configs (Jetson, etc.)
  tests/
    integration/           # Pipeline integration tests
    benchmark/             # Performance benchmarks
    data/                  # Test images and videos
```

### Build and Run

```bash
# Build
cargo build --release

# Run with config
./target/release/hanzo-vision --config pipeline.yaml

# Docker
docker run -d \
  --gpus all \
  -p 8081:8081 \
  -v /path/to/pipelines:/etc/hanzo-vision/pipelines \
  ghcr.io/hanzoai/vision:latest

# Kubernetes
kubectl apply -f deploy/k8s/vision-deployment.yaml
```

## Test Vectors

### Minimum Viable Pipeline

A pipeline that reads an image from disk, runs YOLO detection, and writes results to stdout:

```yaml
apiVersion: vision.hanzo.ai/v1
kind: Pipeline
metadata:
  name: test-detection
spec:
  sources:
    - id: input
      type: file
      path: /data/test.jpg
  stages:
    - id: detect
      model: yolo-v11-n
      confidence: 0.25
  sinks:
    - id: output
      type: stdout
      format: json
```

Expected output for a test image containing one person and one car:

```json
{
  "frame_id": "frm_001",
  "detections": [
    {
      "class": "person",
      "confidence": 0.87,
      "bbox": [120, 80, 350, 420]
    },
    {
      "class": "car",
      "confidence": 0.93,
      "bbox": [500, 200, 900, 450]
    }
  ]
}
```

### Preprocessing Correctness

The preprocessing pipeline must produce bit-identical output for the same input across runs (deterministic). The test suite includes reference input/output pairs for each preprocessing step:

| Test | Input | Expected Output |
|------|-------|-----------------|
| Resize (letterbox) | 1920x1080 RGB | 640x640 with 60px top/bottom padding |
| Color convert (YUV->RGB) | NV12 frame | RGB with CCIR 601 coefficients |
| Normalize (ImageNet) | [0-255] uint8 | float32, mean-subtracted, std-divided |
| Batch (2 images) | Two 640x640 RGB | [2, 3, 640, 640] NCHW tensor |

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
