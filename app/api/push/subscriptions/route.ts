import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, readLimitedJson } from "@/lib/security";
import { parseEndpoint, parsePushSubscription } from "@/lib/push-validation";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(supabase, "push-subscription", 10, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const body = await readLimitedJson(request);
  if (!body.ok && body.tooLarge) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  const subscription = parsePushSubscription(body.ok ? body.value : null);
  if (!subscription) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Browser reminders are not configured" },
      { status: 503 }
    );
  }

  try {
    const expirationTime =
      subscription.expirationTime === null
        ? null
        : new Date(subscription.expirationTime).toISOString();
    const userAgent = request.headers.get("user-agent")?.slice(0, 512) || null;

    const { data, error } = await admin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh_key: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          expiration_time: expirationTime,
          user_agent: userAgent,
          failure_count: 0,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      )
      .select("id")
      .single();

    if (error || !data) {
      console.error("Failed to save push subscription");
      return NextResponse.json(
        { error: "Failed to enable browser reminders" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    console.error(
      "Unexpected error while saving push subscription:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Failed to enable browser reminders" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readLimitedJson(request);
  if (!body.ok && body.tooLarge) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  const endpoint = parseEndpoint(body.ok ? body.value : null);
  if (!endpoint) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Browser reminders are not configured" },
      { status: 503 }
    );
  }

  try {
    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);

    if (error) {
      console.error("Failed to delete push subscription");
      return NextResponse.json(
        { error: "Failed to disable browser reminders" },
        { status: 500 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error(
      "Unexpected error while deleting push subscription:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json(
      { error: "Failed to disable browser reminders" },
      { status: 500 }
    );
  }
}
