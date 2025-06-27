import "dotenv/config"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: errors if missing.
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    // biome-ignore lint/style/noNonNullAssertion: errors if missing.
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    // biome-ignore lint/style/noNonNullAssertion: errors if missing.
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
})
