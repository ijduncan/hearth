"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Flame, Loader2 } from "lucide-react";

interface LoginFormProps {
  hasAuthError: boolean;
}

export function LoginForm({ hasAuthError }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(
    hasAuthError
      ? "That sign-in link could not be used. Please request a new one."
      : ""
  );

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const normalizedEmail = email.toLowerCase().trim();
    const supabase = createClient();
    await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });

    // Keep the response deliberately generic so this private app does not
    // reveal which addresses have accounts.
    setEmail(normalizedEmail);
    setSent(true);
    setLoading(false);
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Flame className="h-6 w-6 text-primary" />
          </div>
        </div>
        <h1 className="text-2xl font-serif font-semibold">Hearth</h1>
        <p className="text-sm text-muted-foreground">
          Your private evening journal
        </p>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="text-center space-y-2">
            <p className="text-sm font-medium">Check your email</p>
            <p className="text-sm text-muted-foreground">
              If <strong>{email}</strong> is approved, a sign-in link will arrive
              shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Send magic link"
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
