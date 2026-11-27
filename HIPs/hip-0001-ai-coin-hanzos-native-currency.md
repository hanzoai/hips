---
hip: "0001"
title: AI Coin - Hanzo Network's Native Currency
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
created: 2024-12-20
updated: 2026-11-27
---


# HIP-0001: AI Coin - Hanzo Network's Native Currency

## Abstract

This proposal defines the `$AI` coin, Hanzo Network's native Layer-1 cryptocurrency that powers the open AI compute economy. `$AI` serves as native gas and settlement currency on Hanzo Network (`Chain ID 36963` mainnet / `36962` testnet), incentivizes compute providers and validators via Proof of AI (PoAI), enables AI service payments, and governs the Hanzo Network protocol.

**Canonical Tokenomics (Reconciled November 16, 2026)**: The earlier draft parameter of `1,000,000,000 $AI` (1B) on an L2 ERC-20 is superseded by the canonical native L1 supply specification below (`2,000,000,000,000 $AI` hard cap = `1T` DAO + `1T` Proof of AI mining and validator rewards).

## Specification

### Canonical Tokenomics Parameters

| Parameter | Canonical Value |
| --- | --- |
| Symbol | `$AI` |
| Asset type | Native Hanzo Network L1 coin (18 decimals) |
| Maximum protocol supply | `2,000,000,000,000` (2T `$AI`, hard-capped) |
| DAO allocation | `1,000,000,000,000` (1T `$AI`, fixed at genesis; never mined) |
| Proof of AI mining & validator allocation | `1,000,000,000,000` (1T `$AI`, earned strictly by proved work) |
| Mainnet Chain ID | `36963` |
| Testnet Chain ID | `36962` |

### Genesis Reference-Price & Daily Supply Schedule (`$AI Genesis`)

