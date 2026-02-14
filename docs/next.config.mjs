/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Disable source maps in production
  productionBrowserSourceMaps: false,
};

export default nextConfig;
