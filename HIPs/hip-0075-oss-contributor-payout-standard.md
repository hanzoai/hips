---
hip: 0075
title: Open Source Contributor Tracking & Payout Standard
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-02-23
requires: HIP-1, HIP-18, HIP-24, HIP-26, HIP-48
---

# HIP-75: Open Source Contributor Tracking & Payout Standard

## Abstract

This proposal defines a system for automatically tracking, scoring, and compensating open-source contributors across the Hanzo ecosystem. Contributors connect a Decentralized Identifier (HIP-48) to Hanzo Cloud, link their Git identities, and receive payouts in $AI tokens (HIP-1) on the Hanzo L1 chain (HIP-24) or in fiat currency via Hanzo Commerce (HIP-18). Every payout is recorded on-chain through a transparent, auditable smart contract.

The system analyzes git commits, pull requests, issues, code reviews, documentation edits, security reports, and community contributions across all repositories in the `hanzoai` GitHub organization (and any additional registered organizations). A scoring algorithm weights contributions by type, complexity, and production impact. A quarterly payout cycle distributes funds from a dedicated contributor pool to verified contributors proportional to their scores.

The design philosophy is simple: Hanzo depends on thousands of open-source packages. The people who maintain those packages and contribute to the Hanzo ecosystem deserve compensation that is transparent, global, and automatic. DIDs provide pseudonymous cross-platform identity. On-chain settlement provides auditability. Git provides the attribution source of truth.

