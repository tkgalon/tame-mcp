import type { NextConfig } from "next";

const WORKSPACE_EXTERNALS = /^@tame\/(core|extraction)$/;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["pg"],
  // Extraction spawns child.js next to its own dist files, so these packages must load from disk.
  // serverExternalPackages skips workspace packages because their symlinks resolve outside node_modules.
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals.push(
        ({ request }: { request?: string }, callback: (error?: Error, result?: string) => void) =>
          request && WORKSPACE_EXTERNALS.test(request)
            ? callback(undefined, `import ${request}`)
            : callback(),
      );
    }
    return config;
  },
};

export default nextConfig;
