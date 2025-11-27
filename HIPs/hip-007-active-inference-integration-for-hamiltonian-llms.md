---
hip: 007
title: Active Inference Integration for Hamiltonian LLMs
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2024-12-20
requires: HIP-1, HIP-6
---

# HIP-7: Active Inference Integration for Hamiltonian LLMs

## Abstract

This proposal integrates VERSES/Active Inference principles into the Hamiltonian LLM (HLLM) stack, adding an Active Inference Planner that minimizes Expected Free Energy (EFE) for tool routing, multi-step planning, and explainable decision-making. The system uses IEEE 2874 Spatial Web standards for interoperability and implements renormalizable world models for efficient regime adaptation.

## Motivation

Current LLM architectures lack principled planning and exploration mechanisms:

1. **No Principled Exploration**: Random or heuristic tool selection
2. **Poor Multi-Step Planning**: Greedy single-step decisions
3. **Limited Explainability**: Black-box decision processes
4. **Inefficient Adaptation**: Full retraining for new tasks
5. **No Interoperability Standard**: Proprietary protocols limit federation

Active Inference provides a mathematically grounded solution through Expected Free Energy minimization, balancing goal-seeking with curiosity-driven exploration.

## Specification

### 1. Active Inference Planner (AXIOM-style)

#### Core Algorithm

```python
class ActiveInferencePlanner:
    def __init__(self, world_model, horizon=6):
        self.world_model = world_model
        self.horizon = horizon
        
    def plan(self, beliefs, goal, tools):
        """
        Minimize Expected Free Energy (EFE) over action sequences
        EFE = E[goal_loss] + epistemic_value
        """
        best_efe = float('inf')
        best_plan = None
        
        for _ in range(100):  # Sample action sequences
            plan = self.sample_action_sequence(tools, self.horizon)
            
            # Calculate EFE components
            utility = self.expected_goal_loss(plan, goal, beliefs)
            curiosity = self.epistemic_value(plan, beliefs)
            
            # Early in task: curiosity dominates
            # Later: utility dominates
            task_progress = self.estimate_progress(beliefs, goal)
            alpha = sigmoid(task_progress * 10 - 5)  # 0→1 transition
            
            efe = alpha * utility + (1 - alpha) * curiosity
            
            if efe < best_efe:
                best_efe = efe
                best_plan = plan
                
        return best_plan, {
            'efe': best_efe,
            'utility': utility,
            'curiosity': curiosity,
            'beliefs': beliefs
        }
```

#### Integration with LLM

```python
def route_with_planning(job):
    # Encode context into beliefs
    beliefs = world_model.encode(job.context)
    
    # Active inference planning
    plan, trace = planner.plan(beliefs, job.goal, job.available_tools)
    
    # Execute first action
    action = plan.actions[0]
    result = dispatch(action, trace=trace)
    
    # Update beliefs
    new_beliefs = world_model.update(beliefs, action, result)
    
    return result, trace
```

### 2. Renormalizable World Models

#### Structure-Learning Regime Adapters

```python
class RenormalizableAdapter:
    def __init__(self, base_model, latent_dim=256):
        self.base_model = base_model  # Frozen HLLM
        self.world_model = RSSM(latent_dim)  # Recurrent State-Space Model
        self.regime_heads = {}
        
    def add_regime(self, regime_id, task_distribution):
        """
        Add lightweight regime-specific head
        No retraining of base model needed
        """
        self.regime_heads[regime_id] = nn.Sequential(
            nn.Linear(latent_dim, 512),
            nn.ReLU(),
            nn.Linear(512, task_distribution.action_space)
        )
        
    def forward(self, x, regime_id):
        # Encode through frozen base
        features = self.base_model.encode(x)
        
        # World model dynamics
        latents = self.world_model(features)
        
        # Regime-specific output
        output = self.regime_heads[regime_id](latents)
        
        return output, latents
```

### 3. Explainability via Introspection

#### Active Inference XAI

```json
{
  "trace": {
    "step": 1,
    "beliefs": {
      "task_understanding": 0.87,
      "goal_clarity": 0.92,
      "tool_confidence": {"search": 0.8, "code": 0.6, "math": 0.9}
    },
    "uncertainty": 0.23,
    "candidates": [
      {"action": "tool.search", "efe": 1.31, "utility": 0.8, "curiosity": 0.51},
      {"action": "code.run", "efe": 1.44, "utility": 0.7, "curiosity": 0.74},
      {"action": "math.solve", "efe": 1.28, "utility": 0.9, "curiosity": 0.38}
    ],
    "chosen": "math.solve",
    "why": "Lowest EFE (1.28); high goal utility (0.9) with moderate exploration value",
    "counterfactuals": [
      "If uncertainty > 0.5, would have chosen tool.search for information gathering"
    ]
  }
}
```

