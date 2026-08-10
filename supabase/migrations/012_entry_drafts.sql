-- Persist in-progress journal entries without exposing them to AI generation.
-- Draft saves and finalization use a shared per-user/date advisory lock.

CREATE TABLE public.entry_drafts (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  last_client_id uuid NOT NULL,
  last_client_sequence bigint NOT NULL,
  step text NOT NULL,
  mood_score numeric(3, 1),
  mood_tags text[] NOT NULL DEFAULT '{}',
  prompt_question text,
  prompt_category text,
  prompt_answer text,
  highlight text,
  challenge text,
  gratitude text,
  free_write text,
  swap_count integer NOT NULL DEFAULT 0,
  duration_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entry_date),
  CONSTRAINT entry_drafts_date_range
    CHECK (entry_date >= DATE '0001-01-01'),
  CONSTRAINT entry_drafts_revision_range
    CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT entry_drafts_client_sequence_range
    CHECK (last_client_sequence BETWEEN 1 AND 9007199254740991),
  CONSTRAINT entry_drafts_step_values
    CHECK (step IN ('mood', 'questions', 'freewrite')),
  CONSTRAINT entry_drafts_mood_score_range
    CHECK (mood_score IS NULL OR mood_score BETWEEN 1 AND 10),
  CONSTRAINT entry_drafts_mood_tag_count
    CHECK (cardinality(mood_tags) <= 10),
  CONSTRAINT entry_drafts_text_lengths
    CHECK (
      char_length(coalesce(prompt_question, '')) <= 500
      AND char_length(coalesce(prompt_category, '')) <= 100
      AND char_length(coalesce(prompt_answer, '')) <= 5000
      AND char_length(coalesce(highlight, '')) <= 2000
      AND char_length(coalesce(challenge, '')) <= 2000
      AND char_length(coalesce(gratitude, '')) <= 2000
      AND char_length(coalesce(free_write, '')) <= 20000
    ),
  CONSTRAINT entry_drafts_swap_count_range
    CHECK (swap_count BETWEEN 0 AND 3),
  CONSTRAINT entry_drafts_duration_range
    CHECK (duration_seconds BETWEEN 0 AND 86400)
);

ALTER TABLE public.entry_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own entry drafts"
  ON public.entry_drafts FOR SELECT
  USING (
    auth.uid() = user_id
    AND public.is_allowed_user()
  );

CREATE POLICY "Users create own entry drafts"
  ON public.entry_drafts FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_allowed_user()
  );

CREATE POLICY "Users update own entry drafts"
  ON public.entry_drafts FOR UPDATE
  USING (
    auth.uid() = user_id
    AND public.is_allowed_user()
  )
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_allowed_user()
  );

CREATE POLICY "Users delete own entry drafts"
  ON public.entry_drafts FOR DELETE
  USING (
    auth.uid() = user_id
    AND public.is_allowed_user()
  );

-- Authenticated clients can read their draft through RLS. Every mutation is
-- constrained to the SECURITY DEFINER RPCs below so revision checks cannot be
-- bypassed through the public PostgREST table endpoint.
REVOKE ALL ON TABLE public.entry_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.entry_drafts TO authenticated;

-- Array cardinality alone cannot enforce the bound of each individual tag in
-- a CHECK constraint. Reject malformed tags even for non-API database writes.
CREATE OR REPLACE FUNCTION public.validate_entry_draft_mood_tags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  mood_tag text;
BEGIN
  FOREACH mood_tag IN ARRAY NEW.mood_tags LOOP
    IF mood_tag IS NULL
       OR mood_tag = ''
       OR mood_tag IS DISTINCT FROM btrim(mood_tag)
       OR char_length(mood_tag) > 40 THEN
      RAISE EXCEPTION 'Invalid entry draft mood tag'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_entry_draft_mood_tags
  BEFORE INSERT OR UPDATE OF mood_tags
  ON public.entry_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_entry_draft_mood_tags();

REVOKE ALL ON FUNCTION public.validate_entry_draft_mood_tags()
  FROM PUBLIC, anon, authenticated;

