import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const HIPS_DIR = path.join(process.cwd(), '../HIPs');

export interface HIPMetadata {
  hip?: number | string;
  title?: string;
  description?: string;
  status?: 'Draft' | 'Review' | 'Last Call' | 'Final' | 'Withdrawn' | 'Stagnant' | 'Superseded';
  type?: 'Standards Track' | 'Meta' | 'Informational';
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
  {
    slug: 'core',
    name: 'Core Infrastructure',
    shortDesc: 'Foundation and architecture',
    description: 'Core specifications for Hanzo AI infrastructure and foundational architecture.',
    range: [0, 19],
    icon: 'cpu',
    color: 'blue',
    learnMore: 'Core HIPs define the foundational architecture of Hanzo AI, including gateway configurations, service orchestration, and deployment patterns for enterprise-grade AI infrastructure.',
    keyTopics: ['LLM Gateway', 'Service mesh', 'Deployment patterns', 'Infrastructure scaling'],
  },
  {
    slug: 'interface',
    name: 'Interface Standards',
    shortDesc: 'APIs and developer experience',
    description: 'Standards for APIs, SDKs, and developer-facing interfaces.',
    range: [20, 39],
    icon: 'layout',
    color: 'purple',
    learnMore: 'Interface HIPs ensure consistent, developer-friendly APIs across all Hanzo services. This includes chat interfaces, search APIs, workflow automation, and Model Context Protocol (MCP) specifications.',
    keyTopics: ['REST/GraphQL APIs', 'MCP protocol', 'SDK standards', 'Developer experience'],
  },
  {
    slug: 'data',
    name: 'Data & Analytics',
    shortDesc: 'Data pipelines and processing',
    description: 'Standards for data processing, analytics, and information flows.',
    range: [40, 59],
    icon: 'database',
    color: 'emerald',
    learnMore: 'Data HIPs govern how information flows through the Hanzo ecosystem, including analytics pipelines, document processing, vector embeddings, and real-time data streaming architectures.',
    keyTopics: ['Vector databases', 'RAG pipelines', 'Document processing', 'Analytics'],
  },
  {
    slug: 'agents',
    name: 'Agent Frameworks',
    shortDesc: 'AI agents and orchestration',
    description: 'Specifications for autonomous AI agents and multi-agent orchestration.',
    range: [60, 79],
    icon: 'bot',
    color: 'pink',
    learnMore: 'Agent HIPs define the architecture for autonomous AI agents, including single-agent behaviors, multi-agent coordination, tool use patterns, and agent lifecycle management. Integrates with Zoo Labs DSO for decentralized agent coordination.',
    keyTopics: ['Agent SDK', 'Multi-agent systems', 'Tool orchestration', 'Agent lifecycle'],
  },
  {
    slug: 'models',
    name: 'Model Standards',
    shortDesc: 'LLM serving and optimization',
    description: 'Standards for model deployment, serving, and optimization.',
    range: [80, 99],
    icon: 'brain',
    color: 'amber',
    learnMore: 'Model HIPs specify how LLMs are deployed, served, and optimized across Hanzo infrastructure. This includes Active Semantic Optimization (ASO), training-free GRPO, and model routing strategies for 100+ provider support.',
    keyTopics: ['Model serving', 'ASO optimization', 'Provider routing', 'Inference scaling'],
  },
  {
    slug: 'security',
    name: 'Security & Trust',
    shortDesc: 'Security and attestation',
    description: 'Security protocols, TEE attestation, and trust infrastructure.',
    range: [100, 119],
    icon: 'shield',
    color: 'red',
    learnMore: 'Security HIPs define authentication, authorization, and trust mechanisms including Trusted Execution Environment (TEE) attestation, API key management, and secure model execution for enterprise deployments.',
    keyTopics: ['TEE attestation', 'API security', 'Access control', 'Secure inference'],
  },
  {
    slug: 'compute',
    name: 'Compute Marketplace',
    shortDesc: 'HMM and compute pricing',
    description: 'Hamiltonian Market Maker and decentralized compute infrastructure.',
    range: [120, 149],
    icon: 'coins',
    color: 'orange',
    learnMore: 'Compute HIPs specify the Hamiltonian Market Maker (HMM) protocol for oracle-free pricing of AI compute resources. This includes GPU marketplace operations, compute credits, and settlement mechanisms with Lux Network.',
    keyTopics: ['HMM protocol', 'GPU marketplace', 'Compute credits', 'Price discovery'],
  },
  {
    slug: 'integration',
    name: 'Ecosystem Integration',
    shortDesc: 'Cross-platform connectivity',
    description: 'Integration protocols with Lux Network, Zoo Labs, and external systems.',
    range: [150, 199],
    icon: 'link',
    color: 'cyan',
    learnMore: 'Integration HIPs enable Hanzo to work seamlessly with the broader ecosystem including Lux Network (settlement layer), Zoo Labs (decentralized training), and third-party AI platforms and blockchain networks.',
    keyTopics: ['Lux settlement', 'Zoo DSO', 'Third-party APIs', 'Cross-chain bridges'],
  },
  {
    slug: 'ethics',
    name: 'Responsible AI & Ethics',
    shortDesc: 'AI safety, fairness, and transparency',
    description: 'Standards for ethical AI development, bias detection, model transparency, and responsible deployment. Hanzo AI is committed to building AI that benefits humanity.',
    range: [200, 249],
    icon: 'shield-check',
    color: 'violet',
    learnMore: 'Ethics HIPs ensure Hanzo AI systems are developed and deployed responsibly. Covers bias auditing, explainability requirements, safety testing, content moderation standards, and human oversight mechanisms.',
    keyTopics: ['Bias detection', 'Model transparency', 'Safety testing', 'Human oversight'],
  },
  {
    slug: 'impact',
    name: 'Impact & Sustainability',
    shortDesc: 'Environmental and social impact',
    description: 'Proposals for sustainable AI compute, carbon-neutral infrastructure, and positive social impact. Building AI infrastructure that serves humanity and the planet.',
    range: [250, 299],
    icon: 'globe',
    color: 'emerald',
    learnMore: 'Impact HIPs define how Hanzo AI contributes to environmental sustainability and social good. Includes energy-efficient inference, carbon offsetting for GPU compute, open research initiatives, and partnerships with non-profits.',
    keyTopics: ['Green AI compute', 'Carbon offsetting', 'Open research', 'Social benefit'],
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
    const hipNumber = data.hip || (hipMatch ? parseInt(hipMatch[1], 10) : null);

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
          children: cat.hips.slice(0, 20).map(hip => ({
            type: 'page' as const,
            name: `HIP-${hip.data.frontmatter.hip}: ${hip.data.title.substring(0, 40)}${hip.data.title.length > 40 ? '...' : ''}`,
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
