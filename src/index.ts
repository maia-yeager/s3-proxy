import { env } from "cloudflare:workers"
import { proxy } from "./proxy"

export default {
  async fetch(request: Request) {
    const url = new URL(request.url)

    // Redirect empty path and search to admin page.
    if (
      url.hostname === env.WORKER_HOSTNAME &&
      url.pathname === "/" &&
      url.search === ""
    ) {
      return Response.redirect(`https://${env.WORKER_HOSTNAME}/admin/`, 307)
    }
    // Admin management page.
    if (
      url.hostname === env.WORKER_HOSTNAME &&
      url.pathname.startsWith("/admin")
    ) {
      return new Response("Not implemented", { status: 501 })
    }
    // S3 proxy.
    return proxy(url, request)
  },
}
