-- Existing AI consent named Anthropic as the external processor. Reset it so
-- every account must explicitly accept the updated OpenAI disclosure before
-- any journal text can be sent to the new provider or scheduled summaries.
update public.profiles
set ai_enabled = false
where ai_enabled = true;
