import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import vocabulary from '../../vocabulary.json';

export type Status = keyof typeof vocabulary.status;
export type Type = keyof typeof vocabulary.type;

const HIPS_DIR = path.join(process.cwd(), '../HIPs');

export interface HIPMetadata {
  hip?: number | string;
  title?: string;
  description?: string;
  // Both vocabularies come from ../../vocabulary.json, so a status added there
  // is a status the site renders. This union used to be written by hand: it
  // admitted 'Stagnant', which no proposal has ever carried, omitted the one 52
  // proposals did, and left out 'Process' while three proposals are Process.
  status?: Status;
  type?: Type;
  category?: string;
  author?: string;
  created?: string;
  updated?: string;
  requires?: string | number[];
  tags?: string[];
  [key: string]: unknown;
}

export interface HIPPage {
  slug: string[];
  /** The file this page was read from, e.g. `hip-0065-backup-and-dr.md`. The
   *  name carries a slug, so it cannot be rebuilt from the HIP number alone. */
  file: string;
  data: {
    title: string;
    description?: string;
    content: string;
    frontmatter: HIPMetadata;
  };
}

export interface CategoryMeta {
  slug: string;
  name: string;
  shortDesc: string;
  description: string;
  range: [number, number];
  icon: string;
  color: string;
  learnMore: string;
  keyTopics: string[];
}

export interface HIPCategory extends CategoryMeta {
  hips: HIPPage[];
}

