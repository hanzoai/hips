import Link from 'next/link';
import { source } from '@/lib/source';
import {
  ArrowRight,
  Brain,
  Layout,
  Database,
  Link as LinkIcon,
  FileText,
  Zap,
  Shield,
  Layers,
} from 'lucide-react';

const iconComponents: Record<string, React.ComponentType<{ className?: string }>> = {
  brain: Brain,
  layout: Layout,
  database: Database,
  link: LinkIcon,
};

const colorClasses: Record<string, { bg: string; border: string; text: string }> = {
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-500' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/20', text: 'text-purple-500' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-500' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-500' },
};

export default function HomePage() {
  const categories = source.getCategorizedPages();
  const stats = source.getStats();
  const allPages = source.getAllPages();
  const recentHIPs = allPages.slice(0, 5);

  return (
    <main>
      {/* Hero Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
        <div className="container relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm mb-6">
              <Zap className="size-4" />
              <span>Hanzo Improvement Proposals</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Building the Future of{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-500">
                AI Infrastructure
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Technical standards and protocols for Hanzo AI infrastructure - Model Context Protocol,
              Agent SDK, and AI services that power the next generation of applications.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/docs"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                Browse HIPs
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="https://github.com/hanzoai/hips"
                target="_blank"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border font-medium hover:bg-muted transition-colors"
              >
                View on GitHub
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y bg-muted/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold">{stats.total}</div>
              <div className="text-sm text-muted-foreground mt-1">Total HIPs</div>
            </div>
            {Object.entries(stats.byStatus).slice(0, 3).map(([status, count]) => (
              <div key={status} className="text-center">
                <div className="text-3xl md:text-4xl font-bold">{count}</div>
                <div className="text-sm text-muted-foreground mt-1">{status}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">What are HIPs?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Hanzo Improvement Proposals (HIPs) are design documents providing information
              about new features, standards, and processes for the Hanzo AI ecosystem.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="rounded-xl border bg-card p-6">
              <div className="size-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
                <FileText className="size-6 text-blue-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Standards Track</h3>
              <p className="text-muted-foreground">
                Technical specifications for AI protocols, APIs, and infrastructure components
                that require implementation.
              </p>
            </div>
            <div className="rounded-xl border bg-card p-6">
              <div className="size-12 rounded-lg bg-purple-500/10 flex items-center justify-center mb-4">
                <Layers className="size-6 text-purple-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Meta Proposals</h3>
              <p className="text-muted-foreground">
                Process and governance proposals that define how Hanzo AI evolves,
                including decision-making and contribution guidelines.
              </p>
            </div>
            <div className="rounded-xl border bg-card p-6">
              <div className="size-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-4">
                <Shield className="size-6 text-emerald-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Informational</h3>
              <p className="text-muted-foreground">
                Guidelines, best practices, and design recommendations for the Hanzo AI
                ecosystem that don't require implementation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-20 bg-muted/30">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">HIP Categories</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              HIPs are organized into categories based on their scope and application area.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {categories.map((category) => {
              const IconComponent = iconComponents[category.icon] || FileText;
              const colors = colorClasses[category.color] || colorClasses.blue;

              return (
                <Link
                  key={category.name}
                  href="/docs"
                  className="group rounded-xl border bg-card p-6 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${colors.bg} ${colors.border} border`}>
                      <IconComponent className={`size-6 ${colors.text}`} />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold mb-1 group-hover:text-primary transition-colors">
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
                    <ArrowRight className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
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
          <div className="container">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold">Recent HIPs</h2>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                View all <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="space-y-4">
              {recentHIPs.map((hip) => (
                <Link
                  key={hip.slug.join('/')}
                  href={`/docs/${hip.slug.join('/')}`}
                  className="group flex items-center gap-4 p-4 rounded-xl border hover:border-primary/50 transition-colors"
                >
                  <span className="text-sm font-mono px-2 py-1 rounded bg-primary/10 text-primary">
                    HIP-{hip.data.frontmatter.hip}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                      {hip.data.title}
                    </h3>
                    {hip.data.description && (
                      <p className="text-sm text-muted-foreground truncate">
                        {hip.data.description}
                      </p>
                    )}
                  </div>
                  {hip.data.frontmatter.status && (
                    <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                      {hip.data.frontmatter.status}
                    </span>
                  )}
                  <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-20 border-t">
        <div className="container text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to contribute?</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-8">
            Join the Hanzo AI community and help shape the future of AI infrastructure.
            Submit your own HIP or contribute to existing proposals.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="https://github.com/hanzoai/hips/blob/main/CONTRIBUTING.md"
              target="_blank"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              Read Contributing Guide
            </Link>
            <Link
              href="https://github.com/hanzoai/hips/discussions"
              target="_blank"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border font-medium hover:bg-muted transition-colors"
            >
              Join Discussions
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
