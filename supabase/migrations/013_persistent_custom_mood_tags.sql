-- Keep each user's custom mood vocabulary available across journal entries.
-- Authenticated clients may read through RLS; all mutations use the bounded
-- SECURITY DEFINER functions below.

CREATE TABLE public.saved_mood_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_mood_tags_label_format
    CHECK (
      char_length(label) BETWEEN 1 AND 40
      AND label = btrim(regexp_replace(label, '[[:space:]]+', ' ', 'g'))
      AND label !~ '[[:cntrl:]]'
    )
);

CREATE UNIQUE INDEX saved_mood_tags_user_label_lower_idx
  ON public.saved_mood_tags (user_id, lower(label));

CREATE INDEX saved_mood_tags_user_created_idx
  ON public.saved_mood_tags (user_id, created_at, id);

ALTER TABLE public.saved_mood_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own saved mood tags"
  ON public.saved_mood_tags FOR SELECT
  USING (
    auth.uid() = user_id
    AND public.is_allowed_user()
  );

REVOKE ALL ON TABLE public.saved_mood_tags
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.saved_mood_tags TO authenticated;

-- Preserve custom labels already used in finalized entries or active drafts.
-- Keep the first spelling used for case-insensitive duplicates and bound the
-- migration to the same 100-label per-user limit enforced for future writes.
WITH source_tags AS (
  SELECT
    entry.user_id,
    source.label AS raw_label,
    coalesce(
      entry.created_at,
      entry.entry_date::timestamp AT TIME ZONE 'UTC'
    ) AS seen_at
  FROM public.entries AS entry
  CROSS JOIN LATERAL unnest(coalesce(entry.mood_tags, '{}'::text[]))
    AS source(label)

  UNION ALL

  SELECT
    draft.user_id,
    source.label AS raw_label,
    draft.created_at AS seen_at
  FROM public.entry_drafts AS draft
  CROSS JOIN LATERAL unnest(coalesce(draft.mood_tags, '{}'::text[]))
    AS source(label)
),
normalized_tags AS (
  SELECT
    source.user_id,
    btrim(
      regexp_replace(source.raw_label, '[[:space:]]+', ' ', 'g')
    ) AS label,
    source.seen_at
  FROM source_tags AS source
  WHERE source.raw_label IS NOT NULL
),
valid_tags AS (
  SELECT normalized.user_id, normalized.label, normalized.seen_at
  FROM normalized_tags AS normalized
  WHERE char_length(normalized.label) BETWEEN 1 AND 40
    AND normalized.label !~ '[[:cntrl:]]'
    AND lower(normalized.label) <> ALL (
      ARRAY[
        'work',
        'family',
        'creative',
        'tired',
        'excited',
        'anxious',
        'grateful',
        'social',
        'body',
        'parenting',
        'calm',
        'overwhelmed',
        'lonely',
        'confident',
        'restless',
        'loved',
        'frustrated',
        'motivated',
        'sad',
        'playful',
        'focused',
        'scattered',
        'hopeful',
        'nostalgic',
        'proud',
        'guilty',
        'inspired',
        'numb',
        'romantic',
        'adventurous',
        'depressed',
        'content',
        'stressed',
        'curious',
        'irritable'
      ]::text[]
    )
),
case_ranked AS (
  SELECT
    valid.user_id,
    valid.label,
    valid.seen_at,
    row_number() OVER (
      PARTITION BY valid.user_id, lower(valid.label)
      ORDER BY valid.seen_at, valid.label
    ) AS case_rank
  FROM valid_tags AS valid
),
deduplicated AS (
  SELECT ranked.user_id, ranked.label, ranked.seen_at
  FROM case_ranked AS ranked
  WHERE ranked.case_rank = 1
),
limit_ranked AS (
  SELECT
    deduplicated.user_id,
    deduplicated.label,
    deduplicated.seen_at,
    row_number() OVER (
      PARTITION BY deduplicated.user_id
      ORDER BY deduplicated.seen_at, lower(deduplicated.label), deduplicated.label
    ) AS saved_rank
  FROM deduplicated
)
INSERT INTO public.saved_mood_tags (user_id, label, created_at)
SELECT ranked.user_id, ranked.label, ranked.seen_at
FROM limit_ranked AS ranked
WHERE ranked.saved_rank <= 100
ON CONFLICT DO NOTHING;

