-- Entry finalization updates these two derived profile fields through the
-- authenticated server client. Restore only those permissions after migration
-- 016 narrowed profile writes; ai_enabled remains administrator-only.
grant update (
  streak_count,
  last_entry_date
) on table public.profiles to authenticated;
