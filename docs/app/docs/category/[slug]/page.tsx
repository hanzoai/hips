import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Brain, Layout, Database, Link2, Cpu, Bot, Shield, Coins } from 'lucide-react';

const iconMap: Record<string, React.ReactNode> = {
  cpu: <Cpu className="size-6" />,
  brain: <Brain className="size-6" />,
  layout: <Layout className="size-6" />,
  database: <Database className="size-6" />,
  bot: <Bot className="size-6" />,
  shield: <Shield className="size-6" />,
  coins: <Coins className="size-6" />,
  link: <Link2 className="size-6" />,
};

const colorMap: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-500', border: 'border-purple-500/20' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/20' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20' },
  red: { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/20' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-500', border: 'border-cyan-500/20' },
};

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = source.getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  const colors = colorMap[category.color] || colorMap.blue;
  const icon = iconMap[category.icon] || iconMap.brain;

  // Calculate stats for this category
  const statusCounts: Record<string, number> = {};
  category.hips.forEach(hip => {
    const status = hip.data.frontmatter.status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  return (
    <div className="max-w-4xl">
      {/* Back Navigation */}
      <Link
        href="/docs"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="size-4" />
        All Proposals
      </Link>

      {/* Category Header */}
      <div className={`rounded-xl border ${colors.border} ${colors.bg} p-6 mb-8`}>
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-lg ${colors.bg} ${colors.text}`}>
            {icon}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold mb-2">{category.name}</h1>
            <p className="text-muted-foreground mb-4">{category.description}</p>
            <div className="flex items-center gap-4 text-sm">
              <span className={`px-2 py-1 rounded-full ${colors.bg} ${colors.text}`}>
                HIP-{category.range[0]} to HIP-{category.range[1]}
              </span>
              <span className="text-muted-foreground">
                {category.hips.length} proposal{category.hips.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Topics */}
      {category.keyTopics && category.keyTopics.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Key Topics</h2>
          <div className="flex flex-wrap gap-2">
            {category.keyTopics.map((topic) => (
              <span
                key={topic}
                className="px-3 py-1 rounded-full bg-accent text-sm text-muted-foreground"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Learn More */}
      {category.learnMore && (
        <div className="mb-8 p-4 rounded-lg border border-border bg-card">
          <p className="text-sm text-muted-foreground">{category.learnMore}</p>
        </div>
      )}

      {/* Stats */}
      {Object.keys(statusCounts).length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-8 p-4 rounded-lg border border-border bg-card">
          <div className="text-center">
            <div className="text-2xl font-bold">{category.hips.length}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-500">{statusCounts['Final'] || 0}</div>
            <div className="text-xs text-muted-foreground">Final</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-500">{statusCounts['Review'] || 0}</div>
            <div className="text-xs text-muted-foreground">Review</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-500">{statusCounts['Draft'] || 0}</div>
            <div className="text-xs text-muted-foreground">Draft</div>
          </div>
        </div>
      )}

      {/* Proposals List */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Proposals in this Category</h2>
        {category.hips.length === 0 ? (
          <p className="text-muted-foreground text-sm">No proposals in this category yet.</p>
        ) : (
          <div className="space-y-2">
            {category.hips.map((hip) => (
              <Link
                key={hip.slug.join('/')}
                href={`/docs/${hip.slug.join('/')}`}
                className="flex items-center gap-4 p-3 rounded-lg border border-border hover:border-foreground/20 hover:bg-accent/50 transition-colors group"
              >
                <span className="text-sm font-mono text-muted-foreground w-20 shrink-0">
                  HIP-{String(hip.data.frontmatter.hip).padStart(4, '0')}
                </span>
                <span className="flex-1 font-medium text-sm truncate group-hover:text-foreground">
                  {hip.data.title}
                </span>
                {hip.data.frontmatter.status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                    hip.data.frontmatter.status === 'Final' ? 'bg-green-500/10 text-green-500' :
                    hip.data.frontmatter.status === 'Draft' ? 'bg-yellow-500/10 text-yellow-500' :
                    hip.data.frontmatter.status === 'Review' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-gray-500/10 text-gray-500'
                  }`}>
                    {hip.data.frontmatter.status}
                  </span>
                )}
                <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export async function generateStaticParams() {
  const slugs = source.getAllCategorySlugs();
  return slugs.map(slug => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = source.getCategoryBySlug(slug);

  if (!category) {
    return {
      title: 'Category Not Found',
    };
  }

  return {
    title: `${category.name} - Hanzo Improvement Proposals`,
    description: category.description,
  };
}
