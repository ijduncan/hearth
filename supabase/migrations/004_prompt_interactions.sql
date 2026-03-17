CREATE TABLE prompt_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  prompt_text text NOT NULL,
  prompt_category text NOT NULL,
  interaction_type text NOT NULL CHECK (interaction_type IN ('answered', 'skipped', 'shown')),
  entry_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_prompt_interactions_user_date ON prompt_interactions(user_id, entry_date);

ALTER TABLE prompt_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own prompt interactions"
  ON prompt_interactions FOR ALL
  USING (auth.uid() = user_id);
