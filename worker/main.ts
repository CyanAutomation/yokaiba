import { WorkerEntrypoint } from "cloudflare:workers";
import { createCachedPublicWorker, createWorker, type Env } from "./index.js";
import { isFetchEntrypoint } from "./entrypoint.js";

const cachedPublicWorker = createCachedPublicWorker();

const gateway = createWorker({
  cachedPublicFetch: async (request, ctx) => {
    const entrypoint: unknown = Reflect.get(ctx.exports, "CachedPublic");
    if (!isFetchEntrypoint(entrypoint)) throw new Error("CachedPublic Worker entrypoint is unavailable or does not expose fetch");
    return entrypoint.fetch(request);
  },
});

export class CachedPublic extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    return cachedPublicWorker.fetch(request, this.env, this.ctx);
  }
}

export default gateway;
