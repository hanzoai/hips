import Link from 'next/link';
import { source } from '@/lib/source';
import { HomeHeader } from '@/components/home-header';
import { DocsFooter } from '@/components/docs-footer';
import {
  ArrowRight,
  FileText,
  Zap,
  Shield,
  Layers,
  Brain,
  Cpu,
  Database,
  Code,
  Cloud,
  Atom,
  Bot,
  Globe,
  Link as LinkIcon,
} from 'lucide-react';

const iconComponents: Record<string, React.ComponentType<{ className?: string }>> = {
  brain: Brain,
  layout: Layers,
  server: Database,
  code: Code,
  cloud: Cloud,
  layers: Layers,
  atom: Atom,
  shield: Shield,
  cpu: Cpu,
  dna: Zap,
  link: LinkIcon,
  'shield-check': Shield,
  globe: Globe,
  blocks: Layers,
  bot: Bot,
  database: Database,
  sky: Cloud,
  slate: Layers,
  teal: Zap,
};

const colorClasses: Record<string, { bg: string; border: string; text: string }> = {
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-500' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', text: 'text-purple-500' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-500' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-500' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-500' },
  pink: { bg: 'bg-pink-500/10', border: 'border-pink-500/20', text: 'text-pink-500' },
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-500' },
  orange: { bg: 'bg-orange-500/10', border: 'border-orange-500/20', text: 'text-orange-500' },
  red: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-500' },
  teal: { bg: 'bg-teal-500/10', border: 'border-teal-500/20', text: 'text-teal-500' },
  sky: { bg: 'bg-sky-500/10', border: 'border-sky-500/20', text: 'text-sky-500' },
  slate: { bg: 'bg-slate-500/10', border: 'border-slate-500/20', text: 'text-slate-500' },
};

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Draft: 'bg-yellow-500/10 text-yellow-500',
    Review: 'bg-blue-500/10 text-blue-500',
    'Last Call': 'bg-orange-500/10 text-orange-500',
    Final: 'bg-green-500/10 text-green-500',
    Withdrawn: 'bg-red-500/10 text-red-500',
    Stagnant: 'bg-gray-500/10 text-gray-500',
    Superseded: 'bg-purple-500/10 text-purple-500',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

export default function HomePage() {
  const categories = source.getCategorizedPages();
  const stats = source.getStats();
  const allPages = source.getAllPages();
  const recentHIPs = allPages.slice(-6).reverse();

  return (
    <main>
      <HomeHeader />

      {/* Hero Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-foreground/5 via-transparent to-transparent" />
        <div className="container relative max-w-6xl mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm mb-6">
              <Zap className="size-4" />
              <span>{stats.total} Proposals</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Hanzo{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-foreground to-foreground/60">
                Improvement Proposals
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Technical standards and protocols for Hanzo AI infrastructure &mdash; Model Context Protocol,
              Agent SDK, LLM Gateway, and services powering the next generation of AI applications.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/docs"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors"
              >
                Browse HIPs
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="https://github.com/hanzoai/hips"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-border font-medium hover:bg-muted transition-colors"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y border-border bg-muted/30">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground mt-1">Total HIPs</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-green-500">{stats.byStatus['Final'] || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Final</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-blue-500">{stats.byStatus['Review'] || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Review</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-yellow-500">{stats.byStatus['Draft'] || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Draft</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features - What are HIPs */}
      <section className="py-20">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">What are HIPs?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Hanzo Improvement Proposals (HIPs) are design documents providing information
              about new features, standards, and processes for the Hanzo AI ecosystem.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="size-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                <FileText className="size-6 text-blue-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Standards Track</h3>
              <p className="text-muted-foreground">
                Technical specifications for AI protocols, APIs, and infrastructure components
                that require implementation across the platform.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="size-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <Layers className="size-6 text-purple-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Meta Proposals</h3>
              <p className="text-muted-foreground">
                Process and governance proposals that define how Hanzo AI evolves,
                including decision-making and contribution guidelines.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="size-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-4">
                <Shield className="size-6 text-emerald-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Informational</h3>
              <p className="text-muted-foreground">
                Guidelines, best practices, and design recommendations for the Hanzo AI
                ecosystem that don&apos;t require direct implementation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-20 bg-muted/30">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">HIP Categories</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              {categories.length} active categories spanning {stats.total} proposals across AI infrastructure,
              models, security, compute, ethics, and beyond.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {categories.map((category) => {
              const IconComponent = iconComponents[category.icon] || FileText;
              const colors = colorClasses[category.color] || colorClasses.blue;

              return (
                <Link
                  key={category.slug}
                  href={`/docs/category/${category.slug}`}
                  className="group rounded-xl border border-border bg-card p-6 hover:border-foreground/20 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${colors.bg} ${colors.border} border`}>
                      <IconComponent className={`size-6 ${colors.text}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-1 group-hover:text-foreground transition-colors">
                        {category.name}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        {category.description}
                      </p>
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`px-2 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                          {category.hips.length} HIPs
                        </span>
                        <span className="text-muted-foreground">
                          HIP-{category.range[0]} to HIP-{category.range[1]}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="size-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Recent HIPs */}
      {recentHIPs.length > 0 && (
        <section className="py-20">
          <div className="container max-w-6xl mx-auto px-4">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold">Recent Proposals</h2>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                View all <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="space-y-3">
              {recentHIPs.map((hip) => (
                <Link
                  key={hip.slug.join('/')}
                  href={`/docs/${hip.slug.join('/')}`}
                  className="group flex items-center gap-4 p-4 rounded-xl border border-border hover:border-foreground/20 transition-colors"
                >
                  <span className="text-sm font-mono px-2 py-1 rounded bg-primary/10 text-primary shrink-0">
                    HIP-{String(hip.data.frontmatter.hip).padStart(4, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate group-hover:text-foreground transition-colors">
                      {hip.data.title}
                    </h3>
                    {hip.data.description && (
                      <p className="text-sm text-muted-foreground truncate">
                        {hip.data.description}
                      </p>
                    )}
                  </div>
                  {hip.data.frontmatter.status && (
                    <StatusBadge status={hip.data.frontmatter.status} />
                  )}
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-20 border-t border-border">
        <div className="container max-w-6xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to contribute?</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-8">
            Join the Hanzo AI community and help shape the future of AI infrastructure.
            Submit your own HIP or contribute to existing proposals.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://github.com/hanzoai/hips/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors"
            >
              Read Contributing Guide
            </a>
            <a
              href="https://github.com/hanzoai/hips/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-border font-medium hover:bg-muted transition-colors"
            >
              Join Discussions
            </a>
          </div>
        </div>
      </section>

      <DocsFooter />
    </main>
  );
}
