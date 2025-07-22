/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    tailwindcss: {},
  },
  images: {
    domains: ['localhost:3000','stitchflow.io', 'dev-web.stitchflow.io'],
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
  crossOrigin: 'anonymous',
  webpack: (config) => {
    config.module.rules.push({
      test: /\.json$/,
      type: 'json',
    });
    return config;  
  },
  assetPrefix:'/tools/shadow-it',
  // Security-related configuration
  poweredByHeader: false, // Remove X-Powered-By header
};

export default config;
