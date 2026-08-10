import { defineConfig } from "vitest/config";

/**
 * Config raíz solo para `coverage` (Fase 12, entregable "reporte de cobertura").
 * Vitest la combina con `vitest.workspace.ts` al ejecutar en modo workspace;
 * cada proyecto sigue definiendo su propio `test.root` allí.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**", "apps/desktop/server/src/**"],
      exclude: ["**/*.test.ts", "**/*.integration.test.ts", "**/dist/**", "**/scripts/**"]
    }
  }
});
