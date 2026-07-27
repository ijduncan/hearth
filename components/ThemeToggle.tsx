"use client";

import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("hearth-theme-change", onStoreChange);
      return () =>
        window.removeEventListener("hearth-theme-change", onStoreChange);
    },
    () => document.documentElement.classList.contains("dark"),
    () => false
  );

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    window.dispatchEvent(new Event("hearth-theme-change"));
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="h-8 w-8"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