-- Extend the canonical rate-limit action list. The action and bounds supplied
-- by a client must match this list, preventing weaker caller-selected limits.
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
      ('push-test', 3, 300),
      ('custom-mood-tags', 30, 60)
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

CREATE OR REPLACE FUNCTION public.create_saved_mood_tag(p_label text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id uuid := auth.uid();
  normalized_label text;
  existing_tag public.saved_mood_tags%ROWTYPE;
  saved_tag public.saved_mood_tags%ROWTYPE;
  rate_allowed boolean;
  rate_retry_after integer;
BEGIN
  IF caller_id IS NULL OR NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_label IS NULL OR octet_length(p_label) > 1024 THEN
    RAISE EXCEPTION 'Invalid mood tag label' USING ERRCODE = '22023';
  END IF;

  normalized_label := btrim(
    regexp_replace(p_label, '[[:space:]]+', ' ', 'g')
  );

  IF char_length(normalized_label) NOT BETWEEN 1 AND 40
     OR normalized_label ~ '[[:cntrl:]]'
     OR lower(normalized_label) = ANY (
       ARRAY[
         'work',
         'family',
         'creative',
         'tired',
         'excited',
         'anxious',
         'grateful',
         'social',
         'body',
         'parenting',
         'calm',
         'overwhelmed',
         'lonely',
         'confident',
         'restless',
         'loved',
         'frustrated',
         'motivated',
         'sad',
         'playful',
         'focused',
         'scattered',
         'hopeful',
         'nostalgic',
         'proud',
         'guilty',
         'inspired',
         'numb',
         'romantic',
         'adventurous',
         'depressed',
         'content',
         'stressed',
         'curious',
         'irritable'
       ]::text[]
     ) THEN
    RAISE EXCEPTION 'Invalid mood tag label' USING ERRCODE = '22023';
  END IF;

  SELECT rate_result.allowed, rate_result.retry_after_seconds
  INTO rate_allowed, rate_retry_after
  FROM public.check_api_rate_limit(
    'custom-mood-tags',
    30,
    60
  ) AS rate_result;

  IF rate_allowed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', greatest(1, coalesce(rate_retry_after, 60))
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':saved-mood-tags', 13)
  );

  SELECT tag.*
  INTO existing_tag
  FROM public.saved_mood_tags AS tag
  WHERE tag.user_id = caller_id
    AND lower(tag.label) = lower(normalized_label)
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'tag', to_jsonb(existing_tag)
    );
  END IF;

  IF (
    SELECT count(*)
    FROM public.saved_mood_tags AS tag
    WHERE tag.user_id = caller_id
  ) >= 100 THEN
    RETURN jsonb_build_object('status', 'limit_reached');
  END IF;

  INSERT INTO public.saved_mood_tags (user_id, label)
  VALUES (caller_id, normalized_label)
  ON CONFLICT DO NOTHING
  RETURNING * INTO saved_tag;

  IF NOT FOUND THEN
    SELECT tag.*
    INTO saved_tag
    FROM public.saved_mood_tags AS tag
    WHERE tag.user_id = caller_id
      AND lower(tag.label) = lower(normalized_label);
  END IF;

  IF saved_tag.id IS NULL THEN
    RAISE EXCEPTION 'Failed to save mood tag';
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'tag', to_jsonb(saved_tag)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_saved_mood_tag(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_saved_mood_tag(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_saved_mood_tag(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id uuid := auth.uid();
  rate_allowed boolean;
  rate_retry_after integer;
BEGIN
  IF caller_id IS NULL OR NOT public.is_allowed_user() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Invalid mood tag id' USING ERRCODE = '22023';
  END IF;

  SELECT rate_result.allowed, rate_result.retry_after_seconds
  INTO rate_allowed, rate_retry_after
  FROM public.check_api_rate_limit(
    'custom-mood-tags',
    30,
    60
  ) AS rate_result;

  IF rate_allowed IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', greatest(1, coalesce(rate_retry_after, 60))
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(caller_id::text || ':saved-mood-tags', 13)
  );

  DELETE FROM public.saved_mood_tags AS tag
  WHERE tag.id = p_id
    AND tag.user_id = caller_id;

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_saved_mood_tag(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_saved_mood_tag(uuid)
  TO authenticated;