The public-sale pool is drawn from the `1,000,000,000,000 $AI` (`1T`) DAO allocation (distinct from the protocol's `2T` hard supply cap). Unsold daily supply never rolls over into subsequent windows.

| Parameter | Canonical Value |
| --- | --- |
| Public-sale pool ceiling | `1,000,000,000,000 $AI` (`1T` DAO allocation) |
| Initial reference price (Day 0) | `$0.00001` per `$AI` (`1e13` USD18) |
| Initial allocation per USD | `100,000 $AI` |
| Initial implied FDV (arithmetic) | `$20M` |
| Daily price increment | `+$0.0000001` (`+1%` of initial reference price per day, simple) |
| Pricing windows | `369` (Day `0` through Day `368`) |
| Final reference price (Day 368) | `$0.0000468` per `$AI` (`468e11` USD18) |
| Final implied FDV (arithmetic) | `$93.6M` |
| Day 0 supply cap | `10%` of sale pool (`100B $AI`; `$1,000,000` USD cap at Day 0 price) |
| Days 1–368 supply curve | Remaining `90%` (`900B $AI`) via inverse-price taper (`~5.79B` on Day 1 → `~1.25B` on Day 368; steady `~$58,465/day` USD cap; zero rollover) |
| Resale restriction / lockup | Fixed `182` days (`26` weeks) per independent delivery tranche; locked `$AI` may be spent directly on allowlisted Hanzo compute billing contracts while peer transfers remain blocked |

*Note: Implied FDV figures are arithmetic products of the scheduled reference price and the 2T hard supply cap; they are not independently established market valuations or projected returns. Secondary markets trade independently in parallel.*

### Protocol Issuance & Distribution

```yaml
Protocol Supply (Hard Cap: 2,000,000,000,000 $AI):
  DAO Allocation: 50% (1,000,000,000,000 $AI)
    - Fixed at genesis; can never be mined
    - Funds public genesis distribution (sub-allocation ceiling distinct from 2T max supply),
      ecosystem grants, liquidity, and protocol treasury under Hanzo DAO governance

  Proof of AI Mining & Validator Pool: 50% (1,000,000,000,000 $AI)
    - Earned strictly via verifiable compute, training, and validator work
    - Halving eras (4-year nominal era length; Era k cap = POOL * 2^-(k+1))
```

### Token Utility

#### 1. Compute Payments

```solidity
contract ComputePayments {
    uint256 constant BASE_RATE = 0.001 ether; // 0.001 $AI per GPU-second
    
    function payForCompute(
        address provider,
        uint256 computeUnits,
        uint8 qualityTier
    ) external {
        uint256 cost = BASE_RATE * computeUnits * qualityTier;
        require(AI.transferFrom(msg.sender, provider, cost));
        
        emit ComputePurchased(msg.sender, provider, computeUnits, cost);
    }
}
```

#### 2. Training Rewards

```solidity
contract TrainingRewards {
    uint256 constant REWARD_PER_INTERACTION = 0.01 ether; // 0.01 $AI
    
    function rewardTraining(
        address user,
        bytes32 trainingHash,
        uint256 qualityScore
    ) external {
        require(qualityScore <= 100, "Invalid quality score");
        
        uint256 reward = REWARD_PER_INTERACTION * qualityScore / 100;
        
        // 70% to user providing data
        AI.mint(user, reward * 70 / 100);
        
        // 30% to compute provider
        AI.mint(msg.sender, reward * 30 / 100);
        
        emit TrainingRewarded(user, trainingHash, reward);
    }
}
```

#### 3. Model Access Fees

```yaml
Inference Pricing (per 1K tokens):
  Small Models (7B): 0.001 $AI
  Medium Models (32B): 0.01 $AI
  Large Models (175B): 0.1 $AI
  
Training Costs:
  Fine-tuning: 0.1 $AI per epoch
  Custom training: 10 $AI per run
  Embeddings: 0.0001 AI per vector
```

#### 4. Governance Rights

```solidity
contract AIGovernance {
    mapping(address => uint256) public stakedAI;
    mapping(address => uint256) public votingPower;
    
    function stake(uint256 amount) external {
        AI.transferFrom(msg.sender, address(this), amount);
        stakedAI[msg.sender] += amount;
        
        // Voting power = sqrt(staked AI) for quadratic voting
        votingPower[msg.sender] = sqrt(stakedAI[msg.sender]);
    }
    
    function propose(ProposalType pType, bytes calldata data) external {
        require(votingPower[msg.sender] >= 1000, "Insufficient voting power");
        // Create proposal logic
    }
}
```

### Proof of Compute Mining

```python
class ProofOfCompute:
    """
    Mining mechanism where providers earn AI for compute contributions
    """
    def mine_block(self, provider, compute_proof):
        # Verify compute was performed
        if self.verify_compute(compute_proof):
            # Calculate reward based on difficulty
            reward = self.calculate_reward(
                compute_proof.operations,
                compute_proof.quality,
                self.current_difficulty
            )
            
            # Mint AI tokens to provider
            self.mint_tokens(provider, reward)
            
            # Adjust difficulty for next epoch
            self.adjust_difficulty()
```

### Emission Schedule

```python
def calculate_annual_emission(year):
    """
    Deflationary emission with 4-year halving cycles
    """
    initial_emission = 100_000_000  # 100M $AI first year
    halvings = year // 4
    
    if halvings >= 5:
        return 6_250_000  # Minimum emission after 20 years
    
    return initial_emission / (2 ** halvings)

# Year 1-4: 100M $AI/year
# Year 5-8: 50M $AI/year  
# Year 9-12: 25M $AI/year
# Year 13-16: 12.5M AI/year
# Year 17-20: 6.25M $AI/year
# Year 21+: 6.25M $AI/year (terminal emission)
```

### Burn Mechanisms

```solidity
contract AIBurn {
    uint256 public totalBurned;
    
    // Automatic burns
    uint256 constant TRAINING_BURN_RATE = 10; // 10% of training rewards
    uint256 constant COMPUTE_BURN_RATE = 5;   // 5% of compute payments
    uint256 constant GOVERNANCE_BURN_RATE = 100; // 100% of failed proposals
    
    function burnFromTraining(uint256 amount) internal {
        uint256 burnAmount = amount * TRAINING_BURN_RATE / 100;
        AI.burn(burnAmount);
        totalBurned += burnAmount;
    }
    
    function burnFromCompute(uint256 amount) internal {
        uint256 burnAmount = amount * COMPUTE_BURN_RATE / 100;
        AI.burn(burnAmount);
        totalBurned += burnAmount;
    }
}
```

### Staking Rewards

```yaml
Staking Tiers:
  Bronze (100 $AI):
    - APY: 5%
    - Compute discount: 5%
    - Governance weight: 1x
    
  Silver (1,000 $AI):
    - APY: 10%
    - Compute discount: 10%
    - Governance weight: 1.5x
    
  Gold (10,000 $AI):
    - APY: 15%
    - Compute discount: 15%
    - Governance weight: 2x
    
  Platinum (100,000 $AI):
    - APY: 20%
    - Compute discount: 20%
    - Governance weight: 3x
```

## Economic Model

### Supply and Demand

**Demand Drivers:**
- Compute purchases for AI inference/training
- Model access fees
- Governance participation
- Staking for rewards
- Speculation and investment

**Supply Controls:**
- Fixed maximum supply
- Deflationary emission schedule
- Multiple burn mechanisms
- Staking locks supply
- Vesting schedules

### Price Stability Mechanisms

1. **HMM DEX**: Native liquidity pools
2. **Treasury Reserves**: DAO can provide liquidity
3. **Dynamic Fees**: Adjust based on network usage
4. **Burn Rate**: Increases with usage

isms/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).