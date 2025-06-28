import { proxy } from "./proxy"

export default {
  async fetch(request, env: Env) {
    const url = new URL(request.url)

    if (url.hostname === env.WORKER_HOSTNAME) {
      // Redirect empty path and search to admin page.
      if (url.pathname === "/" && url.search === "") {
        return Response.redirect(`https://${env.WORKER_HOSTNAME}/admin/`, 307)
      }
      // Admin management page. Use a 404 to force Worker to fall back to SPA mode.
      if (url.pathname.startsWith("/admin")) {
        return new Response("Not found", { status: 404 })
      }
    }

    // S3 proxy.
    return proxy(url, request, env)
  },
} satisfies ExportedHandler<Env>
