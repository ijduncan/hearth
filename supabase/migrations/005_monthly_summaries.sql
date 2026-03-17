CREATE TABLE monthly_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  month_start date NOT NULL,
  month_end date NOT NULL,
  summary_text text NOT NULL,
  avg_mood numeric(3,1),
  dominant_tags text[],
  total_entries integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, month_start)
);

ALTER TABLE monthly_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own monthly summaries"
  ON monthly_summaries FOR ALL
  USING (auth.uid() = user_id);