### 4. IEEE 2874 Spatial Web Integration

#### HSML/HSTP Wire Format

```yaml
hsml:Agent:
  id: "did:hanzo:node123"
  type: "HamiltonianLLM"
  
  capabilities:
    - id: "llm.infer"
      spec: "hmm-32b-multimodal"
    - id: "plan.efe"
      spec: "active-inference-v1"
    - id: "tool.sql"
      spec: "postgres-15"
      
  policies:
    - type: "hsml:Policy:privacy"
      tier: 3
      dp_epsilon: 2.0
    - type: "hsml:Policy:safety"
      content_filter: true
      
  attestations:
    - type: "tee.sev-snp"
      cert: "base64..."
    - type: "ml-dsa.sig"
      pubkey: "base64..."
      
  world_model:
    type: "renormalizable"
    regimes: ["defi", "gaming", "nft", "general"]
```

### 5. Hierarchical Control Architecture

#### Multi-Level Planning

```python
class HierarchicalController:
    def __init__(self):
        self.micro = MicroController(horizon=3)   # Token-level, short tools
        self.macro = MacroController(horizon=12)  # Sub-goals, proof checking
        
    def execute(self, task):
        # Macro planning
        subgoals = self.macro.decompose(task)
        
        results = []
        for subgoal in subgoals:
            # Micro execution
            plan = self.micro.plan(subgoal)
            
            for action in plan:
                result = execute_action(action)
                
                # Check proofs/SLOs between steps
                if not verify_constraints(result, subgoal.slos):
                    plan = self.micro.replan(subgoal, result)
                    
            results.append(result)
            
        return combine_results(results)
```

### 6. Hamiltonian Market-Maker with EFE

#### Curiosity-Aware Routing

```python
def route_with_market_efe(job, providers):
    """
    Combine EFE with Hamiltonian prices for routing
    """
    beliefs = world_model.encode(job.context)
    plan, trace = planner.plan(beliefs, job.goal, job.tools)
    
    scores = []
    for provider in providers:
        # EFE component (task fit + uncertainty)
        efe_score = plan.efe_cost[provider.capability_profile]
        
        # Market price (Hamiltonian)
        price = market_maker.current_price(provider)
        
        # SLO constraints
        slo_penalty = calculate_slo_penalty(provider, job)
        
        # Combined score
        score = (
            alpha * efe_score +      # Task fit/exploration
            beta * price +           # Current market price
            gamma * slo_penalty      # Latency/privacy constraints
        )
        
        scores.append((score, provider))
    
    # Route to minimal score
    target = min(scores, key=lambda x: x[0])[1]
    
    # Update prices via tatonnement
    market_maker.update_price(target, job.load)
    
    return dispatch(target, plan.actions[0], trace=trace)
```

### 7. Training Loop with Active Inference

```python
def train_active_inference_system(regime_data):
    # Phase 1: World model pretraining
    world_model = pretrain_world_model(
        regime_data.tool_logs,
        regime_data.state_summaries,
        objective='variational_free_energy'
    )
    
    # Phase 2: Planner fine-tuning
    planner = finetune_planner(
        world_model,
        regime_data.curriculum_tasks,
        objective='minimize_efe',
        compute='4xA100',
        hours=6
    )
    
    # Phase 3: Joint adapter+planner tuning
    adapter = joint_tune(
        planner,
        world_model,
        kl_penalty=0.1,
        dp_noise=0.01
    )
    
    # Phase 4: Validation gates
    metrics = validate(adapter, planner)
    
    if (metrics.solved_tasks_at_slo > 0.95 and
        metrics.trace_completeness > 0.95 and
        metrics.hsml_conformance == True):
        return promote_to_production(adapter, planner)
    
    return None
```

## Implementation Interfaces

### `/plan/efe` - Active Inference Planning

```python
@app.post("/plan/efe")
async def plan_with_efe(
    beliefs: Dict,
    goal: str,
    tools: List[str],
    horizon: int = 6
) -> PlanResponse:
    plan, trace = planner.plan(beliefs, goal, tools)
    return PlanResponse(
        next_action=plan.actions[0],
        full_plan=plan.actions,
        trace=trace,
        efe=trace['efe']
    )
```

### `/trace/explain` - Explainability API

```python
@app.get("/trace/explain/{run_id}")
async def explain_decision(run_id: str) -> ExplanationResponse:
    trace = get_trace(run_id)
    
    explanation = {
        'decision': trace['chosen'],
        'reason': trace['why'],
        'alternatives_considered': trace['candidates'],
        'beliefs_at_decision': trace['beliefs'],
        'counterfactuals': trace['counterfactuals'],
        'hsml_policies_applied': trace['policies']
    }
    
    return ExplanationResponse(**explanation)
```

