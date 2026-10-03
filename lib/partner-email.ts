import "server-only";

export function invitationEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.HEARTH_EMAIL_FROM?.trim() && process.env.HEARTH_APP_URL?.trim());
}

export async function sendPartnerInvitation(email: string, invitationId: string): Promise<"sent" | "unavailable" | "failed"> {
  if (!invitationEmailConfigured()) return "unavailable";
  try {
    const base = new URL(process.env.HEARTH_APP_URL!);
    if (base.protocol !== "https:" || base.username || base.password) return "unavailable";
    const url = new URL("/partner", base.origin).href;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `hearth-partner-${invitationId}`,
      },
      body: JSON.stringify({
        from: process.env.HEARTH_EMAIL_FROM!.trim(),
        to: [email],
        subject: "You have a Hearth connection invitation",
        text: `Someone you know has invited you to connect in Hearth. Sign in with this email address to review the invitation:\n\n${url}\n\nYou can accept or decline. Connecting shares only brief glimpses that each person explicitly reviews and publishes. Your journal and private reflections stay private. Invitations expire after seven days.`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    // Never log addresses, provider responses, or keys.
    return "failed";
  }
}