const HIP_CATEGORIES: CategoryMeta[] = [
  // Foundation & Models (0000-0010)
  {
    slug: 'foundation',
    name: 'Foundation & Models',
    shortDesc: 'Core architecture and AI models',
    description: 'Foundational specifications for Hanzo AI architecture, Hamiltonian LLMs, Jin multimodal AI, LLM Gateway, and core AI infrastructure.',
    range: [0, 10],
    icon: 'brain',
    color: 'blue',
    learnMore: 'Foundation HIPs define the bedrock of Hanzo AI, including the overall architecture framework, native currency (AI Coin), Hamiltonian LLMs, Jin multimodal architecture, LLM Gateway, post-quantum security, personalized AI, active inference, HMM, Agent SDK, and MCP integration.',
    keyTopics: ['Architecture', 'HLLMs', 'Jin multimodal', 'LLM Gateway', 'Agent SDK', 'MCP'],
  },
  // Application Interfaces (0011-0025)
  {
    slug: 'interfaces',
    name: 'Application Interfaces',
    shortDesc: 'APIs and application standards',
    description: 'Standards for chat, search, workflow, deployment, computer control, document processing, analytics, payments, and more.',
    range: [11, 25],
    icon: 'layout',
    color: 'purple',
    learnMore: 'Interface HIPs ensure consistent, developer-friendly APIs across all Hanzo services. Covers chat interfaces, search APIs, workflow automation, application deployment, computer control, document processing, analytics events, payment processing, tensor operations, blockchain nodes, IDE, personalized AI, swarm protocol, L1 chain, and bot/agent wallet protocols.',
    keyTopics: ['Chat', 'Search', 'Workflows', 'Deployment', 'Payments', 'IDE'],
  },
  // Infrastructure Services (0026-0039)
  {
    slug: 'infrastructure',
    name: 'Infrastructure Services',
    shortDesc: 'Core platform services',
    description: 'IAM, secrets management, databases, event streaming, observability, storage, CI/CD, and cloud platform standards.',
    range: [26, 39],
    icon: 'server',
    color: 'emerald',
    learnMore: 'Infrastructure HIPs define the core platform services that power Hanzo AI, including identity and access management, secrets, key-value stores, relational databases, event streaming, observability, object storage, container registries, automation, image/video generation, CI/CD, cloud platform, admin console, and Zen model architecture.',
    keyTopics: ['IAM', 'Secrets', 'Databases', 'Observability', 'CI/CD', 'Cloud'],
  },
  // Developer Tools & SDKs (0040-0049)
  {
    slug: 'devtools',
    name: 'Developer Tools & SDKs',
    shortDesc: 'SDKs, CLI, and developer experience',
    description: 'Multi-language SDKs, CLI tools, vector search, inference engines, API gateways, documentation, embeddings, analytics, DID, and DNS.',
    range: [40, 49],
    icon: 'code',
    color: 'amber',
    learnMore: 'Developer Tools HIPs specify the tooling and SDK standards that enable developers to build on Hanzo AI effectively. Covers multi-language SDK standards, CLI specifications, vector search, LLM inference engines, API gateways, documentation frameworks, embeddings, analytics datastores, decentralized identity, and DNS services.',
    keyTopics: ['SDKs', 'CLI', 'Vector search', 'Inference', 'API Gateway', 'Documentation'],
  },
  // Cloud Infrastructure (0050-0059)
  {
    slug: 'cloud',
    name: 'Cloud Infrastructure',
    shortDesc: 'Edge, security, and data infrastructure',
    description: 'Edge computing, security guard, integration hub, monitoring, zero-trust, message queues, pub/sub, ML pipelines, and databases.',
    range: [50, 59],
    icon: 'cloud',
    color: 'cyan',
    learnMore: 'Cloud Infrastructure HIPs define the distributed computing and data infrastructure for Hanzo AI at scale. Covers edge computing, security guard systems, Nexus integration hub, Visor monitoring, zero-trust architecture, message queues, pub/sub messaging, ML pipelines, unified databases, and time-series data.',
    keyTopics: ['Edge', 'Zero-trust', 'Message queues', 'ML pipelines', 'Time-series'],
  },
  // Platform Services (0060-0069)
  {
    slug: 'platform',
    name: 'Platform Services',
    shortDesc: 'Serverless, notifications, and governance',
    description: 'Serverless functions, notifications, scheduling, feature flags, log aggregation, backup/DR, data governance, federated learning, ingress, and service discovery.',
    range: [60, 69],
    icon: 'layers',
    color: 'pink',
    learnMore: 'Platform Services HIPs specify higher-level platform capabilities including serverless function execution (FaaS), notification services, task scheduling, feature flag management, centralized log aggregation, backup and disaster recovery, data governance compliance, and federated learning for privacy-preserving AI.',
    keyTopics: ['Serverless', 'Notifications', 'Feature flags', 'Backup/DR', 'Data governance', 'Federated learning'],
  },
  // Quantum Computing (0070-0073)
  {
    slug: 'quantum',
    name: 'Quantum Computing',
    shortDesc: 'Quantum integration and QML',
    description: 'Quantum computing integration, quantum key distribution, quantum machine learning, and quantum random number generation.',
    range: [70, 73],
    icon: 'atom',
    color: 'violet',
    learnMore: 'Quantum Computing HIPs prepare Hanzo AI for the quantum era. Covers quantum computing integration standards, quantum key distribution (QKD) for post-quantum cryptography, quantum machine learning (QML) for hybrid quantum-classical models, and quantum random number generation (QRNG) for cryptographic entropy.',
    keyTopics: ['Quantum integration', 'QKD', 'Quantum ML', 'QRNG'],
  },
  // Governance & Supply Chain (0074-0076)
  {
    slug: 'governance',
    name: 'Governance & Supply Chain',
    shortDesc: 'SBOM, contributor payouts, and protocols',
    description: 'Software bill of materials, open source contributor payouts, and open AI protocol standards.',
    range: [74, 76],
    icon: 'shield',
    color: 'orange',
    learnMore: 'Governance HIPs define supply chain security and community sustainability. Covers software bill of materials (SBOM) for dependency tracking, OSS contributor payout mechanisms for sustainable open source, and open AI protocol standards for interoperability.',
    keyTopics: ['SBOM', 'OSS payouts', 'Open AI Protocol'],
  },
  // Post-Quantum Chains (0077-0079)
  {
    slug: 'chains',
    name: 'Post-Quantum Chains',
    shortDesc: 'Mesh identity, Z-Chain, Q-Chain',
    description: 'Mesh identity, gossip and payments; the Z-Chain identity and attestation rollup; Q-Chain finality blocks.',
    range: [77, 79],
    icon: 'link',
    color: 'sky',
    learnMore: 'Post-quantum chain HIPs define how nodes identify themselves, gossip and pay on the mesh, how identity and attestations roll up on the Z-Chain, and how the Q-Chain seals finality blocks.',
    keyTopics: ['Mesh identity', 'Z-Chain', 'Q-Chain', 'Finality'],
  },
  // Robotics & Physical AI (0080-0083)
  {
    slug: 'robotics',
    name: 'Robotics & Physical AI',
    shortDesc: 'Robotics, CV, digital twins, SLAM',
    description: 'Robotics integration, computer vision pipelines, digital twin simulation, and sensor fusion/SLAM standards.',
    range: [80, 83],
    icon: 'cpu',
    color: 'red',
    learnMore: 'Robotics HIPs extend Hanzo AI into the physical world. Covers robotics integration for autonomous systems, computer vision pipelines for real-time visual processing, digital twin simulation for virtual-physical synchronization, and sensor fusion with SLAM for spatial awareness.',
    keyTopics: ['Robotics', 'Computer vision', 'Digital twins', 'SLAM'],
  },
  // Post-Quantum Cryptography (0084-0089)
  {
    slug: 'cryptography',
    name: 'Post-Quantum Cryptography',
    shortDesc: 'ML-DSA, ML-KEM, PQ accounts and randomness',
    description: 'Threshold ML-DSA (Pulsar-M), PQ wallet accounts, typed transaction signing, PQ permits, session KEM, and the DRBG randomness beacon.',
    range: [84, 89],
    icon: 'shield',
    color: 'slate',
    learnMore: 'Cryptography HIPs specify the post-quantum primitives the stack signs, encrypts and draws randomness with: Pulsar-M threshold ML-DSA DKG and signing, the ML-DSA-65 wallet account type, TxAuthEnvelope, PQ permits, ML-KEM session keys, and an SP 800-90A/B randomness beacon.',
    keyTopics: ['Pulsar-M', 'ML-DSA', 'ML-KEM', 'PQ permits', 'DRBG'],
  },
  // Biotech & Life Sciences (0090-0094)
  {
    slug: 'biotech',
    name: 'Biotech & Life Sciences',
    shortDesc: 'BCI, genomics, drug discovery, medical AI',
    description: 'Brain-computer interfaces, genomics pipelines, drug discovery AI, synthetic biology, and medical AI standards.',
    range: [90, 94],
    icon: 'dna',
    color: 'teal',
    learnMore: 'Biotech HIPs apply Hanzo AI to life sciences and healthcare. Covers brain-computer interface (BCI) standards, genomics pipeline specifications, AI-driven drug discovery, synthetic biology design tools, and medical AI for clinical decision support.',
    keyTopics: ['BCI', 'Genomics', 'Drug discovery', 'Synthetic biology', 'Medical AI'],
  },
  // AI Network (0095-0098)
  {
    slug: 'network',
    name: 'AI Network',
    shortDesc: 'QoS, compute rewards, node identity',
    description: 'QoS challenges, AI compute contribution rewards, node identity and the did:hanzo method, and governance upgrade keys.',
    range: [95, 98],
    icon: 'globe',
    color: 'cyan',
    learnMore: 'AI Network HIPs define how the compute network measures and rewards its nodes: QoS challenges, contribution rewards, node identity under did:hanzo, and the cold-root keys that authorize upgrades.',
    keyTopics: ['QoS', 'Compute rewards', 'did:hanzo', 'Upgrade keys'],
  },
  // Cross-Chain & Bridge (0100+)
  {
    slug: 'crosschain',
    name: 'Cross-Chain Integration',
    shortDesc: 'Bridge protocols and interoperability',
    description: 'Cross-chain bridge protocols and ecosystem interoperability with Lux Network and other chains.',
    range: [100, 199],
    icon: 'link',
    color: 'sky',
    learnMore: 'Cross-Chain HIPs define how Hanzo AI interoperates with blockchain networks, including the Hanzo-Lux bridge protocol for settlement, compute marketplace integration, and multi-chain connectivity.',
    keyTopics: ['Bridge protocol', 'Lux integration', 'Settlement', 'Multi-chain'],
  },
  // Responsible AI & Ethics (0200-0249)
  {
    slug: 'ethics',
    name: 'Responsible AI & Ethics',
    shortDesc: 'AI safety, fairness, and transparency',
    description: 'Standards for ethical AI development, bias detection, model transparency, safety evaluation, and responsible deployment.',
    range: [200, 249],
    icon: 'shield-check',
    color: 'violet',
    learnMore: 'Ethics HIPs ensure Hanzo AI systems are developed and deployed responsibly. Covers responsible AI principles, model risk management, safety evaluation frameworks, bias detection and mitigation, AI transparency and explainability, and AI incident response protocols.',
    keyTopics: ['AI principles', 'Model risk', 'Safety evaluation', 'Bias detection', 'Transparency', 'Incident response'],
  },
  // Impact & Sustainability (0250-0299)
  {
    slug: 'impact',
    name: 'Impact & Sustainability',
    shortDesc: 'Environmental and social impact',
    description: 'Standards for sustainable AI compute, carbon-neutral infrastructure, efficient model practices, and positive social impact.',
    range: [250, 299],
    icon: 'globe',
    color: 'emerald',
    learnMore: 'Impact HIPs define how Hanzo AI contributes to environmental sustainability and social good. Covers sustainability standards alignment, AI compute carbon footprint tracking, efficient model practices, AI supply chain responsibility, AI for sustainability applications, evidence locker indexing, and the Hanzo AI impact thesis.',
    keyTopics: ['Sustainability', 'Carbon footprint', 'Efficient models', 'Supply chain', 'Impact thesis'],
  },
  // Architecture (0300+)
  {
    slug: 'architecture',
    name: 'Architecture',
    shortDesc: 'System architecture and MCP tools',
    description: 'High-level system architecture specifications including unified MCP tools architecture.',
    range: [300, 399],
    icon: 'blocks',
    color: 'slate',
    learnMore: 'Architecture HIPs define overarching system design patterns for the Hanzo AI platform. Covers the unified MCP tools architecture that integrates 260+ tools into a coherent, composable framework.',
    keyTopics: ['MCP tools', 'Unified architecture', 'Composability'],
  },
  // Operator Resources (0400-0499)
  {
    slug: 'operator',
    name: 'Operator Resources',
    shortDesc: 'CRDs the operator reconciles',
    description: 'Custom resources the Hanzo operator reconciles: service, datastore, SQL, KV, DocDB, S3, DNS, Base, IAM, KMS, LLM, ingress, gateway, MPC, network, indexer, explorer; and hanzo-login.',
    range: [400, 499],
    icon: 'server',
    color: 'amber',
    learnMore: 'Operator HIPs specify one custom resource each: its fields and what the operator reconciles from them.',
    keyTopics: ['CRDs', 'Operator', 'Reconcile', 'Universe'],
  },
  // Models & Systems (0500-0599)
  {
    slug: 'systems',
    name: 'Models & Systems',
    shortDesc: 'Enso, model families, serving, context',
    description: 'Enso routing (0510) and the model families (0511), the design system, Studio, evidence, translation, identity, serving topology, org hierarchy, the context graph, rooms, the personal agent, rendezvous, and semantic memory.',
    range: [500, 599],
    icon: 'brain',
    color: 'purple',
    learnMore: 'Systems HIPs cut across capabilities. HIP-0510 specifies Enso, the router family; HIP-0511 maps Zen, Enso, Kai and Policy to their HIPs, APIs and hosts. The rest cover serving topology, identity, the context graph, rooms, memory and the personal agent.',
    keyTopics: ['Enso', 'Model families', 'Serving topology', 'Context graph', 'Semantic memory'],
  },
  // Proofs & Models (0900-0999)
  {
    slug: 'proofs',
    name: 'Proofs & Models',
    shortDesc: 'Proof of AI, Proof of Code, Zen6',
    description: 'Proof of AI native execution proofs, Proof of Code over git refs, the Agentic Company, and Zen6 (0904).',
    range: [900, 999],
    icon: 'shield-check',
    color: 'violet',
    learnMore: 'These HIPs cover proofs of execution and of code, autonomous firms on Hanzo, and HIP-0904, the Zen6 dense, coder and ternary checkpoints.',
    keyTopics: ['Proof of AI', 'Proof of Code', 'Agentic company', 'Zen6'],
  },
  // Capabilities (1000-1399)
  {
    slug: 'capabilities',
    name: 'Capabilities',
    shortDesc: 'One HIP per served capability',
    description: 'One capability, one HIP (HIP-0139): identity, intelligence, data, streams, observability, commerce, platform, applications, chain, and Kai at /v1/decisions (1332).',
    range: [1000, 1399],
    icon: 'blocks',
    color: 'teal',
    learnMore: 'One capability, one HIP (HIP-0139). HIP-1211 is the model API; HIP-1330 the agent loop; HIP-1332 Kai, the decision model, at POST /v1/decisions.',
    keyTopics: ['Capabilities', 'AI', 'Agents', 'Decisions', 'Commerce', 'Platform'],
  },
];

