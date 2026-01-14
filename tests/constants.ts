import type { bucketDataSchema } from "@src/schema"
import type { z } from "zod"

export const bucketName = "bucket"
export const bucketData = {
  // Dummy endpoint.
  endpoint: "https://12a3b4567890123456cdef7890ghi12k.r2.cloudflarestorage.com",
  accessKeyId: "07b5e54126e2693d3bcc547d7a7ae431",
  // Created by generating a new token and immediately revoking it.
  secretAccessKey:
    "8866e0a0d14e0db4649425f1cae7d9e73c08699943f0b532b609fa53e6b40d41",
  region: "auto",
} satisfies z.infer<typeof bucketDataSchema>
