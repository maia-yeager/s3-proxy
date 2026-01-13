import { AwsV4Signer } from "aws4fetch"
import { z } from "zod/v4"

const PROTOCOL_REGEX = /^https?:\/\//i
const SIGNED_HEADER_REGEX = /SignedHeaders=([^,]+),/i
const HEADERS_TO_REMOVE = new Set([
  "authorization",
  "connection",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-proto",
  "x-real-ip",
])

const BUCKET_SCHEMA = z.preprocess(
  (value) => (typeof value === "string" ? JSON.parse(value) : null),
  z.object({
    endpoint: z.url().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    region: z.string().min(1),
  }),
)

export default {
  async fetch(request, env: Env) {
    const url = new URL(request.url)

    // Redirect empty root request to admin.
    if (
      request.method.toUpperCase() === "GET" &&
      url.hostname === env.WORKER_HOSTNAME &&
      url.pathname === "/" &&
      url.search === ""
    ) {
      return Response.redirect(`https://${env.WORKER_HOSTNAME}/admin/`, 307)
    }

    // Parse bucket name from subdomain.
    const bucketName = url.hostname.replace(`.${env.WORKER_HOSTNAME}`, "")
    if (bucketName === env.WORKER_HOSTNAME) {
      console.warn("No bucket specified via subdomain")
      return new Response("Not found", { status: 404 })
    }
    // Retrieve bucket data.
    const kvData = await env.KV.get(bucketName)
    if (kvData === null) {
      console.warn("Specified bucket not found")
      return new Response("Not found", { status: 404 })
    }
    // Parse bucket data.
    const result = BUCKET_SCHEMA.safeParse(kvData)
    if (result.error) {
      console.warn(
        `Error parsing '${bucketName}' data: ${z.prettifyError(result.error)}`,
      )
      return new Response("Server error", { status: 500 })
    }
    const bucket = result.data

    // Make sure there is an Authorization header.
    const origAuthHeader = request.headers.get("authorization")
    if (origAuthHeader === null) {
      console.warn("Missing authorization header")
      return new Response("Forbidden", { status: 403 })
    }
    // Determine which headers need to be signed.
    const signedHeaders = new Set(
      origAuthHeader.match(SIGNED_HEADER_REGEX)?.[1].split(";"),
    )
    if (signedHeaders.size === 0) {
      console.warn("No signed headers")
      return new Response("Forbidden", { status: 403 })
    }

    // Determine the URL to proxy the request to.
    let s3Url: string
    if (url.hostname === env.WORKER_HOSTNAME) {
      s3Url = bucket.endpoint
    } else {
      s3Url = bucket.endpoint.replace(PROTOCOL_REGEX, `https://${bucketName}.`)
      url.pathname = url.pathname.replace(`${env.WORKER_PREFIX}/`, "")
      s3Url = s3Url.concat(url.pathname, url.search)
    }

    // Clone request and make the necessary edits.
    const s3Request = new Request(s3Url, request)
    for (const header of HEADERS_TO_REMOVE) {
      s3Request.headers.delete(header)
    }

    // Determine headers to pop and later re-apply.
    const headersToReApply = new Headers()
    for (const [header, value] of s3Request.headers) {
      if (signedHeaders.has(header)) continue
      headersToReApply.set(header, value)
    }
    for (const header of headersToReApply.keys()) {
      s3Request.headers.delete(header)
    }

    const sharedSignerConfig = {
      // Required, akin to AWS_ACCESS_KEY_ID
      accessKeyId: bucket.accessKeyId,
      // Required, akin to AWS_SECRET_ACCESS_KEY
      secretAccessKey: bucket.secretAccessKey,
      // Akin to AWS_SESSION_TOKEN if using temp credentials
      sessionToken: undefined,
      // Standard JS object literal, or Headers instance
      headers: s3Request.headers,
      // Set to true to sign the query string instead of the Authorization header
      signQuery: undefined,
      // AWS service, parsed at fetch time by default
      service: "s3",
      // AWS region, parsed at fetch time by default
      region: bucket.region,
      // Credential cache, defaults to `new Map()`
      cache: undefined,
      // Set to true to add X-Amz-Security-Token after signing, defaults to true
      // for iot
      appendSessionToken: undefined,
      // Set to true to force all headers to be signed instead of the defaults
      allHeaders: true,
      // Set to true to only encode %2F once (usually only needed for testing)
      singleEncode: undefined,
    } satisfies Partial<ConstructorParameters<typeof AwsV4Signer>[0]>

    // Make sure the original request is signed correctly.
    const origSigner = new AwsV4Signer({
      ...sharedSignerConfig,
      // Required, the AWS endpoint to sign
      url: url.toString(),
      // If not supplied, will default to 'POST' if there's a body, otherwise
      // 'GET'
      method: request.method,
      // Optional, String or ArrayBuffer/ArrayBufferView – ie, remember to
      // stringify your JSON
      body: request.body,
      // Defaults to now
      datetime: request.headers.get("x-amz-date") ?? undefined,
    })
    const origSignature = await origSigner.authHeader()
    if (request.headers.get("authorization") !== origSignature) {
      console.warn(`Invalid authorization signature:
${request.headers.get("authorization")}
does not equal
${origSignature}
`)
      return new Response("Invalid Authorization Signature", { status: 403 })
    }

    // Re-sign the request.
    const signer = new AwsV4Signer({
      ...sharedSignerConfig,
      url: s3Url,
      method: s3Request.method,
      body: s3Request.body,
      datetime: s3Request.headers.get("x-amz-date") ?? undefined,
    })

    // Finalize headers.
    for (const [header, value] of headersToReApply) {
      s3Request.headers.set(header, value)
    }
    const authHeader = await signer.authHeader()
    s3Request.headers.set("Authorization", authHeader)

    return fetch(s3Request)
  },
} satisfies ExportedHandler<Env>
