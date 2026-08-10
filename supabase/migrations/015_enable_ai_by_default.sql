-- AI feedback is a core Hearth feature. Enable it for all existing accounts
-- and make it the default for newly provisioned profiles. The column remains
-- available as an administrator-controlled emergency kill switch.
alter table public.profiles
  alter column ai_enabled set default true;

update public.profiles
set ai_enabled = true
where ai_enabled = false;
