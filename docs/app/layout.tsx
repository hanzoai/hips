import './global.css';
import '@hanzo/docs-ui/style.css';
import { RootProvider } from '@hanzo/docs-ui/provider/next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { SearchDialog } from '@/components/search-dialog';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'Hanzo Improvement Proposals (HIPs)',
    template: '%s | HIPs',
  },
  description: 'Technical standards and protocols for Hanzo AI infrastructure - Model Context Protocol, Agent SDK, and AI services.',
  keywords: ['Hanzo', 'AI', 'proposals', 'HIP', 'MCP', 'agents', 'infrastructure'],
  authors: [{ name: 'Hanzo AI' }],
  metadataBase: new URL('https://hips.hanzo.ai'),
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const stored = localStorage.getItem('hanzo-hips-theme');
                if (stored === 'light') {
                  document.documentElement.classList.remove('dark');
                } else {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-svh bg-background font-sans antialiased">
        <RootProvider
          search={{ enabled: false }}
          theme={{
            enabled: true,
            defaultTheme: 'dark',
            storageKey: 'hanzo-hips-theme',
          }}
        >
          <SearchDialog />
          <div className="relative flex min-h-svh flex-col bg-background">
            {children}
          </div>
        </RootProvider>
      </body>
    </html>
  );
}