**Repository**: [github.com/hanzoai/contributors](https://github.com/hanzoai/contributors)
**Port**: 8075
**Docker**: `ghcr.io/hanzoai/contributors:latest`
**Production**: https://contributors.hanzo.ai

## Motivation

### The Open Source Sustainability Crisis

The Hanzo ecosystem depends on over 1,000 open-source packages. The LLM Gateway (HIP-4) uses dozens of HTTP and protocol libraries. The React frontend imports hundreds of npm packages. The Go backend pulls in crypto, networking, and database drivers. Every one of these packages was written and maintained by someone, usually for free.

The economics are broken. A single developer maintaining a critical cryptography library used by millions of applications earns nothing from that work. Meanwhile, the companies that depend on that library generate billions in revenue. When maintainers burn out and abandon projects, everyone who depends on them suffers. The xz backdoor incident of 2024 demonstrated what happens when critical infrastructure is maintained by exhausted, unpaid volunteers who accept help from anyone willing to contribute -- including malicious actors.

Hanzo is not willing to be a free rider. We benefit enormously from open-source software. We have an obligation -- and an economic incentive -- to ensure the people who build and maintain it are compensated.

### Why Existing Solutions Fall Short

Several approaches to open-source funding exist. None adequately solve the problem for an ecosystem like Hanzo:

1. **GitHub Sponsors**: Requires individual contributors to set up sponsor profiles. Only supports individual donations, not automated attribution-based payouts. Cannot analyze contribution impact across an organization's repositories. Limited to GitHub-hosted contributions. No on-chain auditability.

2. **Open Collective**: Provides fiscal sponsorship for projects, not individual contributors. A contributor who fixes a critical bug in three different Hanzo repositories must be tracked across three separate Open Collective campaigns. The attribution is manual and error-prone.

3. **Tidelift/Thanks.dev**: These services track dependency usage and distribute funds to upstream maintainers. This is valuable for upstream dependencies but does not cover direct contributors to Hanzo repositories -- the people opening PRs, reviewing code, writing documentation, and filing bug reports.

4. **Bounty platforms (Gitcoin, Bount.ing)**: Bounties incentivize specific tasks but do not reward ongoing maintenance, code review, documentation improvements, or community support. They create perverse incentives: contributors chase bounties rather than doing the unglamorous work that keeps a project healthy.

5. **Corporate sponsorship**: One-time grants or annual sponsorships are valuable but unpredictable. A contributor cannot plan their life around sponsorship that may or may not be renewed. Automated, formula-based payouts provide predictability.

None of these approaches combine automated git-based attribution, cross-repository scoring, DID-based identity, on-chain transparency, and both fiat and token payout rails. HIP-75 does.

### Why This Matters for Hanzo Specifically

Beyond ethical obligation, contributor compensation serves Hanzo's strategic interests:

1. **Talent pipeline**: Paid contributors become invested in the ecosystem. Many of Hanzo's best full-time engineers started as open-source contributors. Compensation accelerates this pipeline.

2. **Code quality**: When contributors know their work will be scored and compensated, they write better code, add tests, update documentation. The scoring algorithm creates natural incentives for quality.

3. **Security**: Compensated contributors have less incentive to accept money from malicious actors. They also have more motivation to report vulnerabilities rather than exploit them. Security report contributions are explicitly scored.

4. **Ecosystem growth**: As Hanzo grows, the contributor base must grow with it. Compensation attracts contributors who would otherwise contribute to competing ecosystems.

5. **Regulatory positioning**: As governments consider open-source security regulations (EU Cyber Resilience Act, US CISA directives), demonstrating a formal contributor compensation program positions Hanzo favorably with regulators.

## Design Philosophy

### Why DID-Based Contributor Identity

A contributor might use different email addresses across GitHub, GitLab, and Bitbucket. They might use a pseudonym on one platform and their legal name on another. They might contribute from a personal account and a work account. Without a unified identity layer, the same person appears as three or four different contributors, each with a fraction of their true contribution score.

Decentralized Identifiers (HIP-48) solve this by providing a single identity anchor (`did:hanzo:contributor-id`) that a contributor links to all of their platform accounts. The linking process is cryptographic: the contributor signs a challenge with their DID private key and with their platform identity (e.g., a signed Git commit). The system verifies both signatures and records the link.

DID-based identity provides three critical properties:

1. **Pseudonymity**: Contributors choose what to reveal. A DID links platform accounts together for scoring purposes without requiring the contributor to reveal their legal name, location, or any other personal information. Payouts go to the DID's associated wallet address or Commerce account.

2. **Cross-platform**: A single DID aggregates contributions from GitHub, GitLab, Bitbucket, and any Git host. As Hanzo expands to non-GitHub platforms, the identity layer already supports it.

3. **Self-sovereignty**: The contributor controls their DID. Hanzo cannot revoke, modify, or impersonate it. If a contributor leaves the ecosystem, their DID and accumulated reputation remain theirs.

The alternative -- using GitHub usernames as the identity key -- fails for all three properties: GitHub usernames are not pseudonymous (GitHub can link them to real identities), they are platform-locked, and they are controlled by GitHub (account suspension destroys identity).

### Why Git-Based Attribution

Git commits are signed, timestamped, and attributable. Every line of code in a Hanzo repository has a `git blame` entry linking it to a specific author and commit. Pull requests, code reviews, and issue comments are similarly attributed via platform APIs.

We chose git as the attribution source because:

1. **Already exists**: Every contribution to Hanzo is already tracked in git. No additional reporting burden is placed on contributors.

2. **Tamper-evident**: Git commits are cryptographically hashed. Altering a commit changes its hash, breaking the chain. Signed commits (which the scoring algorithm rewards with a bonus) provide even stronger attribution guarantees.

3. **Granular**: Git tracks changes at the line level. The scoring algorithm can distinguish between a 2-line typo fix and a 500-line feature implementation. Platform-level metrics (PRs merged, issues closed) provide coarser signals but are also incorporated.

4. **Universal**: Git is the version control system for all Hanzo repositories. There is no fragmentation across different tools.

The trade-off is that git attribution can be gamed: a contributor could make many small, low-value commits to inflate their score. The scoring algorithm addresses this through complexity weighting and review requirements, discussed in the Specification section.

### Why On-Chain Payouts

Contributor payouts are recorded on the Hanzo L1 chain (HIP-24) through a smart contract. This is more complex than simply wiring money via Stripe. We accept the complexity because:

1. **Transparency**: Anyone can audit the contributor payout contract. The total pool size, individual payouts, scoring parameters, and historical distributions are all publicly verifiable. This builds trust with contributors who have been burned by opaque corporate sponsorship programs that promise much and deliver little.

2. **Global access**: On-chain payouts in $AI tokens reach any contributor with a wallet, regardless of their country, banking access, or Stripe availability. Stripe operates in 46 countries. The Hanzo L1 operates everywhere there is internet.

3. **Composability**: On-chain payouts integrate with the broader Hanzo DeFi ecosystem. Contributors can stake their $AI tokens, provide liquidity on the HMM (HIP-8), or use them to pay for Hanzo Cloud services. The tokens are not dead-end gift cards; they are liquid assets within a functioning economy.

4. **Tax basis**: On-chain records provide contributors with a clear, immutable record of all payouts received, including timestamps and USD-equivalent values at the time of distribution. This simplifies tax reporting (discussed in the Tax Reporting section).

The trade-off is gas costs and finality latency. Distributing payouts to 500 contributors requires 500 on-chain transactions (or a single batch transaction via the payout contract). At current Hanzo L1 gas prices, the cost is negligible (< $0.01 per transfer), but it is nonzero. We accept this because the auditability benefits far outweigh the cost.

### Why Not Just GitHub Sponsors

GitHub Sponsors is a donation platform. HIP-75 is an attribution engine with automated payouts. The differences are fundamental:

| Property | GitHub Sponsors | HIP-75 |
|----------|----------------|--------|
| Attribution | Manual (sponsors choose who to fund) | Automated (git analysis determines contribution scores) |
| Scope | Individual contributor profiles | All contributors across all repos |
| Identity | GitHub username | DID (cross-platform, pseudonymous) |
| Payout rails | Bank transfer (limited countries) | $AI tokens (global) + fiat via Commerce |
| Transparency | Private (amounts not disclosed) | On-chain (fully auditable) |
| Scoring | None (flat donations) | Weighted by type, complexity, impact |
| SBOM integration | None | Links contributions to shipped production code |

GitHub Sponsors and HIP-75 are complementary. A contributor can receive both GitHub Sponsors donations and HIP-75 payouts. But HIP-75 solves a fundamentally different problem: automated, fair, transparent compensation based on measured contributions.

## Specification

### Architecture

```
+-----------------------------------------------------------------------+
|                      Contributor Ecosystem                            |
|                                                                       |
|  +-----------+   +-----------+   +-----------+   +------------+      |
|  |  GitHub   |   |  GitLab   |   | Bitbucket |   |  Other Git |      |
|  |  Repos    |   |  Repos    |   |  Repos    |   |  Hosts     |      |
|  +-----+-----+   +-----+-----+   +-----+-----+   +-----+------+      |
|        |               |               |               |              |
|        +-------+-------+-------+-------+-------+-------+              |
|                |                                                      |
|         +------v------+                                               |
|         |   Git       |  commits, PRs, reviews,                       |
|         |   Ingestion |  issues, comments                             |
|         |   Engine    |                                               |
|         +------+------+                                               |
|                |                                                      |
|         +------v------+      +------------------+                     |
|         |  Scoring    +----->|  Contributor      |                    |
|         |  Engine     |      |  Profiles (DB)    |                    |
|         +------+------+      +--------+---------+                     |
|                |                      |                               |
|         +------v------+      +--------v---------+                     |
|         |  Payout     |      |  DID Registry     |                    |
|         |  Calculator |      |  (HIP-48)         |                    |
|         +------+------+      +------------------+                     |
|                |                                                      |
|         +------v-------------------------------------------------+    |
|         |                Payout Distributor                       |    |
|         |                                                        |    |
|         |  +------------------+    +-------------------------+   |    |
|         |  | $AI On-Chain     |    | Fiat via Commerce       |   |    |
|         |  | (HIP-24 L1)     |    | (HIP-18 Stripe)        |   |    |
|         |  +------------------+    +-------------------------+   |    |
|         +--------------------------------------------------------+    |
+-----------------------------------------------------------------------+
```

### Contributor Identity

#### DID Linking

A contributor establishes their identity by linking a `did:hanzo:` identifier to one or more platform accounts. The linking protocol:

1. Contributor creates or imports a DID via the DID service (HIP-48) or Hanzo Cloud dashboard.
2. Contributor navigates to `contributors.hanzo.ai/link` and authenticates with their DID.
3. Contributor initiates a platform link (e.g., GitHub). The system generates a challenge nonce.
4. Contributor signs the nonce with a platform-verifiable method:
   - **GitHub**: Create a signed commit in a designated verification repo, or sign via GitHub's attestation API.
   - **GitLab/Bitbucket**: Similar signed-commit flow.
5. System verifies the platform signature, records the `(DID, platform, platform_username)` link, and begins ingesting contributions for that account.

```json
{
  "did": "did:hanzo:0x1234...abcd",
  "links": [
    {
      "platform": "github",
      "username": "contributor42",
      "verified_at": "2026-02-23T10:00:00Z",
      "verification_method": "signed_commit",
      "commit_sha": "abc123def456..."
    },
    {
      "platform": "gitlab",
      "username": "contrib42",
      "verified_at": "2026-02-23T10:05:00Z",
      "verification_method": "signed_commit",
      "commit_sha": "789abc012def..."
    }
  ],
  "payout_preferences": {
    "method": "token",
    "wallet_address": "0x1234...abcd",
    "chain_id": 36963
  }
}
```

#### Payout Preferences

Each contributor configures their preferred payout method:

| Method | Mechanism | Requirements |
|--------|-----------|--------------|
| `token` | $AI tokens to wallet address on Hanzo L1 | Wallet address linked to DID |
| `fiat` | USD via Hanzo Commerce (Stripe) | Commerce account with verified bank |
| `credits` | Hanzo Cloud credits added to IAM balance | Hanzo Cloud account linked to DID |
| `split` | Percentage split across multiple methods | At least two methods configured |

### Git Ingestion Engine

The ingestion engine runs on a configurable schedule (default: hourly) and collects contribution data from all registered repositories.

#### Data Sources

| Source | Data Collected | API |
|--------|---------------|-----|
| Git commits | Author, committer, diff stats, files changed, signed status | `git log` / GitHub API |
| Pull requests | Author, reviewers, merge status, comments, time to merge | GitHub/GitLab API |
| Code reviews | Reviewer, review type (approve/request changes/comment), line comments | GitHub/GitLab API |
| Issues | Author, labels, resolution status, linked PRs | GitHub/GitLab API |
| Discussions | Author, replies, marked-as-answer status | GitHub Discussions API |
| Releases | Contributors listed in release notes | GitHub Releases API |
| Security advisories | Reporter, severity, CVE assignment | GitHub Security API |

#### Ingestion Schema

Each ingested event is stored with a canonical schema:

```json
{
  "event_id": "uuid",
  "event_type": "commit|pr|review|issue|discussion|release|security",
  "platform": "github",
  "repository": "hanzoai/iam",
  "contributor_did": "did:hanzo:0x1234...abcd",
  "platform_username": "contributor42",
  "timestamp": "2026-02-23T10:30:00Z",
  "metadata": {
    "lines_added": 142,
    "lines_removed": 38,
    "files_changed": 7,
    "is_signed": true,
    "languages": ["go", "yaml"],
    "labels": ["feature", "api"]
  },
  "raw_score": 0,
  "weighted_score": 0
}
```

### Contribution Scoring Algorithm

The scoring algorithm converts raw contribution events into a normalized score that determines payout share. Scoring is intentionally transparent: every contributor can see exactly how their score was calculated.

#### Base Scores by Contribution Type

| Type | Base Score | Rationale |
|------|-----------|-----------|
| Code commit (merged) | 10 per commit | Foundation of all contribution |
| Pull request (merged) | 25 per PR | Represents a complete unit of work |
| Code review (substantive) | 15 per review | Critical for quality; often undervalued |
| Issue filed (confirmed bug) | 10 per issue | Bug discovery prevents downstream damage |
| Issue filed (feature request, accepted) | 5 per issue | Design input, lower effort than code |
| Documentation (merged) | 15 per PR | Documentation is code; equally important |
| Security report (confirmed) | 50-500 per report | Scaled by severity (CVSS score) |
| Translation | 10 per PR | Expands ecosystem accessibility |
| Plugin/extension | 30 per merged PR | Grows ecosystem capabilities |
| Model fine-tune (accepted) | 40 per submission | Specialized, high-value contribution |
| Community support (marked answer) | 5 per answer | Reduces maintainer burden |

#### Complexity Multipliers

Base scores are multiplied by complexity factors derived from the contribution metadata:

```python
def compute_complexity_multiplier(event):
    m = 1.0

    # Size factor: logarithmic to prevent gaming via large diffs
    if event.type in ("commit", "pr"):
        effective_lines = event.lines_added + (0.5 * event.lines_removed)
        m *= min(log2(max(effective_lines, 1)) / 3.0, 3.0)

    # File diversity: touching more files suggests broader impact
    if event.files_changed > 5:
        m *= 1.2
    if event.files_changed > 20:
        m *= 1.5

    # Language weight: some languages require more expertise
    language_weights = {
        "rust": 1.3, "go": 1.2, "c": 1.3, "cpp": 1.3,
        "python": 1.0, "typescript": 1.0, "javascript": 1.0,
        "solidity": 1.4, "yaml": 0.8, "markdown": 0.8,
        "json": 0.5, "toml": 0.6,
    }
    lang_weight = max(language_weights.get(l, 1.0) for l in event.languages)
    m *= lang_weight

    # Signed commit bonus: encourages cryptographic attribution
    if event.is_signed:
        m *= 1.1

    return round(m, 2)
```

#### Impact Multiplier (SBOM Integration)

When the SBOM system (HIP-74) is available, contributions that ship in production binaries receive an impact multiplier:

| Impact Level | Multiplier | Criteria |
|-------------|-----------|----------|
| Production-shipped | 1.5x | Code present in latest production SBOM |
| Staging-deployed | 1.2x | Code deployed to staging environment |
| Merged only | 1.0x | Merged to main branch, not yet deployed |
| Upstream dependency | 1.3x | Contributor maintains an upstream dep used by Hanzo |

This creates a direct incentive loop: contributions that make it to production are worth more. This aligns contributor incentives with shipping reliable, production-quality code.

#### Anti-Gaming Measures

The scoring algorithm includes protections against score inflation:

1. **Minimum review requirement**: Code commits only score if the associated PR received at least one approval review. Self-merged PRs to non-protected branches score at 50%.

2. **Logarithmic size scaling**: The size multiplier uses `log2`, not linear scaling. Making 100 one-line commits scores less than one 100-line commit, discouraging commit splitting.

3. **Churned code detection**: If lines added in one commit are removed within 30 days by the same author, the original score is reduced by 80%. This prevents add-then-remove gaming.

4. **Review quality floor**: A code review that consists only of "LGTM" or an approval without comments scores at 25% of the base review score. Substantive reviews (inline comments, suggested changes) score at 100%.

5. **Cooldown period**: A contributor's score for a given repository is capped at the 95th percentile of all contributors to that repository. Outliers are flagged for manual review before payout.

6. **Duplicate detection**: The ingestion engine deduplicates across platforms. A PR mirrored from GitLab to GitHub is scored once.

### Payout Mechanism

#### Payout Pool

The contributor payout pool is funded from the Ecosystem Fund allocation of the $AI token (HIP-1). Specifically:

```yaml
Payout Pool:
  source: Ecosystem Fund (15% of total $AI supply = 150M $AI)
  contributor_allocation: 20% of Ecosystem Fund = 30M $AI
  annual_budget: 3M $AI (10-year distribution)
  quarterly_distribution: 750,000 $AI per quarter
  fiat_equivalent_budget: Set quarterly by governance vote
```

The quarterly distribution amount can be adjusted by governance vote on the Hanzo L1. The initial allocation of 750,000 $AI per quarter represents approximately $750,000 at a $1.00 token price, though actual value fluctuates with market conditions.

#### Distribution Formula

Each contributor's payout is proportional to their share of the total weighted score for the quarter:

```
contributor_payout = (contributor_quarterly_score / total_quarterly_score) * quarterly_pool
```

A minimum payout threshold of 100 $AI prevents dust distributions. Contributors below the threshold accumulate their balance until it exceeds the threshold.

#### Payout Smart Contract

The payout contract is deployed on the Hanzo L1 (chain ID 36963):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ContributorPayout is AccessControl, ReentrancyGuard {
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    IERC20 public immutable aiToken;
    uint256 public currentEpoch;

    struct Distribution {
        uint256 epoch;
        bytes32 merkleRoot;      // Root of contributor score merkle tree
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 distributedAt;
        string  scoresCID;       // IPFS CID of full score breakdown
    }

    mapping(uint256 => Distribution) public distributions;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event DistributionCreated(uint256 indexed epoch, bytes32 merkleRoot, uint256 totalAmount);
    event PayoutClaimed(uint256 indexed epoch, address indexed contributor, uint256 amount);

    constructor(address _aiToken) {
        aiToken = IERC20(_aiToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function createDistribution(
        bytes32 _merkleRoot,
        uint256 _totalAmount,
        string calldata _scoresCID
    ) external onlyRole(DISTRIBUTOR_ROLE) {
        currentEpoch++;
        distributions[currentEpoch] = Distribution({
            epoch: currentEpoch,
            merkleRoot: _merkleRoot,
            totalAmount: _totalAmount,
            claimedAmount: 0,
            distributedAt: block.timestamp,
            scoresCID: _scoresCID
        });
        aiToken.transferFrom(msg.sender, address(this), _totalAmount);
        emit DistributionCreated(currentEpoch, _merkleRoot, _totalAmount);
    }

    function claimPayout(
        uint256 _epoch,
        uint256 _amount,
        bytes32[] calldata _proof
    ) external nonReentrant {
        require(!claimed[_epoch][msg.sender], "Already claimed");
        require(_verifyProof(_proof, distributions[_epoch].merkleRoot, msg.sender, _amount), "Invalid proof");

        claimed[_epoch][msg.sender] = true;
        distributions[_epoch].claimedAmount += _amount;
        aiToken.transfer(msg.sender, _amount);
        emit PayoutClaimed(_epoch, msg.sender, _amount);
    }

    function _verifyProof(
        bytes32[] calldata proof,
        bytes32 root,
        address account,
        uint256 amount
    ) internal pure returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(account, amount));
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computed = computed < proof[i]
                ? keccak256(abi.encodePacked(computed, proof[i]))
                : keccak256(abi.encodePacked(proof[i], computed));
        }
        return computed == root;
    }
}
```

The contract uses a Merkle tree pattern: the full score breakdown is published to IPFS (referenced by `scoresCID`), and the Merkle root is stored on-chain. Each contributor claims their payout by submitting a Merkle proof. This design allows 10,000 contributors to be included in a single on-chain transaction (the `createDistribution` call), with each contributor claiming individually.

#### Fiat Payout Path

Contributors who prefer fiat receive payouts via Hanzo Commerce (HIP-18):

1. Contributor sets payout preference to `fiat` and links a Commerce account.
2. At distribution time, the system calculates the USD equivalent of their $AI allocation using the time-weighted average price (TWAP) from the HMM (HIP-8) over the preceding 7 days.
3. Commerce creates a Stripe Connect transfer to the contributor's linked bank account.
4. The $AI tokens that would have been distributed are retained in the pool (effectively buying back from the contributor at market price).

Fiat payouts require identity verification (KYC) through Commerce, in compliance with financial regulations. Token payouts do not require KYC below regulatory thresholds (varies by jurisdiction).

### Contribution Types

#### Code Contributions

The primary contribution type. Includes commits, pull requests, and branches merged into tracked repositories. Scoring accounts for:

- Lines of code added and removed (logarithmic scaling)
- Number of files modified (breadth of impact)
- Programming language (complexity weighting)
- Test coverage delta (contributions that increase coverage receive a bonus)
- Whether the PR includes documentation updates
- CI/CD pass rate (contributions that break builds are penalized)

#### Documentation

Documentation contributions are scored equally to code. The ecosystem's usability depends as much on clear documentation as on working code. Types include:

- README updates and improvements
- API documentation (OpenAPI specs, JSDoc, GoDoc)
- Tutorials and guides
- Architecture decision records
- Inline code comments (when substantial and merged via PR)
- Translation of documentation into additional languages

#### Security Reports

Vulnerability reports receive the highest base scores, scaled by CVSS severity:

| CVSS Score | Base Payout | Example |
|-----------|-----------|---------|
| 9.0-10.0 (Critical) | 500 points | Remote code execution |
| 7.0-8.9 (High) | 200 points | Authentication bypass |
| 4.0-6.9 (Medium) | 100 points | Information disclosure |
| 0.1-3.9 (Low) | 50 points | Minor configuration issue |

Security reports must be submitted through the responsible disclosure process. Public disclosure before a fix is available forfeits the payout.

#### Plugin and Extension Development

Contributions that extend the Hanzo ecosystem through plugins, MCP tools (HIP-10), or integrations receive enhanced scoring:

- MCP tool contributions: 30 base points per merged tool
- LLM Gateway provider integrations: 40 base points per provider
- SDK extensions: 25 base points per merged feature
- Model fine-tunes accepted into the Zen model family: 40 base points per submission

#### Community Support

Answering questions in GitHub Discussions, Discord, or other community channels. Attribution for non-git platforms requires the contributor to link the relevant account to their DID. Scoring:

- Marked-as-answer in GitHub Discussions: 5 points
- Verified helpful response in Discord (moderator-confirmed): 3 points
- Mentoring new contributors (reviewer on first-time contributor PRs): 10 points

### Vesting and Milestones

For significant contributions (e.g., a new major feature, a large refactoring effort, or an ongoing maintainer commitment), the system supports vesting schedules and milestone-based payouts.

#### Vesting Schedule

```yaml
vesting:
  type: linear
  cliff: 3 months
  duration: 12 months
  total_amount: negotiated per agreement
  release_frequency: monthly (after cliff)
