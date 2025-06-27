import { AwsV4Signer } from "aws4fetch"
import { drizzle } from "drizzle-orm/d1"
import * as schema from "./db/schema"

const PROTOCOL_REGEX = /^https?:\/\//

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    for (const header of request.headers) {
      console.log(header[0], header[1])
    }
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
      return new Response("Bucket not found", { status: 404 })
    }

    // Make sure there is an Authorization header
    if (request.headers.get("authorization") === null) {
      return new Response("Forbidden", { status: 403 })
    }

    // Generate a new signature and change URL
    let s3Url: string
    if (requestUrl.hostname === env.WORKER_HOSTNAME) {
      s3Url = bucket.endpoint
    } else {
      s3Url = bucket.endpoint.replace(PROTOCOL_REGEX, `https://${bucket.name}.`)
      requestUrl.pathname = requestUrl.pathname.replace("worker/", "")
      s3Url = s3Url.concat(requestUrl.pathname, requestUrl.search)
    }

    const s3Request = new Request(s3Url, request)

    s3Request.headers.delete("accept-encoding")
    s3Request.headers.delete("cf-connecting-ip")
    s3Request.headers.delete("cf-ipcountry")
    s3Request.headers.delete("cf-ray")
    s3Request.headers.delete("cf-visitor")
    s3Request.headers.delete("x-forwarded-proto")
    s3Request.headers.delete("x-real-ip")

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
      allHeaders: undefined,
      // Set to true to only encode %2F once (usually only needed for testing)
      singleEncode: undefined,
    } satisfies Partial<ConstructorParameters<typeof AwsV4Signer>[0]>

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

    // Make sure the original request is signed correctly
    if (
      request.headers.get("authorization") !== (await origSigner.authHeader())
    ) {
      return new Response("Invalid Authorization Signature", { status: 403 })
    }

    const signer = new AwsV4Signer({
      ...sharedSignerConfig,
      url: s3Url,
      method: s3Request.method,
      body: s3Request.body,
      datetime: s3Request.headers.get("x-amz-date") ?? undefined, // defaults to now. to override, use the form '20150830T123600Z'
    })

    const authHeader = await signer.authHeader()
    console.log(authHeader)
    s3Request.headers.set("Authorization", authHeader)

    return fetch(s3Request)
  },
}
