import { proxy } from "./proxy"

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (
      url.hostname === env.WORKER_HOSTNAME &&
      url.pathname.startsWith("admin/")
    ) {
      return new Response("Not implemented", { status: 501 })
    }
    return proxy(url, request, env)
  },
}
