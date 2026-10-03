"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HeartHandshake, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { PartnerState } from "@/lib/types";
import { validateGlimpse, wordCount } from "@/lib/partner-validation";

export function PartnerPanel({ initialState, entries }: {
  initialState: PartnerState | null;
  entries: Array<{ id: string; entry_date: string }>;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [email, setEmail] = useState("");
  const [entryId, setEntryId] = useState(entries[0]?.id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialState ? null : "Could not load connections. Try refreshing.");
  const connection = state?.connection;

  async function refresh() {
    const response = await fetch("/api/partner", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load connections");
    setState(data);
    router.refresh();
  }

  async function act(action: string, id?: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/partner", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, email, entryId, text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update connection");
      if (action === "share" || action === "disconnect") setText("");
      if (action === "invite") setEmail("");
      setMessage(data.message || (action === "share" ? "Your glimpse is shared." : action === "withdraw" ? "Your glimpse has been withdrawn." : "Connection updated."));
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update connection");
    } finally { setBusy(false); }
  }

  async function draft() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/partner/glimpse", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not draft glimpse");
      setText(data.text);
      setMessage("Draft ready. Review or edit it, then share only if you’re comfortable.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not draft glimpse");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-serif font-semibold flex items-center gap-2"><HeartHandshake className="h-6 w-6 text-primary" /> Partner</h1>
        <p className="text-sm text-muted-foreground">A small window into each other’s day. Connect by invitation, then choose what to share.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm text-primary">{message}</p>}
      {!state && <Button disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await refresh(); } catch { setError("Could not load connections. Try again later."); } finally { setBusy(false); }
      }}>Refresh connections</Button>}

      {state?.incoming.map(invitation => (
        <Card key={invitation.id} className="border-primary/20">
          <CardHeader><CardTitle className="text-base">{invitation.name} wants to connect</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Accepting connects your accounts. Each of you still reviews and shares your own glimpses. Your journals stay private.</p>
            <p className="text-xs text-muted-foreground">Expires {new Date(invitation.expires_at).toLocaleDateString()}</p>
            <div className="flex gap-2">
              <Button disabled={busy || Boolean(connection)} onClick={() => act("accept", invitation.id)}>Accept connection</Button>
              <Button variant="outline" disabled={busy} onClick={() => act("decline", invitation.id)}>Decline</Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {connection ? (
        <>
          <Card className="border-primary/20">
            <CardHeader><CardTitle className="text-base">{connection.available === false ? "Partner unavailable" : `${connection.partner_name}’s Hearth`}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {connection.partner_glimpse ? <>
                <p className="font-serif text-lg">{connection.partner_glimpse.text}</p>
                <p className="text-xs text-muted-foreground">For {connection.partner_glimpse.entry_date} · Shared by your partner</p>
              </> : <p className="text-sm text-muted-foreground">No shared glimpse yet. Everyone shares at their own pace.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Your glimpse</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {connection.own_glimpse && <div className="space-y-2 rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Currently shared · {connection.own_glimpse.entry_date}</p>
                <p className="font-serif">{connection.own_glimpse.text}</p>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => act("withdraw", connection.id)}>Withdraw glimpse</Button>
              </div>}
              {connection.available === false ? <p className="text-sm text-muted-foreground">Your partner’s account is unavailable. Sharing is paused; you can still withdraw your glimpse or disconnect.</p> : entries.length ? <>
                <div className="space-y-2">
                  <Label htmlFor="glimpse-entry">Saved journal entry</Label>
                  <select id="glimpse-entry" value={entryId} disabled={busy} onChange={event => { setEntryId(event.target.value); setText(""); }}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {entries.map(entry => <option key={entry.id} value={entry.id}>{entry.entry_date}</option>)}
                  </select>
                </div>
                <Button variant="outline" disabled={busy || !entryId} onClick={draft}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft a glimpse
                </Button>
                <div className="space-y-2">
                  <Label htmlFor="glimpse-text">Review your sentence, or write your own</Label>
                  <textarea id="glimpse-text" value={text} maxLength={240} rows={3} disabled={busy}
                    onChange={event => setText(event.target.value)} aria-describedby="glimpse-limit"
                    placeholder="Today felt tiring, but a quiet moment helped me feel more settled."
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
                  <p id="glimpse-limit" className="text-xs text-muted-foreground">{wordCount(text)}/15 words · One sentence. Only this sentence and its date are shared.</p>
                </div>
                <Button disabled={busy || !entryId || !validateGlimpse(text)} onClick={() => act("share", connection.id)}>Share with {connection.partner_name}</Button>
                <p className="text-xs text-muted-foreground">Your latest shared glimpse replaces the previous one. Nothing is shared automatically.</p>
              </> : <p className="text-sm text-muted-foreground">Save a journal entry first, then come back to share a glimpse.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 space-y-3">
              <p className="text-sm text-muted-foreground">Disconnecting removes both shared glimpses and ends access immediately.</p>
              <Button variant="outline" disabled={busy} onClick={() => act("disconnect", connection.id)}>Disconnect from {connection.partner_name}</Button>
            </CardContent>
          </Card>
        </>
      ) : state ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Invite your partner</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter the email they use for Hearth. They’ll receive an invitation to accept or decline. You can connect with one partner at a time.</p>
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); void act("invite"); }}>
              <Label htmlFor="partner-email">Their Hearth email</Label>
              <Input id="partner-email" type="email" maxLength={320} autoComplete="email" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} placeholder="partner@example.com" />
              <Button disabled={busy || !email.trim()} type="submit">{busy ? "Sending..." : "Send invitation"}</Button>
            </form>
            {state.outgoing.map(invitation => <div key={invitation.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted p-3">
              <p className="text-sm">Waiting for {invitation.name} · Expires {new Date(invitation.expires_at).toLocaleDateString()}</p>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act("cancel", invitation.id)}>Cancel</Button>
            </div>)}
          </CardContent>
        </Card>
      ) : null}
      <p className="text-xs text-muted-foreground">Your partner sees only a sentence you choose to share. Journal entries, mood scores, drafts, reflections, and exports remain private.</p>
    </div>
  );
}
