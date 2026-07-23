-- Durable per-user API rate limiting for serverless deployments.
CREATE TABLE public.api_rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  PRIMARY KEY (user_id, action, window_start)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
-- No client table policies: callers can only use the constrained RPC below.

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
  IF caller_id IS NULL OR
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
REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;
