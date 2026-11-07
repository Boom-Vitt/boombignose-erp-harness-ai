import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "ee/**/*.test.ts", "components/warehouse/**/*.test.ts"],
  },
})
