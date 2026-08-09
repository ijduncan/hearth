import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, readLimitedJson } from "@/lib/security";
import { parseSubscriptionId } from "@/lib/push-validation";
import {
  getPushStatusCode,
  getVapidPublicKey,
  isExpiredPushSubscription,
  sendHearthPush,
} from "@/lib/push";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(supabase, "push-test", 3, 300);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Please wait before sending another test" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const body = await readLimitedJson(request, 1024);
  if (!body.ok && body.tooLarge) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  const subscriptionId = parseSubscriptionId(body.ok ? body.value : null);
  if (!subscriptionId) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  try {
    getVapidPublicKey();
  } catch {
    return NextResponse.json(
      { error: "Browser reminders are not configured" },
      { status: 503 }
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    console.error("Supabase admin credentials are not configured for push tests");
    return NextResponse.json(
      { error: "Browser reminders are not configured" },
      { status: 503 }
    );
  }

  const { data: subscription, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key, failure_count")
    .eq("id", subscriptionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load push subscription for test");
    return NextResponse.json({ error: "Failed to load subscription" }, { status: 500 });
  }
  if (!subscription) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  try {
    await sendHearthPush(
      {
        endpoint: subscription.endpoint,
        p256dhKey: subscription.p256dh_key,
        authKey: subscription.auth_key,
      },
      {
        title: "Hearth",
        body: "Notifications are working. Your evening reminder will arrive here.",
        url: "/",
        tag: "hearth-notification-test",
      },
      {
        topic: "hearth-test",
        ttlSeconds: 60,
        urgency: "high",
      }
    );

    const { error: updateError } = await admin
      .from("push_subscriptions")
      .update({
        failure_count: 0,
        last_success_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);
    if (updateError) console.error("Failed to record successful test push");

    return NextResponse.json({ accepted: true });
  } catch (pushError) {
    if (isExpiredPushSubscription(pushError)) {
      const { error: deleteError } = await admin
        .from("push_subscriptions")
        .delete()
        .eq("id", subscription.id);
      if (deleteError) console.error("Failed to remove invalid push subscription");

      return NextResponse.json(
        { error: "This subscription expired. Turn reminders on again." },
        { status: 410 }
      );
    }

    const { error: updateError } = await admin
      .from("push_subscriptions")
      .update({
        failure_count: Math.min(subscription.failure_count + 1, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);
    if (updateError) console.error("Failed to record test push failure");

    const statusCode = getPushStatusCode(pushError);
    console.error(`Test push failed${statusCode ? ` (${statusCode})` : ""}`);
    return NextResponse.json(
      { error: "The notification service did not accept the test" },
      { status: 502 }
    );
  }
}