-- Keep the hardened canonical action list intact and add draft autosaves at
-- a maximum of 60 committed save attempts per minute per user.
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
      ('entry-drafts', 60, 60),
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

-- A per-client monotonic sequence makes lifecycle saves safe to send outside
-- the normal request queue. A newer sequence from the current client wins even
-- with a stale revision; equal/older sequences are idempotent no-ops. A
-- different client must still satisfy normal revision CAS.
CREATE OR REPLACE FUNCTION public.save_entry_draft(
  p_entry_date date,
  p_client_id uuid,
  p_client_sequence bigint,
  p_expected_revision integer,
  p_step text,
  p_mood_score numeric,
  p_mood_tags text[],
  p_prompt_question text,
  p_prompt_category text,
  p_prompt_answer text,
  p_highlight text,
  p_challenge text,
  p_gratitude text,
  p_free_write text,
  p_swap_count integer,
  p_duration_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id uuid := auth.uid();
  mood_tag text;
  rate_allowed boolean;
  rate_retry_after integer;
  saved_draft public.entry_drafts%ROWTYPE;
  current_draft public.entry_drafts%ROWTYPE;
BEGIN
  IF caller_id IS NULL OR NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_entry_date IS NULL
     OR p_entry_date < DATE '0001-01-01'
     OR p_client_id IS NULL
     OR p_client_sequence IS NULL
     OR p_client_sequence NOT BETWEEN 1 AND 9007199254740991
     OR p_step IS NULL
     OR p_step NOT IN ('mood', 'questions', 'freewrite')
     OR (p_mood_score IS NOT NULL AND p_mood_score NOT BETWEEN 1 AND 10)
     OR p_mood_tags IS NULL
     OR cardinality(p_mood_tags) > 10
     OR char_length(coalesce(p_prompt_question, '')) > 500
     OR char_length(coalesce(p_prompt_category, '')) > 100
     OR char_length(coalesce(p_prompt_answer, '')) > 5000
     OR char_length(coalesce(p_highlight, '')) > 2000
     OR char_length(coalesce(p_challenge, '')) > 2000
     OR char_length(coalesce(p_gratitude, '')) > 2000
     OR char_length(coalesce(p_free_write, '')) > 20000
     OR p_swap_count IS NULL
     OR p_swap_count NOT BETWEEN 0 AND 3
     OR p_duration_seconds IS NULL
     OR p_duration_seconds NOT BETWEEN 0 AND 86400
     OR (
       p_expected_revision IS NOT NULL
       AND p_expected_revision NOT BETWEEN 1 AND 2147483646
     ) THEN
    RAISE EXCEPTION 'Invalid entry draft input' USING ERRCODE = '22023';
  END IF;

  FOREACH mood_tag IN ARRAY p_mood_tags LOOP
    IF mood_tag IS NULL
       OR mood_tag = ''
       OR mood_tag IS DISTINCT FROM btrim(mood_tag)
       OR char_length(mood_tag) > 40 THEN
      RAISE EXCEPTION 'Invalid entry draft input' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT rate_result.allowed, rate_result.retry_after_seconds
  INTO rate_allowed, rate_retry_after
  FROM public.check_api_rate_limit('entry-drafts', 60, 60) AS rate_result;

  IF rate_allowed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', greatest(1, coalesce(rate_retry_after, 60))
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_entry_date::text, 12)
  );

  IF EXISTS (
    SELECT 1
    FROM public.entries AS entry
    WHERE entry.user_id = caller_id
      AND entry.entry_date = p_entry_date
  ) THEN
    RETURN jsonb_build_object('status', 'finalized');
  END IF;

  SELECT draft.*
  INTO current_draft
  FROM public.entry_drafts AS draft
  WHERE draft.user_id = caller_id
    AND draft.entry_date = p_entry_date
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_revision IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'stale',
        'current_draft', NULL
      );
    END IF;

    INSERT INTO public.entry_drafts (
      user_id,
      entry_date,
      revision,
      last_client_id,
      last_client_sequence,
      step,
      mood_score,
      mood_tags,
      prompt_question,
      prompt_category,
      prompt_answer,
      highlight,
      challenge,
      gratitude,
      free_write,
      swap_count,
      duration_seconds
    ) VALUES (
      caller_id,
      p_entry_date,
      1,
      p_client_id,
      p_client_sequence,
      p_step,
      p_mood_score,
      p_mood_tags,
      p_prompt_question,
      p_prompt_category,
      p_prompt_answer,
      p_highlight,
      p_challenge,
      p_gratitude,
      p_free_write,
      p_swap_count,
      p_duration_seconds
    )
    RETURNING * INTO saved_draft;

    RETURN jsonb_build_object(
      'status', 'ok',
      'draft', to_jsonb(saved_draft)
    );
  END IF;

  IF current_draft.last_client_id = p_client_id THEN
    IF p_client_sequence <= current_draft.last_client_sequence THEN
      RETURN jsonb_build_object(
        'status', 'superseded',
        'draft', to_jsonb(current_draft)
      );
    END IF;
  ELSIF p_expected_revision IS NULL
        OR current_draft.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'status', 'stale',
      'current_draft', NULL
    );
  END IF;

  UPDATE public.entry_drafts AS draft
  SET
    revision = draft.revision + 1,
    last_client_id = p_client_id,
    last_client_sequence = p_client_sequence,
    step = p_step,
    mood_score = p_mood_score,
    mood_tags = p_mood_tags,
    prompt_question = p_prompt_question,
    prompt_category = p_prompt_category,
    prompt_answer = p_prompt_answer,
    highlight = p_highlight,
    challenge = p_challenge,
    gratitude = p_gratitude,
    free_write = p_free_write,
    swap_count = p_swap_count,
    duration_seconds = p_duration_seconds,
    updated_at = now()
  WHERE draft.user_id = caller_id
    AND draft.entry_date = p_entry_date
  RETURNING * INTO saved_draft;

  RETURN jsonb_build_object(
    'status', 'ok',
    'draft', to_jsonb(saved_draft)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_entry_draft(
  date,
  uuid,
  bigint,
  integer,
  text,
  numeric,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_entry_draft(
  date,
  uuid,
  bigint,
  integer,
  text,
  numeric,
  text[],
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer
) TO authenticated;

-- Direct entry inserts and date moves may not erase an in-progress draft.
-- The finalization RPC removes the matching revision before its INSERT, so the
-- guard permits that insert while rejecting every bypass attempt. PDT01 is a
-- private SQLSTATE mapped to HTTP 409 by the application routes.
CREATE OR REPLACE FUNCTION public.guard_entry_draft_on_entry_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.user_id::text || ':' || NEW.entry_date::text, 12)
  );

  IF EXISTS (
    SELECT 1
    FROM public.entry_drafts AS draft
    WHERE draft.user_id = NEW.user_id
      AND draft.entry_date = NEW.entry_date
  ) THEN
    RAISE EXCEPTION 'An entry draft exists for this date'
      USING ERRCODE = 'PDT01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_entry_draft_on_entry_write
  BEFORE INSERT OR UPDATE OF user_id, entry_date
  ON public.entries
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_entry_draft_on_entry_write();

