-- Connections expose approved glimpses only. Existing journal RLS is unchanged.
CREATE TABLE public.partner_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled','disconnected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  CHECK (inviter_id <> recipient_id)
);
CREATE UNIQUE INDEX partner_pending_pair ON public.partner_connections
  (least(inviter_id,recipient_id), greatest(inviter_id,recipient_id))
  WHERE status IN ('pending','accepted');
CREATE INDEX partner_inviter ON public.partner_connections(inviter_id);
CREATE INDEX partner_recipient ON public.partner_connections(recipient_id);

CREATE TABLE public.partner_glimpses (
  connection_id uuid NOT NULL REFERENCES public.partner_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  glimpse_text text NOT NULL CHECK (length(glimpse_text) BETWEEN 1 AND 240),
  shared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id,user_id)
);
ALTER TABLE public.partner_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_glimpses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_connections, public.partner_glimpses FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_connections, public.partner_glimpses TO service_role;

-- Internal eligibility helper; no account directory is exposed to clients.
CREATE FUNCTION public.partner_user_is_eligible(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.allowed_emails a ON a.email = lower(u.email)
    WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now()));
$$;
REVOKE ALL ON FUNCTION public.partner_user_is_eligible(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_partner_state() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE caller uuid := auth.uid(); active public.partner_connections; peer uuid; connection_json jsonb := NULL; incoming_json jsonb; outgoing_json jsonb;
BEGIN
  IF caller IS NULL OR NOT public.is_allowed_user() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO active FROM public.partner_connections c
    WHERE caller IN (c.inviter_id,c.recipient_id) AND c.status = 'accepted'
    LIMIT 1;
  IF active.id IS NOT NULL THEN
    peer := CASE WHEN active.inviter_id = caller THEN active.recipient_id ELSE active.inviter_id END;
    connection_json := jsonb_build_object('id',active.id,
      'available',public.partner_user_is_eligible(peer),
      'partner_name',CASE WHEN public.partner_user_is_eligible(peer) THEN (SELECT display_name FROM public.profiles WHERE id = peer) ELSE 'Unavailable account' END,
      'partner_glimpse',(SELECT jsonb_build_object('text',glimpse_text,'entry_date',entry_date,'shared_at',shared_at)
        FROM public.partner_glimpses WHERE connection_id = active.id AND user_id = peer AND public.partner_user_is_eligible(peer)),
      'own_glimpse',(SELECT jsonb_build_object('text',glimpse_text,'entry_date',entry_date,'shared_at',shared_at)
        FROM public.partner_glimpses WHERE connection_id = active.id AND user_id = caller));
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',p.display_name,'expires_at',c.expires_at) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO incoming_json FROM public.partner_connections c JOIN public.profiles p ON p.id = c.inviter_id
    WHERE c.recipient_id = caller AND c.status = 'pending' AND c.expires_at > now()
      AND public.partner_user_is_eligible(c.inviter_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',p.display_name,'expires_at',c.expires_at) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO outgoing_json FROM public.partner_connections c JOIN public.profiles p ON p.id = c.recipient_id
    WHERE c.inviter_id = caller AND c.status = 'pending' AND c.expires_at > now()
      AND public.partner_user_is_eligible(c.recipient_id);
  RETURN jsonb_build_object('connection',connection_json,'incoming',incoming_json,'outgoing',outgoing_json);
END;
$$;

CREATE FUNCTION public.invite_partner(p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE caller uuid := auth.uid(); recipient uuid; connection_id uuid; quota record;
BEGIN
  IF caller IS NULL OR NOT public.is_allowed_user() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO quota FROM public.check_api_rate_limit('partner-invite',5,86400);
  IF NOT quota.allowed THEN RAISE EXCEPTION 'Invitation limit reached. Try again tomorrow.' USING ERRCODE = 'P0001'; END IF;
  IF p_email IS NULL OR length(p_email) > 320 OR btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023'; END IF;
  -- Serialize invitations from this caller; an invitation never grants access.
  PERFORM 1 FROM public.profiles WHERE id = caller FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.partner_connections c WHERE caller IN (c.inviter_id,c.recipient_id) AND status = 'accepted') THEN
    RAISE EXCEPTION 'Disconnect your current partner before inviting another' USING ERRCODE = '22023'; END IF;
  SELECT id INTO recipient FROM auth.users WHERE lower(email) = lower(btrim(p_email)) AND public.partner_user_is_eligible(id);
  IF recipient IS NULL THEN RETURN NULL; END IF;
  IF recipient = caller THEN RAISE EXCEPTION 'Choose someone other than yourself' USING ERRCODE = '22023'; END IF;
  UPDATE public.partner_connections SET status = 'cancelled' WHERE status = 'pending' AND expires_at <= now()
    AND least(inviter_id,recipient_id) = least(caller,recipient) AND greatest(inviter_id,recipient_id) = greatest(caller,recipient);
  INSERT INTO public.partner_connections(inviter_id,recipient_id) VALUES (caller,recipient)
    ON CONFLICT (least(inviter_id,recipient_id),greatest(inviter_id,recipient_id)) WHERE status IN ('pending','accepted') DO NOTHING
    RETURNING id INTO connection_id;
  IF connection_id IS NULL THEN
    SELECT id INTO connection_id FROM public.partner_connections WHERE inviter_id = caller AND recipient_id = recipient AND status = 'pending';
  END IF;
  IF connection_id IS NULL THEN RAISE EXCEPTION 'Check your incoming invitations' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('id',connection_id,'email',lower(btrim(p_email)));
END;
$$;

CREATE FUNCTION public.respond_partner_invitation(p_id uuid,p_accept boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE caller uuid := auth.uid(); invitation public.partner_connections;
BEGIN
  IF caller IS NULL OR NOT public.is_allowed_user() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO invitation FROM public.partner_connections WHERE id = p_id FOR UPDATE;
  IF invitation.id IS NULL OR invitation.recipient_id <> caller OR invitation.status <> 'pending' OR invitation.expires_at <= now()
    OR NOT public.partner_user_is_eligible(invitation.inviter_id) THEN
    RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = '42501'; END IF;
  IF p_accept IS NULL THEN RAISE EXCEPTION 'Invalid response' USING ERRCODE = '22023'; END IF;
  IF p_accept THEN
    -- Lock both profiles in stable order, so competing accepts cannot create two partners.
    PERFORM 1 FROM public.profiles WHERE id IN (caller,invitation.inviter_id) ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.partner_connections c WHERE c.status = 'accepted'
      AND (caller IN (c.inviter_id,c.recipient_id) OR invitation.inviter_id IN (c.inviter_id,c.recipient_id))) THEN
      RAISE EXCEPTION 'One of you already has a partner. Disconnect first.' USING ERRCODE = '22023'; END IF;
  END IF;
  UPDATE public.partner_connections SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END WHERE id = p_id;
END;
$$;

CREATE FUNCTION public.remove_partner_connection(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE caller uuid := auth.uid(); connection public.partner_connections;
BEGIN
  IF caller IS NULL OR NOT public.is_allowed_user() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO connection FROM public.partner_connections WHERE id = p_id FOR UPDATE;
  IF connection.id IS NULL OR caller NOT IN (connection.inviter_id,connection.recipient_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.partner_connections SET status = CASE WHEN status = 'accepted' THEN 'disconnected' ELSE 'cancelled' END WHERE id = p_id;
  DELETE FROM public.partner_glimpses WHERE connection_id = p_id;
END;
$$;

CREATE FUNCTION public.share_partner_glimpse(p_connection_id uuid,p_entry_id uuid,p_text text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE caller uuid := auth.uid(); connection public.partner_connections; source public.entries; clean text := btrim(p_text);
BEGIN
  IF caller IS NULL OR NOT public.is_allowed_user() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO connection FROM public.partner_connections WHERE id = p_connection_id FOR UPDATE;
  IF connection.id IS NULL OR connection.status <> 'accepted' OR caller NOT IN (connection.inviter_id,connection.recipient_id)
    OR NOT public.partner_user_is_eligible(CASE WHEN caller = connection.inviter_id THEN connection.recipient_id ELSE connection.inviter_id END) THEN
    RAISE EXCEPTION 'Connection unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO source FROM public.entries WHERE id = p_entry_id AND user_id = caller FOR UPDATE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE = '42501'; END IF;
  IF clean IS NULL OR length(clean) NOT BETWEEN 1 AND 240 OR clean ~ '[\r\n]'
    OR cardinality(regexp_split_to_array(clean,'\s+')) > 15
    OR clean ~ '[.!?。！？][[:space:]]*[^[:space:]]' THEN
    RAISE EXCEPTION 'Use one sentence of at most 15 words' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.partner_glimpses(connection_id,user_id,entry_id,entry_date,glimpse_text)
    VALUES (p_connection_id,caller,source.id,source.entry_date,clean)
    ON CONFLICT(connection_id,user_id) DO UPDATE SET entry_id = excluded.entry_id, entry_date = excluded.entry_date,
      glimpse_text = excluded.glimpse_text, shared_at = now();
END;
$$;

CREATE FUNCTION public.withdraw_partner_glimpse(p_connection_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_allowed_user() THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.partner_glimpses WHERE connection_id = p_connection_id AND user_id = auth.uid();
END;
$$;

-- Edited/deleted journals must not leave misleading previously shared glimpses.
CREATE FUNCTION public.invalidate_partner_glimpse() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.partner_glimpses WHERE entry_id = OLD.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.invalidate_partner_glimpse() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER invalidate_partner_glimpse AFTER UPDATE OF entry_date,mood_score,mood_label,mood_tags,prompt_question,prompt_answer,highlight,challenge,gratitude,free_write
  ON public.entries FOR EACH ROW WHEN (
    (OLD.entry_date,OLD.mood_score,OLD.mood_label,OLD.mood_tags,OLD.prompt_question,OLD.prompt_answer,OLD.highlight,OLD.challenge,OLD.gratitude,OLD.free_write)
    IS DISTINCT FROM
    (NEW.entry_date,NEW.mood_score,NEW.mood_label,NEW.mood_tags,NEW.prompt_question,NEW.prompt_answer,NEW.highlight,NEW.challenge,NEW.gratitude,NEW.free_write))
  EXECUTE FUNCTION public.invalidate_partner_glimpse();

REVOKE ALL ON FUNCTION public.get_partner_state(),public.invite_partner(text),public.respond_partner_invitation(uuid,boolean),
  public.remove_partner_connection(uuid),public.share_partner_glimpse(uuid,uuid,text),public.withdraw_partner_glimpse(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_state(),public.invite_partner(text),public.respond_partner_invitation(uuid,boolean),
  public.remove_partner_connection(uuid),public.share_partner_glimpse(uuid,uuid,text),public.withdraw_partner_glimpse(uuid) TO authenticated;

-- Extend the existing bounded application rate-limit actions.
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
      ('custom-mood-tags', 30, 60),
      ('partner-invite', 5, 86400),
      ('partner-glimpse-ai', 5, 86400)
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
