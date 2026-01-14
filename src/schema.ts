import { z } from "zod"

export const bucketDataSchema = z.preprocess(
  (value) => (typeof value === "string" ? JSON.parse(value) : value),
  z.object({
    endpoint: z.url().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    region: z.string().min(1),
  }),
)
