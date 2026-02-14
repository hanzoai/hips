'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Search,
  FileText,
  ArrowRight,
  Command,
  X,
  ExternalLink,
  Edit,
  MessageSquare,
  Brain,
  Layout,
  Database,
  Link as LinkIcon,
  Cpu,
  Bot,
  Shield,
  Coins,
} from 'lucide-react';

interface SearchResult {
  id: string;
  url: string;
  title: string;
  description?: string;
  hip?: number | string;
  status?: string;
}

interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
  external?: boolean;
}

export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Detect if we're on a HIP page
  const isHIPPage = pathname.startsWith('/docs/hip-');
  const currentHIP = isHIPPage ? pathname.split('/').pop()?.replace('hip-', '') : null;

  // Quick actions based on context
  const getQuickActions = useCallback((): QuickAction[] => {
    const baseActions: QuickAction[] = [
      {
        id: 'browse',
        label: 'Browse All HIPs',
        description: 'View all Hanzo Improvement Proposals',
        icon: <FileText className="size-4" />,
        action: () => {
          router.push('/docs');
          setOpen(false);
        },
      },
      {
        id: 'core',
        label: 'Core Infrastructure',
        description: 'HIP-0 to HIP-19 • Gateway and architecture',
        icon: <Cpu className="size-4" />,
        action: () => {
          router.push('/docs/category/core');
          setOpen(false);
        },
      },
      {
        id: 'interface',
        label: 'Interface Standards',
        description: 'HIP-20 to HIP-39 • APIs and developer experience',
        icon: <Layout className="size-4" />,
        action: () => {
          router.push('/docs/category/interface');
          setOpen(false);
        },
      },
      {
        id: 'data',
        label: 'Data & Analytics',
        description: 'HIP-40 to HIP-59 • Data pipelines and processing',
        icon: <Database className="size-4" />,
        action: () => {
          router.push('/docs/category/data');
          setOpen(false);
        },
      },
      {
        id: 'agents',
        label: 'Agent Frameworks',
        description: 'HIP-60 to HIP-79 • AI agents and orchestration',
        icon: <Bot className="size-4" />,
        action: () => {
          router.push('/docs/category/agents');
          setOpen(false);
        },
      },
      {
        id: 'models',
        label: 'Model Standards',
        description: 'HIP-80 to HIP-99 • LLM serving and optimization',
        icon: <Brain className="size-4" />,
        action: () => {
          router.push('/docs/category/models');
          setOpen(false);
        },
      },
      {
        id: 'security',
        label: 'Security & Trust',
        description: 'HIP-100 to HIP-119 • Security and attestation',
        icon: <Shield className="size-4" />,
        action: () => {
          router.push('/docs/category/security');
          setOpen(false);
        },
      },
      {
        id: 'compute',
        label: 'Compute Marketplace',
        description: 'HIP-120 to HIP-149 • HMM and compute pricing',
        icon: <Coins className="size-4" />,
        action: () => {
          router.push('/docs/category/compute');
          setOpen(false);
        },
      },
      {
        id: 'integration',
        label: 'Ecosystem Integration',
        description: 'HIP-150 to HIP-199 • Cross-platform connectivity',
        icon: <LinkIcon className="size-4" />,
        action: () => {
          router.push('/docs/category/integration');
          setOpen(false);
        },
      },
      {
        id: 'ethics',
        label: 'Responsible AI & Ethics',
        description: 'HIP-200 to HIP-249 • AI safety & transparency',
        icon: <Shield className="size-4" />,
        action: () => {
          router.push('/docs/category/ethics');
          setOpen(false);
        },
      },
      {
        id: 'impact',
        label: 'Impact & Sustainability',
        description: 'HIP-250 to HIP-299 • Green AI & social good',
        icon: <LinkIcon className="size-4" />,
        action: () => {
          router.push('/docs/category/impact');
          setOpen(false);
        },
      },
    ];

    // Add HIP-specific actions if on a HIP page
    if (isHIPPage && currentHIP) {
      return [
        {
          id: 'edit',
          label: `Edit HIP-${currentHIP}`,
          description: 'Edit this proposal on GitHub',
          icon: <Edit className="size-4" />,
          action: () => {
            window.open(`https://github.com/hanzoai/hips/edit/main/HIPs/hip-${currentHIP}.md`, '_blank');
            setOpen(false);
          },
          external: true,
        },
        {
          id: 'view-raw',
          label: 'View Raw',
          description: 'View raw markdown on GitHub',
          icon: <FileText className="size-4" />,
          action: () => {
            window.open(`https://github.com/hanzoai/hips/blob/main/HIPs/hip-${currentHIP}.md`, '_blank');
            setOpen(false);
          },
          external: true,
        },
        {
          id: 'discuss',
          label: 'Join Discussion',
          description: 'Discuss this HIP with the community',
          icon: <MessageSquare className="size-4" />,
          action: () => {
            window.open(`https://github.com/hanzoai/hips/discussions`, '_blank');
            setOpen(false);
          },
          external: true,
        },
        ...baseActions,
      ];
    }

    return baseActions;
  }, [isHIPPage, currentHIP, router]);

  const quickActions = getQuickActions();

  // Search HIPs
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }

    const searchHIPs = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        setResults(data);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchHIPs, 200);
    return () => clearTimeout(debounce);
  }, [query]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Open with Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }

      // Close with Escape
      if (e.key === 'Escape' && open) {
        setOpen(false);
        setQuery('');
        setSelectedIndex(0);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Handle navigation
  const handleKeyNavigation = (e: React.KeyboardEvent) => {
    const totalItems = query.length >= 2 ? results.length : quickActions.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (query.length >= 2 && results[selectedIndex]) {
        router.push(results[selectedIndex].url);
        setOpen(false);
        setQuery('');
      } else if (quickActions[selectedIndex]) {
        quickActions[selectedIndex].action();
      }
    }
  };

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 right-4 z-[100] flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-background/80 backdrop-blur border rounded-lg hover:bg-muted transition-colors"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search HIPs...</span>
        <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-xs bg-muted rounded">
          <Command className="size-3" />K
        </kbd>
      </button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          setOpen(false);
          setQuery('');
        }}
      />

      {/* Dialog */}
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2 animate-in">
        <div className="rounded-xl border bg-background shadow-2xl overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center border-b px-4">
            <Search className="size-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search HIPs or type a command..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyNavigation}
              className="flex-1 px-3 py-4 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => {
                setOpen(false);
                setQuery('');
              }}
              className="p-1 hover:bg-muted rounded"
            >
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>

          {/* Results or Quick Actions */}
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {loading && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Searching...
              </div>
            )}

            {!loading && query.length >= 2 && results.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No HIPs found for "{query}"
              </div>
            )}

            {!loading && query.length >= 2 && results.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Results
                </div>
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    onClick={() => {
                      router.push(result.url);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      selectedIndex === index ? 'bg-muted' : 'hover:bg-muted/50'
                    }`}
                  >
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-primary">
                          HIP-{result.hip}
                        </span>
                        <span className="font-medium truncate">{result.title}</span>
                      </div>
                      {result.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {result.description}
                        </p>
                      )}
                    </div>
                    {result.status && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {result.status}
                      </span>
                    )}
                    <ArrowRight className="size-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {!loading && query.length < 2 && (
              <div className="space-y-1">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  {isHIPPage ? 'Actions for this HIP' : 'Quick Actions'}
                </div>
                {quickActions.map((action, index) => (
                  <button
                    key={action.id}
                    onClick={action.action}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      selectedIndex === index ? 'bg-muted' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="text-muted-foreground">{action.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium flex items-center gap-1.5">
                        {action.label}
                        {action.external && <ExternalLink className="size-3" />}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {action.description}
                      </p>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-muted rounded">↑↓</kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-muted rounded">↵</kbd> Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-muted rounded">Esc</kbd> Close
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
