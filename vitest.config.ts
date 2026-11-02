import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The real server-only package throws outside Next.js, tests replace it with an empty module
const alias = { "server-only": fileURLToPath(new URL("./apps/web/tests/server-only.ts", import.meta.url)) };
const exclude = ["**/node_modules/**", "**/dist/**", "**/.next/**"];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["packages/*/tests/**/*.test.ts", "apps/web/tests/**/*.test.ts"],
          exclude: [...exclude, "**/*.integration.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["packages/*/tests/**/*.integration.test.ts", "apps/web/tests/**/*.integration.test.ts"],
          exclude,
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