```

Vesting applies to:
- Contributors who commit to ongoing maintenance of a subsystem
- Large feature grants (negotiated with Hanzo team)
- Security audit engagements

#### Milestone Payouts

```yaml
milestone_payout:
  project: "LLM Gateway Provider Expansion"
  milestones:
    - name: "Design document approved"
      payout: 500 $AI
      status: pending
    - name: "Implementation merged with tests"
      payout: 2000 $AI
      status: pending
    - name: "Production deployment confirmed via SBOM"
      payout: 1000 $AI
      status: pending
  total: 3500 $AI
```

Milestones are created through the contributor dashboard and require approval from a repository maintainer. Milestone completion is verified automatically where possible (PR merge, SBOM presence) and manually for subjective criteria (design approval).

### Tax Reporting

Contributor payouts may constitute taxable income depending on the contributor's jurisdiction. The system provides tax reporting support:

1. **Payout receipts**: Every payout (token or fiat) generates a receipt with timestamp, amount, USD equivalent at time of distribution, and the contributor's DID.

2. **Annual summary**: At the end of each calendar year, the system generates a summary of all payouts for each contributor, denominated in both $AI and USD equivalent.

3. **1099 generation**: For US-based contributors receiving more than $600 in fiat payouts annually, Commerce generates a 1099-NEC form. Contributors must provide a tax ID (SSN or EIN) via Commerce to receive fiat payouts above this threshold.

4. **Token valuation**: For token payouts, the USD equivalent is calculated using the TWAP from the HMM at the time of distribution. This provides a defensible fair market value for tax purposes.

5. **Export formats**: Payout history is exportable in CSV, JSON, and PDF formats for use with tax preparation software.

### API Specification

The contributor service exposes a REST API on port 8075:

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/identity/link` | Link a platform account to a DID |
| `DELETE` | `/v1/identity/link/{platform}` | Unlink a platform account |
| `GET` | `/v1/identity/{did}` | Get contributor profile and linked accounts |
| `GET` | `/v1/scores/{did}` | Get contribution scores for a DID |
| `GET` | `/v1/scores/{did}/breakdown` | Detailed score breakdown by event |
| `GET` | `/v1/leaderboard` | Top contributors by score (current quarter) |
| `GET` | `/v1/distributions` | List all payout distributions |
| `GET` | `/v1/distributions/{epoch}` | Get distribution details and Merkle proof |
| `GET` | `/v1/distributions/{epoch}/proof/{address}` | Get claim proof for a specific contributor |
| `POST` | `/v1/milestones` | Create a milestone payout agreement |
| `PATCH` | `/v1/milestones/{id}` | Update milestone status |
| `GET` | `/v1/tax/{did}/summary` | Get annual tax summary |
| `GET` | `/v1/tax/{did}/export` | Export payout history (CSV/JSON/PDF) |
| `GET` | `/v1/repositories` | List tracked repositories |
| `POST` | `/v1/repositories` | Register a new repository for tracking |

