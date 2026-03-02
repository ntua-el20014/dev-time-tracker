import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/supabase/**/*.ts"],
      exclude: ["src/supabase/env.ts", "src/supabase/client.ts"],
    },
  },
  resolve: {
    alias: {
      "@src": path.resolve(__dirname, "src"),
      "@renderer": path.resolve(__dirname, "renderer"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
