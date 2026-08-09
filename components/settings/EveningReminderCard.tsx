"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Send, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PushSupport =
  | "checking"
  | "available"
  | "blocked"
  | "install-required"
  | "unsupported";

type ReminderAction = "enable" | "disable" | "test" | "save" | null;

interface StatusMessage {
  kind: "success" | "error";
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  const safariNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    safariNavigator.standalone === true
  );
}

function normalizeReminderTime(value: string): string {
  return /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : "20:00";
}

function formatReminderTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return value;

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < rawData.length; index += 1) {
    bytes[index] = rawData.charCodeAt(index);
  }
  return buffer;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // Use the privacy-safe fallback below.
  }
  return fallback;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  return registration;
}

async function saveSubscription(subscription: PushSubscription): Promise<string> {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!response.ok) {
    throw new Error(await responseError(response, "Could not save this device"));
  }

  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.id !== "string") {
    throw new Error("The reminder service returned an invalid response");
  }

  return body.id;
}

export function EveningReminderCard({
  profileId,
  initialReminderTime,
  timezone,
}: {
  profileId: string;
  initialReminderTime: string;
  timezone: string;
}) {
  const [reminderTime, setReminderTime] = useState(() =>
    normalizeReminderTime(initialReminderTime)
  );
  const [savedReminderTime, setSavedReminderTime] = useState(() =>
    normalizeReminderTime(initialReminderTime)
  );
  const [support, setSupport] = useState<PushSupport>("checking");
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [action, setAction] = useState<ReminderAction>(null);
  const [message, setMessage] = useState<StatusMessage | null>(null);

  const isSubscribed = subscriptionId !== null;

  useEffect(() => {
    let cancelled = false;

    async function inspectCurrentDevice() {
      if (isIosDevice() && !isStandalone()) {
        setSupport("install-required");
        return;
      }

      if (
        !window.isSecureContext ||
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        setSupport("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        setSupport("blocked");
        return;
      }

      let registration: ServiceWorkerRegistration;
      try {
        registration = await registerServiceWorker();
      } catch {
        if (!cancelled) {
          setSupport("unsupported");
          setMessage({ kind: "error", text: "Could not start browser notifications" });
        }
        return;
      }

      if (cancelled) return;
      setSupport("available");

      try {
        const existingSubscription = await registration.pushManager.getSubscription();
        if (!existingSubscription) return;

        const id = await saveSubscription(existingSubscription);
        if (!cancelled) setSubscriptionId(id);
      } catch (error) {
        if (!cancelled) {
          setMessage({
            kind: "error",
            text: error instanceof Error ? error.message : "Could not check this device",
          });
        }
      }
    }

    void inspectCurrentDevice();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveReminderSettings() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
      throw new Error("Choose a valid reminder time");
    }

    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ reminder_time: reminderTime, timezone })
      .eq("id", profileId);

    if (error) throw new Error("Could not save the reminder time");
  }

  async function handleSave() {
    setAction("save");
    setMessage(null);
    try {
      await saveReminderSettings();
      setSavedReminderTime(reminderTime);
      setMessage({ kind: "success", text: "Reminder time saved." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not save the reminder",
      });
    } finally {
      setAction(null);
    }
  }

  async function handleEnable() {
    setAction("enable");
    setMessage(null);

    try {
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();

      if (permission !== "granted") {
        setSupport(permission === "denied" ? "blocked" : "available");
        throw new Error("Notification permission was not granted");
      }

      await saveReminderSettings();
      setSavedReminderTime(reminderTime);

      const keyResponse = await fetch("/api/push/vapid-key", { cache: "no-store" });
      if (!keyResponse.ok) {
        throw new Error(
          await responseError(keyResponse, "Browser reminders are not configured")
        );
      }
      const keyBody: unknown = await keyResponse.json();
      if (!isRecord(keyBody) || typeof keyBody.publicKey !== "string") {
        throw new Error("The reminder service returned an invalid key");
      }

      const registration = await registerServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      let createdSubscription = false;

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(keyBody.publicKey),
        });
        createdSubscription = true;
      }

      try {
        const id = await saveSubscription(subscription);
        setSubscriptionId(id);
      } catch (error) {
        if (createdSubscription) await subscription.unsubscribe();
        throw error;
      }

      setSupport("available");
      setMessage({
        kind: "success",
        text: `Reminders are on for this device at ${formatReminderTime(reminderTime)}.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not enable reminders",
      });
    } finally {
      setAction(null);
    }
  }

  async function handleDisable() {
    setAction("disable");
    setMessage(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) {
          throw new Error(await responseError(response, "Could not disable this device"));
        }
        await subscription.unsubscribe();
      }

      setSubscriptionId(null);
      setMessage({ kind: "success", text: "Reminders are off for this device." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not disable reminders",
      });
    } finally {
      setAction(null);
    }
  }

  async function handleTest() {
    if (!subscriptionId) return;

    setAction("test");
    setMessage(null);
    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {
          const registration = await navigator.serviceWorker.getRegistration("/");
          const subscription = await registration?.pushManager.getSubscription();
          await subscription?.unsubscribe();
          setSubscriptionId(null);
        }
        throw new Error(await responseError(response, "Could not send the test"));
      }

      setMessage({
        kind: "success",
        text: "Test sent. Check your notifications and tap it to open Hearth.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not send the test",
      });
    } finally {
      setAction(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="h-4 w-4 text-primary" />
          Evening reminder
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A private nudge to take two minutes for your journal.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reminder">Reminder time</Label>
          <Input
            id="reminder"
            type="time"
            value={reminderTime}
            onChange={(event) => setReminderTime(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Uses {timezone.replace(/_/g, " ")}. Change the timezone under Profile.
          </p>
        </div>

        <div
          className="rounded-lg border bg-muted/40 p-3 text-sm"
          aria-live="polite"
          aria-atomic="true"
        >
          {support === "checking" ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking this device…
            </div>
          ) : null}

          {support === "install-required" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <Smartphone className="h-4 w-4 text-primary" /> Install Hearth first
              </div>
              <p className="text-muted-foreground">
                On iPhone or iPad, tap Share → Add to Home Screen, open Hearth from its
                new icon, then return here to turn on notifications.
              </p>
            </div>
          ) : null}

          {support === "unsupported" ? (
            <p className="text-muted-foreground">
              This browser cannot receive Hearth notifications. Try the deployed HTTPS
              app in a current browser.
            </p>
          ) : null}

          {support === "blocked" ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <BellOff className="h-4 w-4" /> Notifications are blocked
              </div>
              <p className="text-muted-foreground">
                Allow Hearth in your browser or device notification settings, then reload
                this page.
              </p>
            </div>
          ) : null}

          {support === "available" ? (
            <div className="flex items-start gap-2">
              <Bell className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <p className="font-medium">
                  {isSubscribed ? "On for this device" : "Off for this device"}
                </p>
                <p className="text-muted-foreground">
                  {isSubscribed
                    ? `Hearth will remind you at ${formatReminderTime(savedReminderTime)}. Enable it separately on other devices.`
                    : "Turn it on separately on every phone or browser where you want a reminder."}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={action !== null}
          >
            {action === "save" ? <Loader2 className="animate-spin" /> : null}
            Save reminder
          </Button>

          {support === "available" && !isSubscribed ? (
            <Button onClick={handleEnable} disabled={action !== null}>
              {action === "enable" ? <Loader2 className="animate-spin" /> : <Bell />}
              Turn on for this device
            </Button>
          ) : null}

          {support === "available" && isSubscribed ? (
            <>
              <Button onClick={handleTest} disabled={action !== null}>
                {action === "test" ? <Loader2 className="animate-spin" /> : <Send />}
                Send test notification
              </Button>
              <Button
                variant="ghost"
                onClick={handleDisable}
                disabled={action !== null}
              >
                {action === "disable" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <BellOff />
                )}
                Turn off on this device
              </Button>
            </>
          ) : null}
        </div>

        {message ? (
          <p
            className={
              message.kind === "error" ? "text-sm text-destructive" : "text-sm text-primary"
            }
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
