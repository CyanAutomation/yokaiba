export interface FetchEntrypoint {
  fetch(request: Request): Promise<Response>;
}

/** Cloudflare exposes ctx.exports bindings as callable proxies. */
export function isFetchEntrypoint(value: unknown): value is FetchEntrypoint {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return "fetch" in value && typeof Reflect.get(value, "fetch") === "function";
}
