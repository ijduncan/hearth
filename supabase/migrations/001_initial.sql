-- Profiles (extends Supabase auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text not null,
  avatar_emoji text default '🌿',
  streak_count integer default 0,
  last_entry_date date,
  reminder_time time default '20:00',
  created_at timestamptz default now()
);

-- Journal entries
create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  entry_date date not null default current_date,

  -- The three questions
  prompt_question text,
  prompt_answer text,
  highlight text,
  challenge text,

  -- Free write
  free_write text,

  -- Mood (1-10 scale, stored as decimal for precision)
  mood_score numeric(3,1) check (mood_score between 1 and 10),
  mood_label text,
  mood_tags text[],

  -- AI response
  ai_acknowledgment text,
  ai_generated_at timestamptz,

  -- Meta
  word_count integer,
  entry_duration_seconds integer,
  voice_used boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(user_id, entry_date)
);

-- Weekly AI summaries
create table weekly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  week_start date not null,
  week_end date not null,
  summary_text text not null,
  avg_mood numeric(3,1),
  dominant_tags text[],
  created_at timestamptz default now(),
  unique(user_id, week_start)
);

-- Row-level security
alter table profiles enable row level security;
alter table entries enable row level security;
alter table weekly_summaries enable row level security;

create policy "Users read own profile" on profiles for select using (auth.uid() = id);
create policy "Users update own profile" on profiles for update using (auth.uid() = id);
create policy "Users manage own entries" on entries for all using (auth.uid() = user_id);
create policy "Users manage own summaries" on weekly_summaries for all using (auth.uid() = user_id);

-- Trigger to upsert profile on signup
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
