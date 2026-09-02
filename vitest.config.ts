import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.vitest.ts"],
    setupFiles: ["src/test-utils/setup.ts"],
    passWithNoTests: false,
    coverage: { reporter: ["text", "json", "html"] },
  },
});