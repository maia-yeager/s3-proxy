declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    WORKER_HOSTNAME: string
    WORKER_PREFIX: string
  }
}
interface Env extends Cloudflare.Env {}
