-- Turn the placeholder reminder time into an opt-in Web Push feature.

UPDATE public.profiles
SET reminder_time = '20:00'::time
WHERE reminder_time IS NULL;

UPDATE public.profiles AS profile
SET timezone = 'America/Los_Angeles'
WHERE timezone IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM pg_timezone_names
     WHERE name = profile.timezone
   );

ALTER TABLE public.profiles
  ALTER COLUMN reminder_time SET DEFAULT '20:00'::time,
  ALTER COLUMN reminder_time SET NOT NULL,
  ALTER COLUMN timezone SET DEFAULT 'America/Los_Angeles',
  ALTER COLUMN timezone SET NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_profile_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_timezone_names
    WHERE name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'Invalid timezone' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_profile_timezone ON public.profiles;
CREATE TRIGGER validate_profile_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_timezone();

REVOKE ALL ON FUNCTION public.validate_profile_timezone() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL CONSTRAINT push_subscriptions_endpoint_key UNIQUE
    CHECK (char_length(endpoint) BETWEEN 1 AND 4096 AND endpoint LIKE 'https://%'),
  p256dh_key text NOT NULL CHECK (char_length(p256dh_key) BETWEEN 32 AND 512),
  auth_key text NOT NULL CHECK (char_length(auth_key) BETWEEN 8 AND 128),
  expiration_time timestamptz,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_id_idx
  ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

CREATE TABLE public.push_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL
    REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  reminder_date date NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claim_expires_at timestamptz,
  sent_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_reminder_deliveries_subscription_date_key
    UNIQUE (subscription_id, reminder_date)
);

CREATE INDEX push_reminder_deliveries_claim_idx
  ON public.push_reminder_deliveries(status, next_attempt_at, claim_expires_at);

ALTER TABLE public.push_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_reminder_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_reminder_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.clear_push_deliveries_on_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    DELETE FROM public.push_reminder_deliveries
    WHERE subscription_id = OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_push_deliveries_on_owner_change
  BEFORE UPDATE OF user_id ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_push_deliveries_on_owner_change();

REVOKE ALL ON FUNCTION public.clear_push_deliveries_on_owner_change()
  FROM PUBLIC, anon, authenticated;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_now IS NULL OR p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid reminder claim parameters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.push_reminder_deliveries AS expired_delivery
  SET
    status = 'failed',
    claim_token = NULL,
    claim_expires_at = NULL,
    last_error = CASE
      WHEN expired_delivery.attempt_count >= 5 THEN 'Delivery attempts exhausted'
      ELSE 'Delivery window expired'
    END,
    updated_at = p_now
  WHERE (
      expired_delivery.status IN ('pending', 'retry')
      AND (
        expired_delivery.attempt_count >= 5
        OR expired_delivery.scheduled_for <= p_now - interval '2 hours'
      )
    )
    OR (
      expired_delivery.status = 'sending'
      AND expired_delivery.claim_expires_at <= p_now
      AND (
        expired_delivery.attempt_count >= 5
        OR expired_delivery.scheduled_for <= p_now - interval '2 hours'
      )
    );

  WITH candidate_times AS (
    SELECT
      subscription.id AS subscription_id,
      profile.id AS user_id,
      local_day.reminder_date,
      (
        (local_day.reminder_date + profile.reminder_time)
        AT TIME ZONE profile.timezone
      ) AS scheduled_for
    FROM public.profiles AS profile
    JOIN auth.users AS auth_user ON auth_user.id = profile.id
    JOIN public.allowed_emails AS allowed
      ON allowed.email = lower(auth_user.email)
    JOIN public.push_subscriptions AS subscription
      ON subscription.user_id = profile.id
    CROSS JOIN LATERAL (
      VALUES
        ((p_now AT TIME ZONE profile.timezone)::date),
        (((p_now AT TIME ZONE profile.timezone)::date - 1))
    ) AS local_day(reminder_date)
    WHERE (
        subscription.expiration_time IS NULL
        OR subscription.expiration_time > p_now
      )
  ),
  due AS (
    SELECT candidate.*
    FROM candidate_times AS candidate
    WHERE candidate.scheduled_for <= p_now
      AND candidate.scheduled_for > p_now - interval '2 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM public.entries AS entry
        WHERE entry.user_id = candidate.user_id
          AND entry.entry_date = candidate.reminder_date
      )
  )
  INSERT INTO public.push_reminder_deliveries (
    subscription_id,
    reminder_date,
    scheduled_for,
    next_attempt_at
  )
  SELECT
    due.subscription_id,
    due.reminder_date,
    due.scheduled_for,
    p_now
  FROM due
  ON CONFLICT ON CONSTRAINT push_reminder_deliveries_subscription_date_key
    DO NOTHING;

  RETURN QUERY
  WITH claimable AS (
    SELECT delivery.id
    FROM public.push_reminder_deliveries AS delivery
    WHERE delivery.scheduled_for > p_now - interval '2 hours'
      AND delivery.attempt_count < 5
      AND EXISTS (
        SELECT 1
        FROM public.push_subscriptions AS current_subscription
        JOIN public.profiles AS current_profile
          ON current_profile.id = current_subscription.user_id
        JOIN auth.users AS current_auth_user
          ON current_auth_user.id = current_profile.id
        JOIN public.allowed_emails AS current_allowed
          ON current_allowed.email = lower(current_auth_user.email)
        WHERE current_subscription.id = delivery.subscription_id
          AND (
            current_subscription.expiration_time IS NULL
            OR current_subscription.expiration_time > p_now
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.entries AS current_entry
            WHERE current_entry.user_id = current_profile.id
              AND current_entry.entry_date = delivery.reminder_date
          )
      )
      AND (
        (delivery.status IN ('pending', 'retry') AND delivery.next_attempt_at <= p_now)
        OR (delivery.status = 'sending' AND delivery.claim_expires_at <= p_now)
      )
    ORDER BY delivery.scheduled_for, delivery.created_at
    FOR UPDATE OF delivery SKIP LOCKED
    LIMIT p_batch_size
  ),
  claimed AS (
    UPDATE public.push_reminder_deliveries AS delivery
    SET
      status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      claim_token = gen_random_uuid(),
      claim_expires_at = p_now + interval '5 minutes',
      last_error = NULL,
      updated_at = p_now
    FROM claimable
    WHERE delivery.id = claimable.id
    RETURNING delivery.*
  )
  SELECT
    claimed.id,
    subscription.id,
    subscription.endpoint,
    subscription.p256dh_key,
    subscription.auth_key,
    claimed.reminder_date,
    claimed.scheduled_for,
    claimed.claim_token,
    claimed.attempt_count
  FROM claimed
  JOIN public.push_subscriptions AS subscription
    ON subscription.id = claimed.subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_push_reminders(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_push_reminders(integer, timestamptz)
  TO service_role;
