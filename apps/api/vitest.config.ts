import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC (not esbuild) so Nest's DI gets emitDecoratorMetadata in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.spec.ts", "src/**/*.spec.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    globalSetup: ["test/global-setup.ts"],
  },
});