function getAllHIPFiles(): string[] {
  try {
    const files = fs.readdirSync(HIPS_DIR);
    return files
      .filter(file => file.endsWith('.md') || file.endsWith('.mdx'))
      .filter(file => file.startsWith('hip-'));
  } catch (error) {
    console.error('Error reading HIPs directory:', error);
    return [];
  }
}

function readHIPFile(filename: string): HIPPage | null {
  try {
    const filePath = path.join(HIPS_DIR, filename);
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(fileContents);

    const slug = filename.replace(/\.mdx?$/, '').split('/');

    // Extract HIP number from filename
    const hipMatch = filename.match(/hip-(\d+)/);
    const hipNumber =
      (data.hip !== undefined && data.hip !== null ? String(data.hip) : null) ??
      (hipMatch ? hipMatch[1] : null);

    // Convert Date objects to strings
    const processedData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value instanceof Date) {
        processedData[key] = value.toISOString().split('T')[0];
      } else {
        processedData[key] = value;
      }
    }

    return {
      slug,
      file: filename,
      data: {
        title: (processedData.title as string) || filename.replace(/\.mdx?$/, ''),
        description: processedData.description as string,
        content,
        frontmatter: {
          ...processedData,
          hip: hipNumber,
        } as HIPMetadata,
      },
    };
  } catch (error) {
    console.error(`Error reading HIP file ${filename}:`, error);
    return null;
  }
}

