import {
  createExecutionContext,
  env,
  fetchMock,
  waitOnExecutionContext,
} from "cloudflare:test"
import { bucketData, bucketName } from "@tests/constants"
import { AwsV4Signer } from "aws4fetch"
import worker from ".."

type WorkerRequest = Parameters<typeof worker.fetch>[0]
type TestData = {
  /** Human-readable test name */
  name: string
  /**
   * Any setup that should happen before the worker executes.
   * @returns the request to pass to the worker.
   */
  setup: () => WorkerRequest
  /** The HTTP response code to expect. */
  responseCode: number
  /**
   * Any data that should be populated in the KV store before worker execution.
   */
  kvData?: Record<string, unknown>
}

const bucketlessOrigin = `https://${env.WORKER_HOSTNAME}`
const bucketOrigin = `https://${bucketName}.${env.WORKER_HOSTNAME}`

let goodRequest: WorkerRequest
beforeAll(async () => {
  fetchMock.activate()
  fetchMock.disableNetConnect()

  goodRequest = new Request(bucketOrigin, {
    headers: {
      Authorization: await new AwsV4Signer({
        accessKeyId: bucketData.accessKeyId,
        secretAccessKey: bucketData.secretAccessKey,
        region: bucketData.region,
        service: "s3",
        allHeaders: true,
        url: bucketOrigin,
      }).authHeader(),
    },
  })
})
afterEach(() => fetchMock.assertNoPendingInterceptors())

it.for([
  {
    name: "admin redirect",
    setup: () => new Request(bucketlessOrigin),
    responseCode: 307,
  },
  {
    name: "bucket not specified",
    setup: () => new Request(`${bucketlessOrigin}/file.txt`),
    responseCode: 404,
  },
  {
    name: "bucket not found",
    setup: () => new Request(bucketOrigin),
    responseCode: 404,
    kvData: { otherBucket: bucketData },
  },
  {
    name: "bad KV data",
    setup: () => new Request(bucketOrigin),
    responseCode: 500,
    kvData: { [bucketName]: { ...bucketData, endpoint: undefined } },
  },
  {
    name: "missing auth",
    setup: () => new Request(bucketOrigin),
    responseCode: 403,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "empty auth",
    setup: () => new Request(bucketOrigin, { headers: { authorization: "" } }),
    responseCode: 400,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "no signed headers",
    setup: () =>
      new Request(bucketOrigin, {
        headers: { Authorization: "SignedHeaders=" },
      }),
    responseCode: 400,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "missing auth signature",
    setup: () =>
      new Request(bucketOrigin, {
        headers: { Authorization: "SignedHeaders=host" },
      }),
    responseCode: 403,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "bad signature",
    setup: () =>
      new Request(bucketOrigin, {
        headers: {
          Authorization:
            "AWS4-HMAC-SHA256 Credential=07b5e54126e2693d3bcc547d7a7ae431/20260114/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=734bdc53dde0402c427f61e66577840b96d0bf69554aabdde6a7c84426aff727",
        },
      }),
    responseCode: 403,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "good signature",
    setup: () => {
      const url = new URL(bucketData.endpoint)
      url.hostname = `${bucketName}.${url.hostname}`
      fetchMock.get(url.origin).intercept({ path: url.pathname }).reply(200)

      return goodRequest
    },
    responseCode: 200,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "extraneous headers",
    setup: () => {
      const headerKey = "extraneous"
      const headerValue = "value"

      const url = new URL(bucketData.endpoint)
      url.hostname = `${bucketName}.${url.hostname}`
      fetchMock
        .get(url.origin)
        .intercept({
          path: url.pathname,
          // Ensure that extraneous headers are kept.
          headers: (headers) => {
            expect(headers[headerKey]).toEqual(headerValue)
            return true
          },
        })
        .reply(200)

      const request = goodRequest.clone()
      request.headers.set(headerKey, headerValue)
      return request
    },
    responseCode: 200,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "execution ctx headers",
    setup: () => {
      const headerKey = "x-real-ip"

      const url = new URL(bucketData.endpoint)
      url.hostname = `${bucketName}.${url.hostname}`
      fetchMock
        .get(url.origin)
        .intercept({
          path: url.pathname,
          // Ensure that execution context headers are removed.
          headers: (headers) => {
            expect(headers[headerKey]).toBe(undefined)
            return true
          },
        })
        .reply(200)

      const request = goodRequest.clone()
      request.headers.set(headerKey, "127.0.0.1")
      return request
    },
    responseCode: 200,
    kvData: { [bucketName]: bucketData },
  },
  {
    name: "upstream error pass-thru",
    setup: () => {
      const url = new URL(bucketData.endpoint)
      url.hostname = `${bucketName}.${url.hostname}`
      fetchMock.get(url.origin).intercept({ path: url.pathname }).reply(599)

      return goodRequest
    },
    responseCode: 599,
    kvData: { [bucketName]: bucketData },
  },
] satisfies TestData[])(
  "responds with $responseCode for $name",
  async ({ responseCode, kvData, setup }) => {
    // Create an empty context to pass to `worker.fetch()`
    const ctx = createExecutionContext()
    const request = setup()

    await Promise.all(
      Object.entries(kvData ?? {}).map(([k, v]) =>
        env.KV.put(k, JSON.stringify(v)),
      ),
    )
    const response = await worker.fetch(request, env, ctx)
    // Wait for all Promises passed to `ctx.waitUntil()` to settle before
    // asserting
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(responseCode)
  },
)
