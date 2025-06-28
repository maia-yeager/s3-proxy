declare namespace Cloudflare {
  interface Env {
    KV: KVNamespace
    WORKER_HOSTNAME: string
    WORKER_PREFIX: string
  }
}
interface Env extends Cloudflare.Env {}
