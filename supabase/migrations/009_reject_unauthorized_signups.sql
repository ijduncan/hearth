-- Reject unauthorized signups at the auth.users transaction boundary.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(coalesce(new.email, ''))
  ) THEN
    RAISE EXCEPTION 'User is not authorized for this application'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (id, display_name)
  VALUES (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), 100)
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
