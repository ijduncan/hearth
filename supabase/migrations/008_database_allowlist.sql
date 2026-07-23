-- Enforce Hearth's allowlist inside Supabase, not only in the web application.
CREATE TABLE public.allowed_emails (
  email text PRIMARY KEY CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 320),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.allowed_emails FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.allowed_emails
    WHERE email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

REVOKE ALL ON FUNCTION public.is_allowed_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_allowed_user() TO authenticated;

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id AND public.is_allowed_user());

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id AND public.is_allowed_user())
  WITH CHECK (auth.uid() = id AND public.is_allowed_user());

DROP POLICY IF EXISTS "Users manage own entries" ON public.entries;
CREATE POLICY "Users manage own entries"
  ON public.entries FOR ALL
  USING (auth.uid() = user_id AND public.is_allowed_user())
  WITH CHECK (auth.uid() = user_id AND public.is_allowed_user());

DROP POLICY IF EXISTS "Users manage own summaries" ON public.weekly_summaries;
CREATE POLICY "Users manage own summaries"
  ON public.weekly_summaries FOR ALL
  USING (auth.uid() = user_id AND public.is_allowed_user())
  WITH CHECK (auth.uid() = user_id AND public.is_allowed_user());

DROP POLICY IF EXISTS "Users manage own monthly summaries" ON public.monthly_summaries;
CREATE POLICY "Users manage own monthly summaries"
  ON public.monthly_summaries FOR ALL
  USING (auth.uid() = user_id AND public.is_allowed_user())
  WITH CHECK (auth.uid() = user_id AND public.is_allowed_user());

DROP POLICY IF EXISTS "Users manage own prompt interactions" ON public.prompt_interactions;
CREATE POLICY "Users manage own prompt interactions"
  ON public.prompt_interactions FOR ALL
  USING (auth.uid() = user_id AND public.is_allowed_user())
  WITH CHECK (auth.uid() = user_id AND public.is_allowed_user());

-- Do not create application profiles for unauthorized Supabase signups.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(coalesce(new.email, ''))
  ) THEN
    INSERT INTO public.profiles (id, display_name)
    VALUES (
      new.id,
      left(coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), 100)
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_api_rate_limit(
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id uuid := auth.uid();
  bucket_start timestamptz;
  current_count integer;
BEGIN
  IF caller_id IS NULL OR NOT public.is_allowed_user() OR
     p_action IS NULL OR char_length(p_action) NOT BETWEEN 1 AND 64 OR
     p_limit NOT BETWEEN 1 AND 1000 OR
     p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    RETURN QUERY SELECT false, 60;
    RETURN;
  END IF;

  bucket_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.api_rate_limits (
    user_id, action, window_start, request_count
  ) VALUES (
    caller_id, p_action, bucket_start, 1
  )
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET request_count = public.api_rate_limits.request_count + 1
  RETURNING request_count INTO current_count;

  RETURN QUERY SELECT
    current_count <= p_limit,
    CASE
      WHEN current_count <= p_limit THEN 0
      ELSE greatest(
        1,
        ceil(extract(epoch FROM (bucket_start + make_interval(secs => p_window_seconds) - now())))::integer
      )
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.check_api_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_api_rate_limit(text, integer, integer) TO authenticated;
