import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    clearMocks: true,
    // Vitest 4 restores spies separately; reset standalone mocks between authorization scenarios.
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
