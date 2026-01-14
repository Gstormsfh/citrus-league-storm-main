-- Allow users to create waiver priority for their own team
-- This is needed for existing teams that predate the auto-create trigger

CREATE POLICY "Users can create waiver priority for their own team"
  ON public.waiver_priority
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams
      WHERE teams.id = waiver_priority.team_id
      AND teams.owner_id = auth.uid()
      AND teams.league_id = waiver_priority.league_id
    )
  );
