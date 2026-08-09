import { Buffer } from "node:buffer";

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
]);
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

export interface ValidPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64Url(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    BASE64_URL_PATTERN.test(value)
  );
}

function decodeBase64Url(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

export function isValidPushKeys(p256dh: string, auth: string): boolean {
  if (!isBase64Url(p256dh, 32, 512) || !isBase64Url(auth, 8, 128)) {
    return false;
  }

  const decodedP256dh = decodeBase64Url(p256dh);
  const decodedAuth = decodeBase64Url(auth);
  return (
    decodedP256dh?.length === 65 &&
    decodedP256dh[0] === 4 &&
    decodedAuth?.length === 16
  );
}

export function isAllowedPushEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.toLowerCase();
    return (
      endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      (!endpoint.port || endpoint.port === "443") &&
      (EXACT_PUSH_HOSTS.has(hostname) ||
        PUSH_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)))
    );
  } catch {
    return false;
  }
}

export function parsePushSubscription(value: unknown): ValidPushSubscription | null {
  if (!isRecord(value) || typeof value.endpoint !== "string" || !isRecord(value.keys)) {
    return null;
  }

  if (
    !isAllowedPushEndpoint(value.endpoint) ||
    value.endpoint.length > 4096 ||
    typeof value.keys.p256dh !== "string" ||
    typeof value.keys.auth !== "string" ||
    !isValidPushKeys(value.keys.p256dh, value.keys.auth)
  ) {
    return null;
  }

  const expirationTime = value.expirationTime;
  if (
    expirationTime !== undefined &&
    expirationTime !== null &&
    (
      typeof expirationTime !== "number" ||
      !Number.isFinite(expirationTime) ||
      expirationTime < 0 ||
      expirationTime > 8.64e15
    )
  ) {
    return null;
  }

  return {
    endpoint: value.endpoint,
    expirationTime: expirationTime ?? null,
    keys: {
      p256dh: value.keys.p256dh,
      auth: value.keys.auth,
    },
  };
}

export function parseEndpoint(value: unknown): string | null {
  if (!isRecord(value) || typeof value.endpoint !== "string") return null;
  return isAllowedPushEndpoint(value.endpoint) && value.endpoint.length <= 4096
    ? value.endpoint
    : null;
}

export function parseSubscriptionId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.subscriptionId !== "string") return null;
  return UUID_PATTERN.test(value.subscriptionId) ? value.subscriptionId : null;
}
