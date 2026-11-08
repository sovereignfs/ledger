import type { NextConfig } from 'next';

const config: NextConfig = {
  // One self-contained server in .next/standalone: what the image runs (task 1.10).
  output: 'standalone',
  poweredByHeader: false,
};

export default config;
