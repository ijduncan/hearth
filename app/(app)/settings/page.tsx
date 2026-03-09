"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { Profile } from "@/lib/types";

const EMOJI_OPTIONS = ["🌿", "🔥", "🌙", "☀️", "🌊", "🪵", "🌸", "⭐", "🍂", "🌻"];

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🌿");
  const [reminderTime, setReminderTime] = useState("20:00");

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
        setProfile(data);
        setDisplayName(data.display_name);
        setAvatarEmoji(data.avatar_emoji);
        setReminderTime(data.reminder_time || "20:00");
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        avatar_emoji: avatarEmoji,
        reminder_time: reminderTime,
      })
      .eq("id", profile.id);
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
            <Label htmlFor="reminder">Evening reminder time</Label>
            <Input
              id="reminder"
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              When you&apos;d like to be reminded to journal (notification support coming soon)
            </p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save changes"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
