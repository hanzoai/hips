---
hip: 0001
title: AI Token - Hanzo's Native Currency
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
created: 2024-12-20
updated: 2026-07-08
---


# HIP-0001: AI Token - Hanzo's Native Currency

## Abstract

This proposal defines the $AI token, Hanzo's native cryptocurrency that powers the AI compute economy. The $AI token incentivizes compute providers, rewards model training, enables AI service payments, and governs the Hanzo network through a Proof of Compute consensus mechanism.

**Trading**: [$AI on Lux Exchange](https://lux.exchange/trade/AI)

## Specification

### Token Parameters

```yaml
Token Name: AI
Token Symbol: $AI
Total Supply: 1,000,000,000 $AI
Decimals: 18
Network: Hanzo L2 (EVM-compatible)
Contract: 0x... (TBD at deployment)
Exchange: lux.exchange/trade/AI
```

### Token Distribution

```yaml
Initial Distribution:
  Compute Mining: 30% (300M $AI)
    - Released via Proof of Compute mining
    - Rewards for GPU/TPU providers
    
  Training Rewards: 20% (200M $AI)
    - User interaction rewards
    - Model improvement incentives
    
  Ecosystem Fund: 15% (150M $AI)
    - Developer grants
    - Partnership incentives
    
  Community Treasury: 15% (150M $AI)
    - DAO-controlled funds
    - Community initiatives
    
  Team & Advisors: 10% (100M $AI)
    - 4-year vesting with 1-year cliff
    - 25% unlock annually after cliff
    
  Public Sale: 5% (50M $AI)
    - Initial token offering
    - Price discovery mechanism
    
  Liquidity: 5% (50M $AI)
    - DEX liquidity pools
    - HMM initial liquidity
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