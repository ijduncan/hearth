"use client";

import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyTheme,
  getSystemTheme,
  isThemePreference,
  persistThemePreference,
  readThemePreference,
  THEME_BROADCAST_CHANNEL,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

function getDarkSnapshot() {
  return document.documentElement.classList.contains("dark");
}

function subscribeToTheme(onStoreChange: () => void) {
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  let channel: BroadcastChannel | null = null;

  const reconcileTheme = () => {
    applyTheme(readThemePreference() ?? getSystemTheme());
    onStoreChange();
  };
  const handleThemeChange = () => onStoreChange();
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    reconcileTheme();
  };
  const handleSystemChange = () => {
    if (!readThemePreference()) reconcileTheme();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") reconcileTheme();
  };
  const handleBroadcast = (event: MessageEvent<unknown>) => {
    if (!isThemePreference(event.data)) return;
    applyTheme(event.data);
    onStoreChange();
  };

  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  window.addEventListener("storage", handleStorage);
  window.addEventListener("focus", reconcileTheme);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  colorScheme.addEventListener("change", handleSystemChange);

  try {
    channel = new BroadcastChannel(THEME_BROADCAST_CHANNEL);
    channel.addEventListener("message", handleBroadcast);
  } catch {
    // focus and visibility reconciliation cover browsers without this API.
  }

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("focus", reconcileTheme);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    colorScheme.removeEventListener("change", handleSystemChange);
    channel?.removeEventListener("message", handleBroadcast);
    channel?.close();
  };
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribeToTheme,
    getDarkSnapshot,
    () => false
  );

  const toggle = () => {
    const next = dark ? "light" : "dark";
    applyTheme(next);
    persistThemePreference(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="h-8 w-8"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
