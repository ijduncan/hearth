import "server-only";

import webPush from "web-push";
import { isAllowedPushEndpoint, isValidPushKeys } from "@/lib/push-validation";

class PermanentPushError extends Error {}

export interface StoredPushSubscription {
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

export interface HearthPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

interface SendPushOptions {
  topic: string;
  ttlSeconds: number;
  urgency?: "very-low" | "low" | "normal" | "high";
}

function getVapidDetails() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || (!subject.startsWith("mailto:") && !subject.startsWith("https://"))) {
    throw new Error("VAPID_SUBJECT must be a mailto: or https:// URL");
  }
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are not configured");
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  return { subject, publicKey, privateKey };
}

export function getVapidPublicKey(): string {
  return getVapidDetails().publicKey;
}

export async function sendHearthPush(
  subscription: StoredPushSubscription,
  payload: HearthPushPayload,
  options: SendPushOptions
) {
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    throw new PermanentPushError("Unsupported push service endpoint");
  }
  if (!isValidPushKeys(subscription.p256dhKey, subscription.authKey)) {
    throw new PermanentPushError("Invalid push subscription keys");
  }

  const vapidDetails = getVapidDetails();

  return webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dhKey,
        auth: subscription.authKey,
      },
    },
    JSON.stringify(payload),
    {
      TTL: options.ttlSeconds,
      timeout: 10_000,
      urgency: options.urgency ?? "normal",
      topic: options.topic,
      vapidDetails,
    }
  );
}

export function getPushStatusCode(error: unknown): number | null {
  if (error instanceof webPush.WebPushError) {
    return error.statusCode;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return null;
}

export function isExpiredPushSubscription(error: unknown): boolean {
  const statusCode = getPushStatusCode(error);
  return statusCode === 404 || statusCode === 410;
}

export function isRetryablePushError(error: unknown): boolean {
  if (error instanceof PermanentPushError) return false;
  const statusCode = getPushStatusCode(error);
  return statusCode === null || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}
