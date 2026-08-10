-- Users may edit profile presentation and reminder preferences, but AI is a
-- core feature and ai_enabled is an administrator-only emergency kill switch.
-- Column privileges make that boundary enforceable even through direct
-- PostgREST calls; RLS continues to restrict edits to the caller's own row.
revoke update on table public.profiles from anon, authenticated;

grant update (
  display_name,
  avatar_emoji,
  reminder_time,
  timezone
) on table public.profiles to authenticated;