REVOKE ALL ON FUNCTION public.guard_entry_draft_on_entry_write()
  FROM PUBLIC, anon, authenticated;

-- Atomically verify a draft revision, remove that exact draft, and insert the
-- finalized entry under the same advisory lock. A same-hash retry returns the
-- existing entry so the route can resume or reuse its AI acknowledgment;
-- different finalized content is a conflict and is never overwritten.
CREATE OR REPLACE FUNCTION public.finalize_entry_draft(
  p_entry_date date,
  p_expected_draft_revision integer,
  p_prompt_question text,
  p_prompt_answer text,
  p_highlight text,
  p_challenge text,
  p_gratitude text,
  p_free_write text,
  p_mood_score numeric,
  p_mood_label text,
  p_mood_tags text[],
  p_word_count integer,
  p_entry_duration_seconds integer,
  p_voice_used boolean,
  p_ai_content_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id uuid := auth.uid();
  mood_tag text;
  current_draft public.entry_drafts%ROWTYPE;
  saved_entry public.entries%ROWTYPE;
BEGIN
  IF caller_id IS NULL OR NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_entry_date IS NULL
     OR p_entry_date < DATE '0001-01-01'
     OR p_expected_draft_revision IS NULL
     OR p_expected_draft_revision NOT BETWEEN 1 AND 2147483647
     OR char_length(coalesce(p_prompt_question, '')) > 500
     OR char_length(coalesce(p_prompt_answer, '')) > 5000
     OR char_length(coalesce(p_highlight, '')) > 2000
     OR char_length(coalesce(p_challenge, '')) > 2000
     OR char_length(coalesce(p_gratitude, '')) > 2000
     OR char_length(coalesce(p_free_write, '')) > 20000
     OR (p_mood_score IS NOT NULL AND p_mood_score NOT BETWEEN 1 AND 10)
     OR char_length(coalesce(p_mood_label, '')) > 100
     OR p_mood_tags IS NULL
     OR cardinality(p_mood_tags) > 10
     OR (p_word_count IS NOT NULL AND p_word_count NOT BETWEEN 0 AND 100000)
     OR (
       p_entry_duration_seconds IS NOT NULL
       AND p_entry_duration_seconds NOT BETWEEN 0 AND 86400
     )
     OR p_voice_used IS NULL
     OR p_ai_content_hash IS NULL
     OR p_ai_content_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid finalized entry input' USING ERRCODE = '22023';
  END IF;

  FOREACH mood_tag IN ARRAY p_mood_tags LOOP
    IF mood_tag IS NULL
       OR mood_tag = ''
       OR mood_tag IS DISTINCT FROM btrim(mood_tag)
       OR char_length(mood_tag) > 40 THEN
      RAISE EXCEPTION 'Invalid finalized entry input' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':' || p_entry_date::text, 12)
  );

  SELECT entry.*
  INTO saved_entry
  FROM public.entries AS entry
  WHERE entry.user_id = caller_id
    AND entry.entry_date = p_entry_date
  FOR UPDATE;

  IF FOUND THEN
    IF saved_entry.ai_content_hash = p_ai_content_hash THEN
      RETURN jsonb_build_object(
        'status', 'existing',
        'entry', to_jsonb(saved_entry)
      );
    END IF;

    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  SELECT draft.*
  INTO current_draft
  FROM public.entry_drafts AS draft
  WHERE draft.user_id = caller_id
    AND draft.entry_date = p_entry_date
  FOR UPDATE;

  IF NOT FOUND OR current_draft.revision <> p_expected_draft_revision THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;

  DELETE FROM public.entry_drafts AS draft
  WHERE draft.user_id = caller_id
    AND draft.entry_date = p_entry_date
    AND draft.revision = p_expected_draft_revision;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;

  INSERT INTO public.entries (
    user_id,
    entry_date,
    prompt_question,
    prompt_answer,
    highlight,
    challenge,
    gratitude,
    free_write,
    mood_score,
    mood_label,
    mood_tags,
    ai_content_hash,
    word_count,
    entry_duration_seconds,
    voice_used,
    updated_at
  ) VALUES (
    caller_id,
    p_entry_date,
    p_prompt_question,
    p_prompt_answer,
    p_highlight,
    p_challenge,
    p_gratitude,
    p_free_write,
    p_mood_score,
    p_mood_label,
    p_mood_tags,
    p_ai_content_hash,
    p_word_count,
    p_entry_duration_seconds,
    p_voice_used,
    now()
  )
  RETURNING * INTO saved_entry;

  RETURN jsonb_build_object(
    'status', 'created',
    'entry', to_jsonb(saved_entry)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_entry_draft(
  date,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text[],
  integer,
  integer,
  boolean,
  text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_entry_draft(
  date,
  integer,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text[],
  integer,
  integer,
  boolean,
  text
) TO authenticated;
