"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Flame,
  BookOpen,
  BarChart3,
  CalendarDays,
  Settings,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/types";

const NAV_ITEMS = [
  { href: "/", label: "Today", icon: BookOpen },
  { href: "/history", label: "History", icon: CalendarDays },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  profile,
  userId,
  children,
}: {
  profile: Profile | null;
  userId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl flex items-center justify-between px-4 h-14">
          <Link href="/" className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-primary" />
            <span className="font-serif font-semibold text-lg">Hearth</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {profile?.avatar_emoji} {profile?.display_name}
            </span>
            <Button variant="ghost" size="icon" onClick={handleSignOut} className="h-8 w-8">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-2xl px-4 py-6 pb-24">{children}</main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl flex items-center justify-around h-16">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
