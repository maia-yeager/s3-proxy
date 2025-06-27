import { int, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const buckets = sqliteTable("buckets", {
  id: int().primaryKey({ autoIncrement: true }),
  endpoint: text().notNull(),
  name: text().notNull().unique(),
  accessKeyId: text().notNull(),
  secretAccessKey: text().notNull(),
  region: text().notNull(),
})
