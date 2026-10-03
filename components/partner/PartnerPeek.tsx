import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { PartnerState } from "@/lib/types";

export function PartnerPeek({ state }: { state: PartnerState | null }) {
  const connection = state?.connection;
  return (
    <Card className="border-primary/20">
      <CardContent className="pt-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-primary" />
            {connection ? (connection.available === false ? "Partner unavailable" : `${connection.partner_name}’s Hearth`) : "A little closer"}
          </p>
          <Link href="/partner" className="text-xs text-primary underline underline-offset-4">
            {state?.incoming.length ? "View invitations" : connection ? "Open Partner" : "Connect a partner"}
          </Link>
        </div>
        {connection?.partner_glimpse ? (
          <>
            <p className="font-serif">{connection.partner_glimpse.text}</p>
            <p className="text-xs text-muted-foreground">Shared glimpse · {connection.partner_glimpse.entry_date}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {connection ? (connection.available === false ? "This account is unavailable. Open Partner to manage your connection." : "Your partner hasn’t shared a glimpse yet.") : "Share a sentence about your day, when you feel ready."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
