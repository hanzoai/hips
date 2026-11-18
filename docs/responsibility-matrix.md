# Hanzo Dō: Repository Responsibility Matrix

This matrix maps current repository functionality to the target Hanzo Dō architecture, identifying boundaries and necessary refactorings.

## Repository Responsibility Matrix

| Component | Current Audit Focus | Target Responsibility | Migration Note |
| :--- | :--- | :--- | :--- |
| **Sutra** | HIPs, OpenAPI, Schemas | Curated AI OS standards/conformance | No new impl; use existing HIPs + new Manifest |
| **Kata** | Harness logic, coding triage, execution | Reproducible harness, lifecycle, supervision | Move coding triage to Dev |
| **Gen** | Launching, routing, integrations | Generic agent engine and reasoning loop | Deprecate launching logic into Kata |
| **Dev** | Agent loop, repo tools, patches | Coding-specialized agent (on Gen) | Retain specialized coding intelligence |
| **Dojo** | Sandboxed execution, isolation | Universal sandbox interface (Visor backend) | Alias Visor as implementation |
| **Enso** | Model routing | Model orchestration/cascades | Retain as independent layer |
| **Engines** | Training/Inference | Model-training/Kernel layers | Keep orthogonal to agent loop |
| **Karma** | (New) | Lineage, proof, reputation ledger | Implement new observability hook |

## Audit Summary
- **Overlap**: Kata and Gen both currently contain "harness" and "agent" logic. 
- **Decoupling**: We need to extract the "triage" logic from `hanzo/kata` and the "launcher" logic from `hanzo/gen`.
- **Dojo**: `hanzo/visor` will serve as the core runtime.
