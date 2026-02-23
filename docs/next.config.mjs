/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