#### Authentication

All endpoints require authentication via Hanzo IAM (HIP-26). Contributors authenticate with their IAM credentials; the service resolves their DID from the IAM profile. Admin endpoints (repository registration, milestone creation) require the `contributor:admin` IAM role.

## Integration Points

### HIP-1 ($AI Token)

The payout pool is denominated in $AI tokens. The ContributorPayout smart contract holds and distributes $AI. Token price from the HMM provides USD conversion for fiat payouts and tax reporting.

### HIP-18 (Commerce)

Fiat payouts route through Commerce's Stripe Connect integration. Commerce handles KYC, bank account verification, and wire transfers. Commerce also provides the 1099 generation infrastructure.

### HIP-24 (Hanzo L1)

The ContributorPayout smart contract is deployed on the Hanzo L1 chain (chain ID 36963). All token distributions are on-chain transactions. The chain provides the immutable audit trail for all payouts.

### HIP-26 (IAM)

Contributor authentication flows through IAM. The contributor's DID is linked to their IAM account. IAM roles (`contributor:admin`, `contributor:reviewer`) govern API access.

### HIP-48 (DID)

The core identity layer. Every contributor is identified by a `did:hanzo:` identifier. Platform account links are stored as Verifiable Credentials issued by the contributor service and anchored to the DID document.

