-- Harden ownership checks and SECURITY DEFINER behavior.
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users manage own entries" ON public.entries;
CREATE POLICY "Users manage own entries"
  ON public.entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own summaries" ON public.weekly_summaries;
CREATE POLICY "Users manage own summaries"
  ON public.weekly_summaries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own monthly summaries" ON public.monthly_summaries;
CREATE POLICY "Users manage own monthly summaries"
  ON public.monthly_summaries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own prompt interactions" ON public.prompt_interactions;
CREATE POLICY "Users manage own prompt interactions"
  ON public.prompt_interactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Database-side bounds backstop the API validation and direct Supabase clients.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length
  CHECK (char_length(display_name) BETWEEN 1 AND 100) NOT VALID;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_text_length
  CHECK (
    char_length(coalesce(prompt_question, '')) <= 500 AND
    char_length(coalesce(prompt_answer, '')) <= 5000 AND
    char_length(coalesce(highlight, '')) <= 2000 AND
    char_length(coalesce(challenge, '')) <= 2000 AND
    char_length(coalesce(gratitude, '')) <= 2000 AND
    char_length(coalesce(free_write, '')) <= 20000 AND
    coalesce(cardinality(mood_tags), 0) <= 10
  ) NOT VALID;

ALTER TABLE public.prompt_interactions
  ADD CONSTRAINT prompt_interactions_text_length
  CHECK (
    char_length(prompt_text) <= 500 AND
    char_length(prompt_category) <= 100
  ) NOT VALID;

ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_display_name_length;
ALTER TABLE public.entries VALIDATE CONSTRAINT entries_text_length;
ALTER TABLE public.prompt_interactions VALIDATE CONSTRAINT prompt_interactions_text_length;