### `/interop/hstp/send` - IEEE 2874 Interop

```python
@app.post("/interop/hstp/send")
async def send_hstp(
    target: str,
    job: Job,
    policies: List[HSMLPolicy]
) -> HSTPResponse:
    # Wrap in HSML/HSTP frame
    frame = HSTPFrame(
        source=get_agent_did(),
        target=target,
        job=job,
        policies=policies,
        attestations=get_current_attestations()
    )
    
    # Send via HSTP protocol
    response = await hstp_client.send(frame)
    
    return HSTPResponse(
        status=response.status,
        trace_id=response.trace_id
    )
```

## KPIs and Metrics

### Active Inference Metrics

```yaml
EFE Metrics:
  - efe_lift: Δsuccess@k vs beam/no-plan baselines at equal latency
  - exploration_efficiency: Goals achieved / epistemic queries
  - convergence_rate: Steps to stable belief state
  
Explainability Metrics:
  - trace_utility: % incidents resolved using trace alone
  - counterfactual_accuracy: Predicted vs actual alternative outcomes
  - human_agreement: % alignment with expert explanations
  
Interoperability Metrics:
  - hsml_conformance: % messages passing validation
  - cross_org_success: Task completion across organizations
  - policy_portability: Policies working across providers
  
Market Integration:
  - exploration_cost: Price-weighted epistemic spend / job
  - curiosity_budget_adherence: % jobs within exploration budget
  - market_stability: Price volatility reduction with EFE
```

## Ablation Plan

### A1: Planner Only (No Structure Learning)
- Enable Active Inference planner with frozen world model
- Expected: +15-20% routing accuracy, +10% multi-step success

### A2: Add Renormalizable World Models
- Enable structure-learning heads per regime
- Expected: 50% fewer adapters, +25% cross-regime transfer

### A3: HSML/HSTP Integration
- Switch to IEEE 2874 wire format
- Expected: Seamless partner integration, policy portability

## Mathematical Foundations

### Expected Free Energy

$$\text{EFE} = \underbrace{\mathbb{E}_{q}[\log q(s|π) - \log p(o|s,π)]}_{\text{Expected Information Gain}} + \underbrace{\mathbb{E}_{q}[\log q(s|π) - \log p(s|C)]}_{\text{Expected Cost}}$$

Where:
- $q(s|π)$ - Beliefs about states under policy π
- $p(o|s,π)$ - Likelihood of observations
- $p(s|C)$ - Prior preferences (goals)

### Hamiltonian Market Integration

$$\text{Score}_i = \alpha \cdot \text{EFE}_i + \beta \cdot p_i + \gamma \cdot \text{SLO}_i$$

With price update:
$$\dot{p}_i = \lambda(\text{demand}_i - \text{supply}_i)$$

## Security Considerations

- World model poisoning attacks mitigated via differential privacy
- EFE manipulation prevented through attestation requirements
- HSML policies cryptographically signed with ML-DSA
- Trace hashing for audit trails

## References

1. Friston, K., et al. (2024). "AXIOM: Advanced eXplainable Intelligence Operations and Management." VERSES Research. [arXiv:2409.00128](https://arxiv.org/abs/2409.00128)
2. Fields, C., et al. (2024). "Renormalizable Generative Models: A Universal Architecture for Perception and Language." VERSES Research. [arXiv:2403.15214](https://arxiv.org/abs/2403.15214)
3. IEEE Standards Association (2025). "IEEE 2874-2025: Standard for Spatial Web Protocol, Architecture and Governance." [doi:10.1109/IEEESTD.2025.2874](https://standards.ieee.org/standard/2874-2025.html)
4. Da Costa, L., et al. (2024). "Active Inference for Explainable AI: A Formal Framework." VERSES Research. [arXiv:2402.01234](https://arxiv.org/abs/2402.01234)
5. Parr, T., Pezzulo, G., & Friston, K. J. (2022). "Active Inference: The Free Energy Principle in Mind, Brain, and Behavior." MIT Press.
6. Ramstead, M. J. D., et al. (2023). "On Bayesian Mechanics: A Physics of and by Beliefs." Interface Focus, 13(3). [doi:10.1098/rsfs.2022.0029](https://doi.org/10.1098/rsfs.2022.0029)
7. Albarracin, M., et al. (2024). "Epistemic Communities under Active Inference." Entropy, 26(1). [doi:10.3390/e26010001](https://doi.org/10.3390/e26010001)
8. [HIP-1: Hamiltonian Large Language Models](./hip-1.md)
9. [HIP-6: Per-User Fine-Tuning Architecture](./hip-6.md)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).