### HIP-74 (SBOM)

The SBOM system provides production deployment data. When a contribution (specific commit or file) appears in a production SBOM, the contributor's impact multiplier increases. This closes the loop between contribution and real-world deployment.

## Security Considerations

1. **Identity fraud**: A malicious actor could attempt to link someone else's platform account to their DID. The signed-commit verification prevents this: only someone with push access to the account can create the verification commit.

2. **Score manipulation**: The anti-gaming measures (logarithmic scaling, churn detection, review requirements, percentile caps) make score inflation expensive. A determined attacker would need to produce genuinely useful contributions to score significantly -- at which point, they deserve the payout.

3. **Sybil attacks**: Creating multiple DIDs to claim the same contribution multiple times is prevented by the platform account uniqueness constraint: each `(platform, username)` pair can be linked to exactly one DID.

4. **Smart contract risk**: The ContributorPayout contract uses well-audited OpenZeppelin primitives (AccessControl, ReentrancyGuard). The Merkle proof pattern is battle-tested across hundreds of token distribution contracts. The contract will undergo a security audit before mainnet deployment.

5. **Key compromise**: If a contributor's DID private key is compromised, an attacker could change payout preferences and claim pending distributions. Mitigation: the DID service (HIP-48) supports key rotation, and pending payouts have a 48-hour claim delay during which the contributor can rotate keys and freeze claims.

