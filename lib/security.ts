import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);


export function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  try {
    const parsed = new URL(value, "https://hearth.invalid");
    return parsed.origin === "https://hearth.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function isTrustedMutation(request: Request): boolean {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const host =
      request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
      request.headers.get("host") ||
      requestUrl.host;
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
      requestUrl.protocol.slice(0, -1);

    const exactOrigin =
      originUrl.host === host && originUrl.protocol === `${protocol}:`;
    // Some standalone/proxied Next.js deployments normalize the internal Host
    // header. Sec-Fetch-Site is a browser-controlled fallback, not a client
    // supplied application header.
    return (
      exactOrigin || request.headers.get("sec-fetch-site") === "same-origin"
    );
  } catch {
    return false;
  }
}

export function exceedsBodyLimit(request: Request, maxBytes = 64 * 1024): boolean {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) return false;

  const length = Number(rawLength);
  return !Number.isFinite(length) || length < 0 || length > maxBytes;
}

export async function readLimitedJson(
  request: Request,
  maxBytes = 8 * 1024
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean }
> {
  if (exceedsBodyLimit(request, maxBytes)) {
    return { ok: false, tooLarge: true };
  }
  if (!request.body) {
    return { ok: false, tooLarge: false };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }
}

export function verifyBearerSecret(
  authorizationHeader: string | null,
  secret: string | undefined
): boolean {
  if (!authorizationHeader || !secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorizationHeader);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data, error } = await supabase.rpc("check_api_rate_limit", {
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("Rate limit check failed:", error.message);
    return { allowed: false, retryAfterSeconds: 60 };
  }

  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: result?.allowed === true,
    retryAfterSeconds: Number(result?.retry_after_seconds) || 0,
  };
}
