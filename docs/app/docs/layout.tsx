import { DocsLayout } from '@hanzo/docs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { Brain, Layout as LayoutIcon, Database, Link as LinkIcon } from 'lucide-react';

const iconMap: Record<string, React.ReactNode> = {
  brain: <Brain className="size-4" />,
  layout: <LayoutIcon className="size-4" />,
  database: <Database className="size-4" />,
  link: <LinkIcon className="size-4" />,
};

export default function DocsLayoutWrapper({ children }: { children: ReactNode }) {
  const pageTree = source.getPageTree();

  return (
    <DocsLayout
      tree={pageTree}
      nav={{
        title: (
          <span className="font-semibold">
            <span className="text-primary">Hanzo</span>{' '}
            <span className="text-muted-foreground">HIPs</span>
          </span>
        ),
        url: '/',
      }}
      sidebar={{
        defaultOpenLevel: 1,
        banner: (
          <div className="rounded-lg border bg-card p-3 text-sm">
            <p className="font-medium">Hanzo Improvement Proposals</p>
            <p className="text-xs text-muted-foreground mt-1">
              Technical standards for Hanzo AI
            </p>
          </div>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
