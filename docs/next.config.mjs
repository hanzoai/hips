import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  productionBrowserSourceMaps: false,

  turbopack: {
    // The repo root, not docs/. lib/status.ts reads ../../vocabulary.json — the
    // same file scripts/index.py reads — and Turbopack takes its root from the
    // nearest package.json, which is docs/. Anything above that sits outside
    // the graph and does not resolve.
    root: path.join(import.meta.dirname, '..'),
  },
};

export default nextConfig;
