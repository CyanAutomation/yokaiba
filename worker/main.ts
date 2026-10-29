import { WorkerEntrypoint } from "cloudflare:workers";
import { createCachedPublicWorker, createWorker, type Env } from "./index.js";

const cachedPublicWorker = createCachedPublicWorker();

function isFetchEntrypoint(value: unknown): value is { fetch(request: Request): Promise<Response> } {
  return typeof value === "object"
    && value !== null
    && "fetch" in value
    && typeof value.fetch === "function";
}

const gateway = createWorker({
  cachedPublicFetch: async (request, ctx) => {
    const entrypoint: unknown = Reflect.get(ctx.exports, "CachedPublic");
    if (!isFetchEntrypoint(entrypoint)) throw new Error("CachedPublic Worker entrypoint is unavailable");
    return entrypoint.fetch(request);
  },
});

export class CachedPublic extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    return cachedPublicWorker.fetch(request, this.env, this.ctx);
  }
}

export default gateway;
