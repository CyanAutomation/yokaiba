const encoder = new TextEncoder();

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signTokenPayload(secret: string, encodedPayload: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(encodedPayload)));
}

export async function isValidTokenSignature(encodedPayload: string, encodedSignature: string, secret: string): Promise<boolean> {
  const suppliedSignature = base64UrlDecode(encodedSignature);
  if (!suppliedSignature) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      suppliedSignature as unknown as BufferSource,
      encoder.encode(encodedPayload),
    );
  } catch {
    return false;
  }
}

export function tokenSecretList(secrets: string | readonly string[]): string[] {
  const values = typeof secrets === "string" ? [secrets] : [...secrets];
  return [...new Set(values.filter(value => typeof value === "string" && value.length > 0))];
}
