import './global.css';
import { RootProvider } from '@hanzo/docs/ui/provider/base';
import { NextProvider } from '@hanzo/docs/core/framework/next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { SearchDialog } from '@/components/search-dialog';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'Hanzo Improvement Proposals (HIPs) - AI Infrastructure Standards',
    template: '%s | HIPs',
  },
  description: 'Technical standards and protocols for Hanzo AI infrastructure - Model Context Protocol, Agent SDK, LLM Gateway, and AI services that power the next generation of applications.',
  keywords: ['Hanzo', 'AI', 'proposals', 'HIP', 'MCP', 'agents', 'infrastructure', 'LLM', 'gateway'],
  authors: [{ name: 'Hanzo AI' }],
  metadataBase: new URL('https://hips.hanzo.ai'),
  openGraph: {
    title: 'Hanzo Improvement Proposals (HIPs) - AI Infrastructure Standards',
    description: 'Explore the technical foundations of Hanzo AI - standards for Model Context Protocol, Agent SDK, LLM Gateway, and AI services.',
    type: 'website',
    siteName: 'Hanzo Improvement Proposals',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Hanzo Improvement Proposals - AI Infrastructure Standards',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hanzo Improvement Proposals (HIPs) - AI Infrastructure Standards',
    description: 'Technical standards for Hanzo AI infrastructure - MCP, Agent SDK, LLM Gateway, and more.',
    images: ['/twitter.png'],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Prevent flash - respect system preference or stored preference */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const stored = localStorage.getItem('hanzo-hips-theme');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (stored === 'dark' || (stored !== 'light' && prefersDark)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-svh bg-background font-sans antialiased">
        <NextProvider>
          <RootProvider
            search={{
              enabled: false,
            }}
            theme={{
              enabled: true,
              defaultTheme: 'system',
              storageKey: 'hanzo-hips-theme',
            }}
          >
            <SearchDialog />
            <div className="relative flex min-h-svh flex-col bg-background">
              {children}
            </div>
          </RootProvider>
        </NextProvider>
      </body>
    </html>
  );
}
