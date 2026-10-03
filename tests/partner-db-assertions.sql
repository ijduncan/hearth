CREATE FUNCTION public.test_assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',p_message; END IF; END;
$$;
CREATE FUNCTION public.expect_partner_failure(p_query text,p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_query;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_code THEN RETURN; END IF;
    RAISE EXCEPTION 'Unexpected SQLSTATE: %, expected %',SQLSTATE,p_code;
  END;
  RAISE EXCEPTION 'Expected failure did not occur: %',p_query;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.test_assert(public.get_partner_state()->'connection' = 'null'::jsonb,'no automatic connections');
SELECT public.test_assert((SELECT allowed FROM public.check_api_rate_limit('entry-drafts',60,60)),'existing draft limits preserved');
SELECT public.test_assert((SELECT allowed FROM public.check_api_rate_limit('custom-mood-tags',30,60)),'existing mood tag limits preserved');
SELECT public.test_assert(public.invite_partner('unknown@example.test') IS NULL,'unknown account is not provisioned');
SELECT public.expect_partner_failure($q$SELECT public.invite_partner('a@example.test')$q$,'22023');
SELECT public.invite_partner('b@example.test')->>'id' AS connection_id \gset
SELECT public.test_assert(jsonb_array_length(public.get_partner_state()->'outgoing') = 1,'outgoing invitation exists');
SELECT public.expect_partner_failure(format('SELECT public.respond_partner_invitation(%L,true)', :'connection_id'),'42501');
SELECT public.expect_partner_failure(format('SELECT public.share_partner_glimpse(%L,%L,%L)', :'connection_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A quiet day.'),'42501');
SELECT public.expect_partner_failure('SELECT * FROM public.partner_glimpses','42501');
SELECT public.test_assert((SELECT count(*) FROM public.entries) = 1,'journal RLS remains private');

SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
SELECT public.test_assert(jsonb_array_length(public.get_partner_state()->'incoming') = 0,'third party cannot see invitations');
SELECT public.expect_partner_failure(format('SELECT public.respond_partner_invitation(%L,true)', :'connection_id'),'42501');
SELECT public.expect_partner_failure(format('SELECT public.remove_partner_connection(%L)', :'connection_id'),'42501');

SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.test_assert(jsonb_array_length(public.get_partner_state()->'incoming') = 1,'only recipient sees incoming');
SELECT public.respond_partner_invitation(:'connection_id',true);
SELECT public.test_assert(public.get_partner_state()->'connection'->'partner_glimpse' = 'null'::jsonb,'acceptance does not publish anything');
SELECT public.expect_partner_failure(format('SELECT public.share_partner_glimpse(%L,%L,%L)', :'connection_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','My day was calm.'),'42501');
SELECT public.expect_partner_failure(format('SELECT public.share_partner_glimpse(%L,%L,%L)', :'connection_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'),'22023');
SELECT public.expect_partner_failure(format('SELECT public.share_partner_glimpse(%L,%L,%L)', :'connection_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Two sentences. Not permitted'),'22023');
SELECT public.share_partner_glimpse(:'connection_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Today felt tiring, but a quiet moment helped me feel more settled.');
SELECT public.test_assert((SELECT count(*) FROM public.entries) = 1,'acceptance does not expose partner entries');

SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.test_assert(public.get_partner_state()->'connection'->'partner_glimpse'->>'text' = 'Today felt tiring, but a quiet moment helped me feel more settled.','approved glimpse visible');
SELECT public.test_assert(NOT (public.get_partner_state()->'connection' ? 'free_write'),'state excludes source text');
SELECT public.expect_partner_failure($q$SELECT public.invite_partner('c@example.test')$q$,'22023');

-- Third party cannot accept a second connection with an already connected user.
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
SELECT public.invite_partner('b@example.test')->>'id' AS second_id \gset
SELECT public.test_assert(public.get_partner_state()->'connection' = 'null'::jsonb,'third party sees no glimpse');
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.expect_partner_failure(format('SELECT public.respond_partner_invitation(%L,true)', :'second_id'),'22023');
SELECT public.respond_partner_invitation(:'second_id',false);
SELECT public.withdraw_partner_glimpse(:'connection_id');
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.test_assert(public.get_partner_state()->'connection'->'partner_glimpse' = 'null'::jsonb,'withdrawal immediate');

-- Editing source text invalidates a previously approved glimpse.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.share_partner_glimpse(:'connection_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','I felt calm today.');
RESET ROLE;
UPDATE public.entries SET free_write = 'Edited private text' WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.test_assert(public.get_partner_state()->'connection'->'partner_glimpse' = 'null'::jsonb,'source edit invalidates glimpse');

-- Offboarding removes access to shared data in both directions.
RESET ROLE;
DELETE FROM public.allowed_emails WHERE email = 'b@example.test';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.expect_partner_failure('SELECT public.get_partner_state()','42501');
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.test_assert(public.get_partner_state()->'connection'->'partner_glimpse' = 'null'::jsonb AND public.get_partner_state()->'connection'->>'partner_name' = 'Unavailable account' AND public.get_partner_state()->'connection'->>'available' = 'false','offboarded peer is hidden while disconnect remains available');
SELECT public.remove_partner_connection(:'connection_id');
SELECT public.test_assert(public.get_partner_state()->'connection' = 'null'::jsonb,'disconnect immediate');
SELECT public.expect_partner_failure(format('SELECT public.share_partner_glimpse(%L,%L,%L)', :'connection_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','My day was quiet.'),'42501');
RESET ROLE;
INSERT INTO public.allowed_emails VALUES ('b@example.test');
SET ROLE authenticated;
SELECT public.invite_partner('b@example.test')->>'id' AS reconnect_id \gset
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
SELECT public.respond_partner_invitation(:'reconnect_id',true);
SELECT public.test_assert(public.get_partner_state()->'connection'->'own_glimpse' = 'null'::jsonb,'reconnection does not restore old glimpses');
SELECT public.remove_partner_connection(:'reconnect_id');
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
SELECT public.invite_partner('a@example.test')->>'id' AS expired_id \gset
RESET ROLE;
UPDATE public.partner_connections SET expires_at = now() - interval '1 day' WHERE id = :'expired_id';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
SELECT public.expect_partner_failure(format('SELECT public.respond_partner_invitation(%L,true)', :'expired_id'),'42501');
RESET ROLE;
SELECT 'Partner database privacy and lifecycle tests passed' AS result;
