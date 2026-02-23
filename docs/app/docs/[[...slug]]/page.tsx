import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ExternalLink, Calendar, User, Tag, FileText, CheckCircle } from 'lucide-react';

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export async function generateStaticParams() {
  const params = source.generateParams();
  // Add empty slug for index page
  return [{ slug: [] }, ...params];
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;

  if (!slug || slug.length === 0) {
    return {
      title: 'Hanzo Improvement Proposals',
      description: 'HIPs define standards and specifications for the Hanzo AI ecosystem',
    };
  }

  const page = source.getPage(slug);

  if (!page) {
    return {
      title: 'Not Found',
    };
  }

  return {
    title: page.data.title,
    description: page.data.description || `HIP-${page.data.frontmatter.hip}: ${page.data.title}`,
  };
}

// Index page component
function DocsIndexPage() {
  const categories = source.getCategorizedPages();
  const stats = source.getStats();

  const statusColors: Record<string, string> = {
    Draft: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    Review: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    'Last Call': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    Final: 'bg-green-500/10 text-green-500 border-green-500/20',
    Withdrawn: 'bg-red-500/10 text-red-500 border-red-500/20',
    Stagnant: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    Superseded: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">All Hanzo Improvement Proposals</h1>
      <p className="text-muted-foreground mb-8">
        Browse all {stats.total} proposals organized by category. Use the sidebar to navigate
        or press <kbd className="px-2 py-0.5 rounded bg-accent text-xs font-mono">Ctrl+K</kbd> to search.
      </p>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-4 mb-12 p-4 rounded-lg border border-border bg-card">
        <div className="text-center">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-500">{stats.byStatus['Final'] || 0}</div>
          <div className="text-xs text-muted-foreground">Final</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-500">{stats.byStatus['Review'] || 0}</div>
          <div className="text-xs text-muted-foreground">Review</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-500">{stats.byStatus['Draft'] || 0}</div>
          <div className="text-xs text-muted-foreground">Draft</div>
        </div>
      </div>

      {/* Categories */}
      {categories.map((cat) => (
        <section key={cat.name} className="mb-12">
          <Link
            href={`/docs/category/${cat.slug}`}
            className="flex items-center gap-3 mb-4 group w-fit"
          >
            <h2 className="text-xl font-semibold group-hover:text-primary transition-colors">{cat.name}</h2>
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-accent group-hover:bg-primary/10 transition-colors">
              {cat.hips.length} proposals
            </span>
            <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
          <p className="text-sm text-muted-foreground mb-4">{cat.description}</p>
          <div className="space-y-2">
            {cat.hips.map((hip) => (
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
        </section>
      ))}
    </div>
  );
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;

  // Handle index page
  if (!slug || slug.length === 0) {
    return <DocsIndexPage />;
  }

  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  const { frontmatter, content, title } = page.data;

  const statusColors: Record<string, string> = {
    Draft: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    Review: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    'Last Call': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    Final: 'bg-green-500/10 text-green-500 border-green-500/20',
    Withdrawn: 'bg-red-500/10 text-red-500 border-red-500/20',
    Stagnant: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    Superseded: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  };

  return (
    <main className="container py-8 max-w-4xl mx-auto px-4">
      {/* Navigation */}
      <Link
        href="/docs"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to HIPs
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-sm font-mono px-2 py-1 rounded bg-primary/10 text-primary">
            HIP-{frontmatter.hip}
          </span>
          {frontmatter.status && (
            <span className={`text-sm px-2 py-1 rounded border ${statusColors[frontmatter.status] || statusColors.Draft}`}>
              {frontmatter.status}
            </span>
          )}
          {frontmatter.type && (
            <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground">
              {frontmatter.type}
            </span>
          )}
          {frontmatter.category && (
            <span className="text-sm px-2 py-1 rounded bg-muted text-muted-foreground">
              {frontmatter.category}
            </span>
          )}
        </div>

        <h1 className="text-3xl font-bold mb-4">{title}</h1>

        {frontmatter.description && (
          <p className="text-lg text-muted-foreground mb-6">{frontmatter.description}</p>
        )}

        {/* Metadata */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {frontmatter.author && (
            <div className="flex items-center gap-1.5">
              <User className="size-4" />
              <span>{frontmatter.author}</span>
            </div>
          )}
          {frontmatter.created && (
            <div className="flex items-center gap-1.5">
              <Calendar className="size-4" />
              <span>Created: {frontmatter.created}</span>
            </div>
          )}
          {frontmatter.updated && (
            <div className="flex items-center gap-1.5">
              <Calendar className="size-4" />
              <span>Updated: {frontmatter.updated}</span>
            </div>
          )}
        </div>

        {/* Tags */}
        {frontmatter.tags && frontmatter.tags.length > 0 && (
          <div className="flex items-center gap-2 mt-4">
            <Tag className="size-4 text-muted-foreground" />
            <div className="flex flex-wrap gap-1">
              {frontmatter.tags.map((tag: string) => (
                <span key={tag} className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Dependencies */}
        {frontmatter.requires && (
          <div className="mt-4 p-3 rounded-lg bg-muted/50">
            <span className="text-sm text-muted-foreground">Requires: </span>
            <span className="text-sm">
              {Array.isArray(frontmatter.requires)
                ? frontmatter.requires.map((r: number) => `HIP-${r}`).join(', ')
                : `HIP-${frontmatter.requires}`}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const isExternal = href?.startsWith('http');
              return (
                <a
                  href={href}
                  target={isExternal ? '_blank' : undefined}
                  rel={isExternal ? 'noopener noreferrer' : undefined}
                  className="inline-flex items-center gap-1"
                >
                  {children}
                  {isExternal && <ExternalLink className="size-3" />}
                </a>
              );
            },
            code: ({ className, children, ...props }) => {
              const isInline = !className;
              if (isInline) {
                return (
                  <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-sm" {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
            pre: ({ children }) => (
              <pre className="rounded-lg bg-muted p-4 overflow-x-auto">
                {children}
              </pre>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto">
                <table className="w-full">{children}</table>
              </div>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </article>

      {/* Footer */}
      <div className="mt-12 pt-8 border-t">
        <div className="flex flex-wrap gap-4 text-sm">
          <a
            href={`https://github.com/hanzoai/hips/edit/main/HIPs/hip-${frontmatter.hip}.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            Edit on GitHub
            <ExternalLink className="size-3" />
          </a>
          <a
            href={`https://github.com/hanzoai/hips/blob/main/HIPs/hip-${frontmatter.hip}.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            View Raw
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </main>
  );
}
