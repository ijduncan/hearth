ALTER TABLE public.entries ADD COLUMN gratitude text;
CREATE TABLE public.allowed_emails(email text PRIMARY KEY);
CREATE TABLE public.api_rate_limits(
  user_id uuid NOT NULL, action text NOT NULL, window_start timestamptz NOT NULL,
  request_count integer NOT NULL, PRIMARY KEY(user_id,action,window_start)
);
CREATE FUNCTION public.is_allowed_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.allowed_emails a ON a.email = lower(u.email)
    WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now()));
$$;
REVOKE ALL ON FUNCTION public.is_allowed_user() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_allowed_user() TO authenticated;
GRANT SELECT ON public.entries,public.profiles TO authenticated;
INSERT INTO auth.users(id,email) VALUES
 ('11111111-1111-4111-8111-111111111111','a@example.test'),
 ('22222222-2222-4222-8222-222222222222','b@example.test'),
 ('33333333-3333-4333-8333-333333333333','c@example.test');
INSERT INTO public.allowed_emails SELECT email FROM auth.users;
INSERT INTO public.entries(id,user_id,entry_date,free_write) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','2026-10-03','A private text'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','2026-10-03','B private text');
