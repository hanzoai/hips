---
hip: 0400
title: Service CRD
author: Hanzo Platform Team
type: Standards Track
category: Operator
status: Final
created: 2026-05-19
---

# HIP-400: Service CRD

## Abstract

The `Service` CRD models a generic stateless workload backed by a container image. It is the default abstraction for any HTTP/gRPC service that does not need persistent storage. The operator materializes a `Service` CR into a `Deployment`, a `Service`, and optionally an `Ingress`, `HorizontalPodAutoscaler`, `PodDisruptionBudget`, `NetworkPolicy`, and `KMSSecret`. The `Service` Kind is the canonical replacement for the legacy `HanzoService` (v1alpha1) alias.

## Specification

### Group + version

`hanzo.ai/v1` (also `lux.cloud/v1`, `zoo.cloud/v1`, `osage.cloud/v1` when the operator is installed with `--api-group`).

### Spec fields

| Field | Type | Description |
|---|---|---|
| `image` | ImageSpec | repository, tag, pullPolicy |
| `replicas` | int | desired Pod count |
| `ports` | []ServicePort | name, containerPort, servicePort |
| `env` | []EnvVar | environment variables (load-bearing — must be honored) |
| `envFrom` | []EnvFromSource | secret/configmap-derived envs |
| `volumes` | []Volume | Pod volumes (load-bearing) |
| `volumeMounts` | []VolumeMount | container mounts (load-bearing) |
| `resources` | ResourceRequirements | requests/limits |
| `livenessProbe` | ProbeSpec | liveness probe |
| `readinessProbe` | ProbeSpec | readiness probe |
| `ingress` | IngressSpec | optional Ingress |
| `autoscaling` | AutoscalingSpec | optional HPA |
| `pdb` | PodDisruptionBudgetSpec | optional PDB |
| `networkPolicy` | NetworkPolicySpec | optional NetworkPolicy |
| `serviceMonitor` | ServiceMonitorSpec | optional Prometheus scrape |
| `kmsSecrets` | []KMSSecretRef | KMS-sourced secret mounts |
| `sidecars` | []Container | sidecar containers |
| `initContainers` | []Container | init containers |
| `imagePullSecrets` | []LocalObjectReference | registry creds |
| `serviceAccountName` | string | SA name |
| `strategy` | string | RollingUpdate / Recreate |
| `command`, `args` | []string | entrypoint overrides |

### Example CR

```yaml
apiVersion: hanzo.ai/v1
kind: Service
metadata:
  name: example
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/example
    tag: v1.2.3
  replicas: 2
  ports:
    - name: http
      containerPort: 8080
      servicePort: 80
  env:
    - name: LOG_LEVEL
      value: info
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits:   { cpu: 1,    memory: 1Gi }
```

### Generated K8s resources

- `Deployment`
- `Service` (ClusterIP)
- `Ingress` (if `spec.ingress`)
- `HorizontalPodAutoscaler` (if `spec.autoscaling`)
- `PodDisruptionBudget` (if `spec.pdb`)
- `NetworkPolicy` (if `spec.networkPolicy`)
- `KMSSecret` cross-references (if `spec.kmsSecrets`)
- `ServiceMonitor` (if `spec.serviceMonitor`)

### Operator reconciler

- Rust: `~/work/hanzo/operator/src/controllers/service.rs`
- Go parity: deprecated, see `legacy/go-impl-before-rust-port`.

Invariant: `env`, `envFrom`, `volumes`, `volumeMounts` must round-trip from CR to Pod template. Asserted by `controllers::service::tests`.

### Related services

Every facade Kind (`IAM`, `KMS`, `LLM`, `Indexer`, `Explorer`) delegates to the `Service` reconciler. The vast majority of CRs in `~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/` are `Service`-shaped.

## Status

Implemented in `hanzoai/operator` v0.3.0+. Active in cluster `do-sfo3-hanzo-k8s` for 40+ workloads.
