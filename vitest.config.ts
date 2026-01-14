// Separate file since test environment config differs from production.
/** biome-ignore-all lint/correctness/noProcessGlobal: runs in the Node.js environment */
/** biome-ignore-all lint/style/noProcessEnv: setup file */

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineWorkersConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    poolOptions: {
      singleWorker: true,
      workers: { wrangler: { configPath: "./wrangler.jsonc" } },
    },
    /*
     Leave disabled by default, will be enabled on-demand by the
     test:coverage script.
    */
    coverage: {
      /*
       Though Workers run on v8, Cloudflare docs say to use istanbul coverage
       provider:
       https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#coverage
      */
      provider: "istanbul",
      all: true,
      reporter: ["json-summary", "json", "text"],
      reportOnFailure: true,
    },
  },
})
