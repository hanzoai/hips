'use client';

import Link from 'next/link';
import { Logo } from './logo';

export function DocsFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-card/30 mt-auto">
      <div className="container mx-auto px-4 py-12">
        {/* Main Footer Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {/* Categories */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm">Categories</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  Core Infrastructure
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  Interface Standards
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  Agent Frameworks
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  Model Standards
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  Security & Trust
                </Link>
              </li>
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  Compute Marketplace
                </Link>
              </li>
            </ul>
          </div>

          {/* Documentation */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm">Documentation</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
                  All Proposals
                </Link>
              </li>
              <li>
                <a href="https://docs.hanzo.ai" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  Developer Docs
                </a>
              </li>
              <li>
                <a href="https://github.com/hanzoai/hips/discussions" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  Discussions
                </a>
              </li>
              <li>
                <a href="https://github.com/hanzoai/hips" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  GitHub
                </a>
              </li>
            </ul>
          </div>

          {/* Ecosystem */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm">Ecosystem</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="https://hanzo.ai" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  Hanzo AI
                </a>
              </li>
              <li>
                <a href="https://llm.hanzo.ai" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  LLM Gateway
                </a>
              </li>
              <li>
                <a href="https://lux.network" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  Lux Network
                </a>
              </li>
              <li>
                <a href="https://zoo.ngo" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  Zoo Labs
                </a>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h3 className="font-semibold text-foreground mb-4 text-sm">Community</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="https://github.com/hanzoai" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  GitHub
                </a>
              </li>
              <li>
                <a href="https://x.com/hanaboroshi" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  X / Twitter
                </a>
              </li>
              <li>
                <a href="https://discord.gg/hanzo" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                  Discord
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-border pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <Logo size={20} />
            <span className="text-sm text-muted-foreground">
              &copy; {currentYear} Hanzo AI. Released under CC0.
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a
              href="https://github.com/hanzoai/hips/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Contribute
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