function getHIPNumber(page: HIPPage): number {
  const hip = page.data.frontmatter.hip;
  if (typeof hip === 'number') return hip;
  if (typeof hip === 'string') return parseInt(hip, 10) || 9999;
  return 9999;
}

export const source = {
  getPage(slugParam?: string[]): HIPPage | null {
    if (!slugParam || slugParam.length === 0) {
      return null;
    }

    const filename = `${slugParam.join('/')}.md`;
    const mdxFilename = `${slugParam.join('/')}.mdx`;

    let page = readHIPFile(filename);
    if (!page) {
      page = readHIPFile(mdxFilename);
    }

    return page;
  },

  generateParams(): { slug: string[] }[] {
    const files = getAllHIPFiles();
    return files.map(file => ({
      slug: file.replace(/\.mdx?$/, '').split('/'),
    }));
  },

  getAllPages(): HIPPage[] {
    const files = getAllHIPFiles();
    return files
      .map(readHIPFile)
      .filter((page): page is HIPPage => page !== null)
      .sort((a, b) => getHIPNumber(a) - getHIPNumber(b));
  },

  getCategorizedPages(): HIPCategory[] {
    const allPages = this.getAllPages();

    return HIP_CATEGORIES.map(cat => ({
      ...cat,
      hips: allPages.filter(page => {
        const num = getHIPNumber(page);
        return num >= cat.range[0] && num <= cat.range[1];
      }),
    })).filter(cat => cat.hips.length > 0);
  },

  getAllCategories(): HIPCategory[] {
    const allPages = this.getAllPages();

    return HIP_CATEGORIES.map(cat => ({
      ...cat,
      hips: allPages.filter(page => {
        const num = getHIPNumber(page);
        return num >= cat.range[0] && num <= cat.range[1];
      }),
    }));
  },

  getStats(): { total: number; byStatus: Record<string, number>; byType: Record<string, number> } {
    const pages = this.getAllPages();
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};

    pages.forEach(page => {
      const status = page.data.frontmatter.status || 'Unknown';
      const type = page.data.frontmatter.type || 'Unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
      byType[type] = (byType[type] || 0) + 1;
    });

    return { total: pages.length, byStatus, byType };
  },

  getPageTree() {
    const categories = this.getCategorizedPages();

    return {
      name: 'HIPs',
      children: [
        {
          type: 'page' as const,
          name: 'Overview',
          url: '/docs',
        },
        ...categories.map(cat => ({
          type: 'folder' as const,
          name: cat.name,
          description: cat.shortDesc,
          children: cat.hips.map(hip => ({
            type: 'page' as const,
            name: `HIP-${String(getHIPNumber(hip)).padStart(4, '0')}: ${hip.data.title.substring(0, 40)}${hip.data.title.length > 40 ? '...' : ''}`,
            url: `/docs/${hip.slug.join('/')}`,
          })),
        })),
      ],
    };
  },

  search(query: string): HIPPage[] {
    const q = query.toLowerCase();
    return this.getAllPages().filter(page => {
      const title = page.data.title.toLowerCase();
      const description = (page.data.description || '').toLowerCase();
      const content = page.data.content.toLowerCase();
      const tags = (page.data.frontmatter.tags || []).join(' ').toLowerCase();

      return title.includes(q) || description.includes(q) || content.includes(q) || tags.includes(q);
    });
  },

  getCategoryBySlug(slug: string): HIPCategory | undefined {
    const allPages = this.getAllPages();
    const cat = HIP_CATEGORIES.find(c => c.slug === slug);
    if (!cat) return undefined;

    return {
      ...cat,
      hips: allPages.filter(page => {
        const num = getHIPNumber(page);
        return num >= cat.range[0] && num <= cat.range[1];
      }),
    };
  },

  getAllCategorySlugs(): string[] {
    return HIP_CATEGORIES.map(cat => cat.slug);
  },
};
