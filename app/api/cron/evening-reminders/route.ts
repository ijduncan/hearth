import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyBearerSecret } from "@/lib/security";
import {
  getPushStatusCode,
  getVapidPublicKey,
  isExpiredPushSubscription,
  isRetryablePushError,
  sendHearthPush,
} from "@/lib/push";

export const runtime = "nodejs";

const CLAIM_BATCH_SIZE = 10;
const SEND_CONCURRENCY = 5;

interface ClaimedReminder {
  delivery_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  reminder_date: string;
  scheduled_for: string;
  claim_token: string;
  attempt_count: number;
}

type DeliveryResult = "sent" | "retrying" | "failed" | "expired" | "unfinalized";
type AdminClient = ReturnType<typeof createAdminClient>;

function retryDelaySeconds(attemptCount: number): number {
  return Math.min(60 * 2 ** Math.max(attemptCount - 1, 0), 15 * 60);
}

function safePushError(error: unknown): string {
  const statusCode = getPushStatusCode(error);
  return statusCode ? `Push service returned ${statusCode}` : "Push service request failed";
}

async function processReminder(
  admin: AdminClient,
  reminder: ClaimedReminder
): Promise<DeliveryResult> {
  let pushError: unknown = null;
  try {
    await sendHearthPush(
      {
        endpoint: reminder.endpoint,
        p256dhKey: reminder.p256dh_key,
        authKey: reminder.auth_key,
      },
      {
        title: "Hearth",
        body: "A quiet moment to check in with yourself.",
        url: "/",
        tag: `hearth-evening-${reminder.reminder_date}`,
      },
      {
        topic: `hearth-${reminder.reminder_date.replaceAll("-", "")}`,
        ttlSeconds: 2 * 60 * 60,
      }
    );
  } catch (error) {
    pushError = error;
  }

  if (pushError === null) {
    const sentAt = new Date().toISOString();
    try {
      const { data: finalized, error: finalizeError } = await admin
        .from("push_reminder_deliveries")
        .update({
          status: "sent",
          sent_at: sentAt,
          claim_token: null,
          claim_expires_at: null,
          last_error: null,
          updated_at: sentAt,
        })
        .eq("id", reminder.delivery_id)
        .eq("claim_token", reminder.claim_token)
        .select("id")
        .maybeSingle();

      if (finalizeError || !finalized) {
        console.error("Failed to finalize an accepted evening reminder");
        return "unfinalized";
      }
    } catch {
      console.error("Failed to persist an accepted evening reminder");
      return "unfinalized";
    }

    try {
      const { error: subscriptionError } = await admin
        .from("push_subscriptions")
        .update({
          failure_count: 0,
          last_success_at: sentAt,
          updated_at: sentAt,
        })
        .eq("id", reminder.subscription_id);
      if (subscriptionError) console.error("Failed to record push subscription success");
    } catch {
      console.error("Failed to persist push subscription success");
    }

    return "sent";
  }

  if (isExpiredPushSubscription(pushError)) {
    try {
      const { error: deleteError } = await admin
        .from("push_subscriptions")
        .delete()
        .eq("id", reminder.subscription_id);
      if (deleteError) {
        console.error("Failed to remove expired push subscription");
        return "unfinalized";
      }
    } catch {
      console.error("Failed to persist expired push subscription cleanup");
      return "unfinalized";
    }
    return "expired";
  }

  const canRetry = isRetryablePushError(pushError) && reminder.attempt_count < 5;
  const updatedAt = new Date().toISOString();
  const nextAttemptAt = new Date(
    Date.now() + retryDelaySeconds(reminder.attempt_count) * 1000
  ).toISOString();

  try {
    const { data: finalized, error: finalizeError } = await admin
      .from("push_reminder_deliveries")
      .update({
        status: canRetry ? "retry" : "failed",
        next_attempt_at: nextAttemptAt,
        claim_token: null,
        claim_expires_at: null,
        last_error: safePushError(pushError),
        updated_at: updatedAt,
      })
      .eq("id", reminder.delivery_id)
      .eq("claim_token", reminder.claim_token)
      .select("id")
      .maybeSingle();

    if (finalizeError || !finalized) {
      console.error("Failed to finalize an unsuccessful evening reminder");
      return "unfinalized";
    }
  } catch {
    console.error("Failed to persist an unsuccessful evening reminder");
    return "unfinalized";
  }

  try {
    const { error: subscriptionError } = await admin
      .from("push_subscriptions")
      .update({
        failure_count: Math.min(reminder.attempt_count, 1000),
        updated_at: updatedAt,
      })
      .eq("id", reminder.subscription_id);
    if (subscriptionError) console.error("Failed to record push subscription failure");
  } catch {
    console.error("Failed to persist push subscription failure");
  }

  return canRetry ? "retrying" : "failed";
}

export async function GET(request: Request) {
  if (!verifyBearerSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    getVapidPublicKey();
  } catch {
    return NextResponse.json(
      { error: "Browser reminders are not configured" },
      { status: 503 }
    );
  }

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    console.error("Supabase admin credentials are not configured for reminders");
    return NextResponse.json(
      { error: "Reminder service is not configured" },
      { status: 503 }
    );
  }

  const now = new Date();
  const { error: expirationError } = await admin
    .from("push_subscriptions")
    .delete()
    .lte("expiration_time", now.toISOString());
  if (expirationError) console.error("Failed to prune expired push subscriptions");

  const { data, error } = await admin.rpc("claim_due_push_reminders", {
    p_batch_size: CLAIM_BATCH_SIZE,
    p_now: now.toISOString(),
  });

  if (error) {
    console.error("Failed to claim evening reminders");
    return NextResponse.json({ error: "Failed to claim reminders" }, { status: 500 });
  }

  const reminders = (data ?? []) as ClaimedReminder[];
  const results = {
    claimed: reminders.length,
    sent: 0,
    retrying: 0,
    failed: 0,
    expired: 0,
    unfinalized: 0,
  };

  for (let index = 0; index < reminders.length; index += SEND_CONCURRENCY) {
    const batch = reminders.slice(index, index + SEND_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((reminder) => processReminder(admin, reminder))
    );
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results[result.value] += 1;
      } else {
        console.error("Unexpected evening reminder worker failure");
        results.unfinalized += 1;
      }
    }
  }

  const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const { error: retentionError } = await admin
    .from("push_reminder_deliveries")
    .delete()
    .lt("created_at", retentionCutoff.toISOString());
  if (retentionError) console.error("Failed to prune old reminder deliveries");

  return NextResponse.json({ results });
}
