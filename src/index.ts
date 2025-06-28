import { AwsV4Signer } from "aws4fetch"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./db/schema"

const PROTOCOL_REGEX = /^https?:\/\//
const SIGNED_HEADER_REGEX = /SignedHeaders=([^,]+),/i
const HEADERS_TO_REMOVE = new Set([
  "authorization",
  "connection",
  "accept-encoding",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-proto",
  "x-real-ip",
])

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const db = drizzle(env.DB, { schema })

    // Get bucket name from request URL.
    const requestUrl = new URL(request.url)

    // Get info from database.
    const bucket = await db.query.buckets.findFirst({
      where: (t, { eq }) =>
        eq(t.name, requestUrl.hostname.replace(`.${env.WORKER_HOSTNAME}`, "")),
      columns: {
        endpoint: true,
        name: true,
        accessKeyId: true,
        secretAccessKey: true,
        region: true,
      },
    })
    if (bucket === undefined) {
      console.warn(
        `Bucket not found in '${requestUrl.hostname}' using '.${env.WORKER_HOSTNAME}'`,
      )
      return new Response("Bucket not found", { status: 404 })
    }

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
    if (requestUrl.hostname === env.WORKER_HOSTNAME) {
      s3Url = bucket.endpoint
    } else {
      s3Url = bucket.endpoint.replace(PROTOCOL_REGEX, `https://${bucket.name}.`)
      requestUrl.pathname = requestUrl.pathname.replace(
        `${env.WORKER_PREFIX}/`,
        "",
      )
      s3Url = s3Url.concat(requestUrl.pathname, requestUrl.search)
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
      // Set to true to add X-Amz-Security-Token after signing, defaults to true for iot
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
      url: requestUrl.toString(),
      // If not supplied, will default to 'POST' if there's a body, otherwise 'GET'
      method: request.method,
      // Optional, String or ArrayBuffer/ArrayBufferView – ie, remember to stringify your JSON
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
      datetime: s3Request.headers.get("x-amz-date") ?? undefined, // defaults to now. to override, use the form '20150830T123600Z'
    })

    // Finalize headers.
    for (const [header, value] of headersToReApply) {
      s3Request.headers.set(header, value)
    }
    const authHeader = await signer.authHeader()
    s3Request.headers.set("Authorization", authHeader)

    return fetch(s3Request)
  },
}