6. **Data privacy**: Contribution data is derived from public repositories and public platform APIs. No private repository data is ingested without explicit opt-in from the repository owner. Contributor profiles are pseudonymous by default; legal names are only collected for fiat KYC.

## Reference Implementation

The reference implementation is structured as a Go service with the following modules:

```
contributors/
  cmd/
    server/            # Main API server (:8075)
    ingester/          # Git ingestion worker
    scorer/            # Scoring engine
    distributor/       # Payout distribution job
  internal/
    identity/          # DID linking and verification
    git/               # Git and platform API clients
    scoring/           # Scoring algorithm implementation
    payout/            # Payout calculation and distribution
    tax/               # Tax reporting and export
  contracts/
    ContributorPayout.sol   # Payout smart contract
    test/                   # Foundry tests
  api/
    openapi.yaml       # OpenAPI 3.1 specification
  Dockerfile
  Makefile
  compose.yml
```

### Dependencies

| Dependency | Purpose |
|-----------|---------|
| Hanzo IAM SDK (HIP-26) | Authentication and authorization |
| Hanzo DID SDK (HIP-48) | DID resolution and credential verification |
| Hanzo Commerce SDK (HIP-18) | Fiat payout processing |
| go-ethereum (luxfi fork) | Smart contract interaction |
| PostgreSQL | Contribution event storage and scoring |
| Redis | Ingestion job queue and caching |

### Development

```bash
# Clone and setup
git clone https://github.com/hanzoai/contributors
cd contributors

# Start dependencies
docker compose up -d postgres redis

# Run ingestion (one-time)
go run cmd/ingester/main.go --org hanzoai --since 2025-01-01

# Run scoring
go run cmd/scorer/main.go --quarter 2026-Q1

# Start API server
go run cmd/server/main.go

# Run tests
go test -v ./...
```

## Backwards Compatibility

This is a new system with no existing data to migrate. Contributions predating HIP-75 can be retroactively scored by running the ingestion engine against historical git data. The default lookback window is 12 months from the system's deployment date.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
