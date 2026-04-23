/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Hide the floating Next.js dev indicator / "troubleshoot" button in the corner.
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/:path*`,
      },
    ];
  },
};

export default nextConfig;
