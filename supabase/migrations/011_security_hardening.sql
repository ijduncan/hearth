-- Close privilege, offboarding, and cost-control gaps found in the production audit.

-- Always authorize against the current Auth identity rather than a potentially
-- stale email claim in an access token.
CREATE OR REPLACE FUNCTION public.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    JOIN public.allowed_emails AS allowed
      ON allowed.email = lower(auth_user.email)
    WHERE auth_user.id = auth.uid()
      AND auth_user.email_confirmed_at IS NOT NULL
      AND auth_user.deleted_at IS NULL
      AND (
        auth_user.banned_until IS NULL
        OR auth_user.banned_until <= now()
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_allowed_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_allowed_user() TO authenticated;

UPDATE public.profiles
SET display_name = CASE
  WHEN btrim(display_name) = '' THEN 'friend'
  ELSE left(btrim(display_name), 100)
END;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_display_name_length;

ALTER TABLE public.profiles
  ADD COLUMN ai_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length
  CHECK (
    display_name = btrim(display_name)
    AND char_length(display_name) BETWEEN 1 AND 100
  );

-- Store the input hash only after an acknowledgment is successfully generated.
-- Replaying an unchanged entry can then reuse the prior result without another
-- provider call.
ALTER TABLE public.entries
  ADD COLUMN ai_content_hash text,
  ADD COLUMN ai_input_hash text,
  ADD COLUMN ai_claim_token uuid,
  ADD COLUMN ai_claim_hash text,
  ADD COLUMN ai_claim_expires_at timestamptz;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_ai_content_hash_format
  CHECK (
    ai_content_hash IS NULL
    OR ai_content_hash ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE public.entries
  ADD CONSTRAINT entries_ai_input_hash_format
  CHECK (
    ai_input_hash IS NULL
    OR ai_input_hash ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE public.entries
  ADD CONSTRAINT entries_ai_claim_hash_format
  CHECK (
    ai_claim_hash IS NULL
    OR ai_claim_hash ~ '^[0-9a-f]{64}$'
  );

CREATE OR REPLACE FUNCTION public.invalidate_entry_ai_on_content_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.mood_score IS DISTINCT FROM NEW.mood_score
     OR OLD.mood_label IS DISTINCT FROM NEW.mood_label
     OR OLD.prompt_question IS DISTINCT FROM NEW.prompt_question
     OR OLD.prompt_answer IS DISTINCT FROM NEW.prompt_answer
     OR OLD.highlight IS DISTINCT FROM NEW.highlight
     OR OLD.challenge IS DISTINCT FROM NEW.challenge
     OR OLD.gratitude IS DISTINCT FROM NEW.gratitude
     OR OLD.free_write IS DISTINCT FROM NEW.free_write THEN
    IF NEW.ai_content_hash IS NOT DISTINCT FROM OLD.ai_content_hash THEN
      NEW.ai_content_hash := NULL;
    END IF;
    NEW.ai_acknowledgment := NULL;
    NEW.ai_generated_at := NULL;
    NEW.ai_input_hash := NULL;
    NEW.ai_claim_token := NULL;
    NEW.ai_claim_hash := NULL;
    NEW.ai_claim_expires_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_entry_ai_on_content_change
  BEFORE UPDATE OF
    mood_score,
    mood_label,
    prompt_question,
    prompt_answer,
    highlight,
    challenge,
    gratitude,
    free_write
  ON public.entries
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidate_entry_ai_on_content_change();

REVOKE ALL ON FUNCTION public.invalidate_entry_ai_on_content_change()
  FROM PUBLIC, anon, authenticated;

-- Claim and complete acknowledgment generations atomically. A newer edit
-- replaces the active claim, so a slow response for old content can never
-- overwrite the acknowledgment for the current entry.
CREATE OR REPLACE FUNCTION public.claim_entry_ai_generation(
  p_entry_id uuid,
  p_input_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_entry public.entries%ROWTYPE;
  new_claim_token uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_allowed_user()
     OR p_entry_id IS NULL
     OR p_input_hash IS NULL
     OR p_input_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT entry.*
  INTO current_entry
  FROM public.entries AS entry
  WHERE entry.id = p_entry_id
    AND entry.user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND
     OR current_entry.ai_content_hash IS DISTINCT FROM p_input_hash
     OR (
       current_entry.ai_input_hash = p_input_hash
       AND current_entry.ai_acknowledgment IS NOT NULL
     )
     OR (
       current_entry.ai_claim_hash = p_input_hash
       AND current_entry.ai_claim_expires_at > now()
     ) THEN
    RETURN NULL;
  END IF;

  new_claim_token := gen_random_uuid();
  UPDATE public.entries AS entry
  SET
    ai_acknowledgment = CASE
      WHEN entry.ai_input_hash = p_input_hash THEN entry.ai_acknowledgment
      ELSE NULL
    END,
    ai_generated_at = CASE
      WHEN entry.ai_input_hash = p_input_hash THEN entry.ai_generated_at
      ELSE NULL
    END,
    ai_input_hash = CASE
      WHEN entry.ai_input_hash = p_input_hash THEN entry.ai_input_hash
      ELSE NULL
    END,
    ai_claim_token = new_claim_token,
    ai_claim_hash = p_input_hash,
    ai_claim_expires_at = now() + interval '5 minutes'
  WHERE entry.id = current_entry.id;

  RETURN new_claim_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_entry_ai_generation(
  p_entry_id uuid,
  p_input_hash text,
  p_claim_token uuid,
  p_acknowledgment text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_allowed_user()
     OR p_input_hash IS NULL
     OR p_input_hash !~ '^[0-9a-f]{64}$'
     OR p_claim_token IS NULL
     OR p_acknowledgment IS NULL
     OR btrim(p_acknowledgment) = ''
     OR char_length(p_acknowledgment) > 20000 THEN
    RETURN false;
  END IF;

  UPDATE public.entries AS entry
  SET
    ai_acknowledgment = p_acknowledgment,
    ai_generated_at = now(),
    ai_input_hash = p_input_hash,
    ai_claim_token = NULL,
    ai_claim_hash = NULL,
    ai_claim_expires_at = NULL
  WHERE entry.id = p_entry_id
    AND entry.user_id = auth.uid()
    AND entry.ai_content_hash = p_input_hash
    AND entry.ai_claim_token = p_claim_token
    AND entry.ai_claim_hash = p_input_hash
    AND entry.ai_claim_expires_at > now();

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_entry_ai_generation(
  p_entry_id uuid,
  p_claim_token uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.entries AS entry
  SET
    ai_claim_token = NULL,
    ai_claim_hash = NULL,
    ai_claim_expires_at = NULL
  WHERE entry.id = p_entry_id
    AND entry.user_id = auth.uid()
    AND entry.ai_claim_token = p_claim_token;
$$;

REVOKE ALL ON FUNCTION public.claim_entry_ai_generation(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_entry_ai_generation(uuid, text, uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_entry_ai_generation(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_entry_ai_generation(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_entry_ai_generation(uuid, text, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_entry_ai_generation(uuid, uuid)
  TO authenticated;

-- Restrict the SECURITY DEFINER rate-limit function to the exact application
-- actions and quotas. This prevents authenticated callers from manufacturing
-- arbitrary buckets to grow the table without bound.
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
  expected_limit integer;
  expected_window integer;
  bucket_start timestamptz;
  current_count integer;
BEGIN
  SELECT configured.request_limit, configured.window_seconds
  INTO expected_limit, expected_window
  FROM (
    VALUES
      ('entries', 20, 60),
      ('entry-ai-daily', 10, 86400),
      ('weekly-summary', 5, 900),
      ('weekly-summary-daily', 2, 86400),
      ('monthly-summary', 5, 900),
      ('monthly-summary-daily', 3, 86400),
      ('therapist-summary', 2, 3600),
      ('therapist-summary-daily', 5, 86400),
      ('prompt-swap', 30, 60),
      ('push-subscription', 10, 60),
      ('push-test', 3, 300)
  ) AS configured(action, request_limit, window_seconds)
  WHERE configured.action = p_action;

  IF caller_id IS NULL
     OR NOT public.is_allowed_user()
     OR expected_limit IS NULL
     OR p_limit IS DISTINCT FROM expected_limit
     OR p_window_seconds IS DISTINCT FROM expected_window THEN
    RETURN QUERY SELECT false, 60;
    RETURN;
  END IF;

  DELETE FROM public.api_rate_limits AS stale
  WHERE stale.user_id = caller_id
    AND stale.window_start < now() - interval '2 days';

  bucket_start := to_timestamp(
    floor(extract(epoch FROM now()) / expected_window) * expected_window
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
    current_count <= expected_limit,
    CASE
      WHEN current_count <= expected_limit THEN 0
      ELSE greatest(
        1,
        ceil(
          extract(
            epoch FROM (
              bucket_start
              + make_interval(secs => expected_window)
              - now()
            )
          )
        )::integer
      )
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.check_api_rate_limit(text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_api_rate_limit(text, integer, integer)
  TO authenticated;

CREATE TABLE public.ai_summary_generation_claims (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  summary_kind text NOT NULL CHECK (summary_kind IN ('weekly', 'monthly')),
  period_start date NOT NULL,
  claim_token uuid NOT NULL,
  claim_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, summary_kind, period_start)
);

ALTER TABLE public.ai_summary_generation_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_summary_generation_claims
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_summary_generation_claims
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_summary_generation(
  p_user_id uuid,
  p_summary_kind text,
  p_period_start date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_claim_token uuid := gen_random_uuid();
  saved_claim_token uuid;
BEGIN
  IF p_user_id IS NULL
     OR p_period_start IS NULL
     OR p_summary_kind IS NULL
     OR p_summary_kind NOT IN ('weekly', 'monthly')
     OR auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.ai_summary_generation_claims (
    user_id,
    summary_kind,
    period_start,
    claim_token,
    claim_expires_at
  ) VALUES (
    p_user_id,
    p_summary_kind,
    p_period_start,
    new_claim_token,
    now() + interval '15 minutes'
  )
  ON CONFLICT (user_id, summary_kind, period_start)
  DO UPDATE SET
    claim_token = EXCLUDED.claim_token,
    claim_expires_at = EXCLUDED.claim_expires_at,
    created_at = now()
  WHERE public.ai_summary_generation_claims.claim_expires_at <= now()
  RETURNING claim_token INTO saved_claim_token;

  RETURN saved_claim_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_summary_generation(
  p_user_id uuid,
  p_summary_kind text,
  p_period_start date,
  p_claim_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN;
  END IF;

  DELETE FROM public.ai_summary_generation_claims AS claim
  WHERE claim.user_id = p_user_id
    AND claim.summary_kind = p_summary_kind
    AND claim.period_start = p_period_start
    AND claim.claim_token = p_claim_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_summary_generation(uuid, text, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_summary_generation(uuid, text, date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_summary_generation(uuid, text, date)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_summary_generation(uuid, text, date, uuid)
  TO service_role;

-- Service-only eligibility boundary for jobs that bypass RLS. Offboarded,
-- deleted, banned, or unconfirmed identities never reach journal reads or the
-- AI provider.
CREATE OR REPLACE FUNCTION public.get_allowed_profiles_for_cron()
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT profile.id, profile.display_name
  FROM public.profiles AS profile
  JOIN auth.users AS auth_user
    ON auth_user.id = profile.id
  JOIN public.allowed_emails AS allowed
    ON allowed.email = lower(auth_user.email)
  WHERE auth_user.email_confirmed_at IS NOT NULL
    AND profile.ai_enabled = true
    AND auth_user.deleted_at IS NULL
    AND (
      auth_user.banned_until IS NULL
      OR auth_user.banned_until <= now()
    );
$$;

REVOKE ALL ON FUNCTION public.get_allowed_profiles_for_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_allowed_profiles_for_cron()
  TO service_role;

-- Serialize endpoint writes and require proof of the existing subscription
-- keys before moving a browser subscription between accounts. The API performs
-- stricter provider-host and key-shape validation before invoking this RPC.
CREATE OR REPLACE FUNCTION public.upsert_push_subscription_for_user(
  p_user_id uuid,
  p_endpoint text,
  p_p256dh_key text,
  p_auth_key text,
  p_expiration_time timestamptz,
  p_user_agent text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing_subscription public.push_subscriptions%ROWTYPE;
  saved_id uuid;
BEGIN
  IF p_user_id IS NULL
     OR p_endpoint IS NULL
     OR char_length(p_endpoint) NOT BETWEEN 1 AND 4096
     OR p_endpoint NOT LIKE 'https://%'
     OR p_p256dh_key IS NULL
     OR char_length(p_p256dh_key) NOT BETWEEN 32 AND 512
     OR p_auth_key IS NULL
     OR char_length(p_auth_key) NOT BETWEEN 8 AND 128
     OR (p_user_agent IS NOT NULL AND char_length(p_user_agent) > 512) THEN
    RAISE EXCEPTION 'Invalid push subscription' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    JOIN auth.users AS auth_user
      ON auth_user.id = profile.id
    JOIN public.allowed_emails AS allowed
      ON allowed.email = lower(auth_user.email)
    WHERE profile.id = p_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
      AND auth_user.deleted_at IS NULL
      AND (
        auth_user.banned_until IS NULL
        OR auth_user.banned_until <= now()
      )
  ) THEN
    RAISE EXCEPTION 'User is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint, 0));

  SELECT subscription.*
  INTO existing_subscription
  FROM public.push_subscriptions AS subscription
  WHERE subscription.endpoint = p_endpoint
  FOR UPDATE;

  IF FOUND THEN
    IF existing_subscription.user_id IS DISTINCT FROM p_user_id
       AND (
         existing_subscription.p256dh_key IS DISTINCT FROM p_p256dh_key
         OR existing_subscription.auth_key IS DISTINCT FROM p_auth_key
       ) THEN
      RAISE EXCEPTION 'Push subscription ownership conflict'
        USING ERRCODE = '42501';
    END IF;

    IF existing_subscription.user_id IS DISTINCT FROM p_user_id
       AND (
         SELECT count(*)
         FROM public.push_subscriptions AS owned_subscription
         WHERE owned_subscription.user_id = p_user_id
       ) >= 10 THEN
      RAISE EXCEPTION 'Push subscription limit reached'
        USING ERRCODE = '54000';
    END IF;

    UPDATE public.push_subscriptions AS subscription
    SET
      user_id = p_user_id,
      p256dh_key = p_p256dh_key,
      auth_key = p_auth_key,
      expiration_time = p_expiration_time,
      user_agent = p_user_agent,
      failure_count = 0,
      last_seen_at = now(),
      updated_at = now()
    WHERE subscription.id = existing_subscription.id
    RETURNING subscription.id INTO saved_id;

    RETURN saved_id;
  END IF;

  IF (
    SELECT count(*)
    FROM public.push_subscriptions AS owned_subscription
    WHERE owned_subscription.user_id = p_user_id
  ) >= 10 THEN
    RAISE EXCEPTION 'Push subscription limit reached'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id,
    endpoint,
    p256dh_key,
    auth_key,
    expiration_time,
    user_agent
  ) VALUES (
    p_user_id,
    p_endpoint,
    p_p256dh_key,
    p_auth_key,
    p_expiration_time,
    p_user_agent
  )
  RETURNING id INTO saved_id;

  RETURN saved_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_subscription_for_user(
  uuid, text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription_for_user(
  uuid, text, text, text, timestamptz, text
) TO service_role;

-- Keep the battle-tested delivery claim implementation from migration 010,
-- but put an authorization filter around its returned work. The inner claim
-- may temporarily lease an ineligible row; it is never returned to the sender
-- and therefore can never produce a notification.
ALTER FUNCTION public.claim_due_push_reminders(integer, timestamptz)
  RENAME TO claim_due_push_reminders_unfiltered;

REVOKE ALL ON FUNCTION public.claim_due_push_reminders_unfiltered(
  integer, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_due_push_reminders(
  p_batch_size integer DEFAULT 50,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  delivery_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh_key text,
  auth_key text,
  reminder_date date,
  scheduled_for timestamptz,
  claim_token uuid,
  attempt_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT claimed.*
  FROM public.claim_due_push_reminders_unfiltered(
    p_batch_size,
    p_now
  ) AS claimed
  JOIN public.push_subscriptions AS subscription
    ON subscription.id = claimed.subscription_id
  JOIN auth.users AS auth_user
    ON auth_user.id = subscription.user_id
  JOIN public.allowed_emails AS allowed
    ON allowed.email = lower(auth_user.email)
  WHERE auth_user.email_confirmed_at IS NOT NULL
    AND auth_user.deleted_at IS NULL
    AND (
      auth_user.banned_until IS NULL
      OR auth_user.banned_until <= p_now
    );
$$;

REVOKE ALL ON FUNCTION public.claim_due_push_reminders(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_push_reminders(integer, timestamptz)
  TO service_role;
