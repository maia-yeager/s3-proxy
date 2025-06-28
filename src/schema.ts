import { z } from "zod/v4"

export const kvSchema = z.preprocess(
  (value) => (typeof value === "string" ? JSON.parse(value) : null),
  z.object({
    endpoint: z.url().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    region: z.string().min(1),
  }),
)
