"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { Profile } from "@/lib/types";
import { EveningReminderCard } from "@/components/settings/EveningReminderCard";

const EMOJI_OPTIONS = ["🌿", "🔥", "🌙", "☀️", "🌊", "🪵", "🌸", "⭐", "🍂", "🌻", "🌕"];

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🌿");
  const [timezone, setTimezone] = useState(() => "America/Los_Angeles");

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (data) {
        const loadedProfile = {
          ...data,
          timezone: data.timezone || "America/Los_Angeles",
        };
        setProfile(loadedProfile);
        setDisplayName(data.display_name);
        setAvatarEmoji(data.avatar_emoji);
        setTimezone(loadedProfile.timezone);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    setSaveMessage(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        avatar_emoji: avatarEmoji,
        timezone: timezone,
      })
      .eq("id", profile.id);

    if (error) {
      setSaveMessage({ kind: "error", text: "Could not save profile settings." });
      setSaving(false);
      return;
    }

    setProfile({
      ...profile,
      display_name: displayName,
      avatar_emoji: avatarEmoji,
      timezone,
    });
    setSaveMessage({ kind: "success", text: "Profile settings saved." });
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-serif font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Avatar</Label>
            <div className="flex flex-wrap gap-2">
              {EMOJI_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => setAvatarEmoji(emoji)}
                  className={`h-10 w-10 rounded-lg text-xl flex items-center justify-center transition-colors ${
                    avatarEmoji === emoji
                      ? "bg-primary/10 ring-2 ring-primary"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz} className="bg-background text-foreground">
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Used to determine your local date for journal entries
            </p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save changes"
            )}
          </Button>
          {saveMessage ? (
            <p
              className={
                saveMessage.kind === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-primary"
              }
              role={saveMessage.kind === "error" ? "alert" : "status"}
            >
              {saveMessage.text}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {profile ? (
        <EveningReminderCard
          profileId={profile.id}
          initialReminderTime={profile.reminder_time}
          timezone={profile.timezone}
        />
      ) : null}
    </div>
  );
}
