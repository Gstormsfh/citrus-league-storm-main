CREATE OR REPLACE FUNCTION public.score_confidence_week(p_league_id uuid, p_week_number integer)
 RETURNS TABLE(pick_id uuid, user_id uuid, game_id text, picked_team text, confidence_points integer, is_correct boolean, points_earned integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pick RECORD; v_game RECORD; v_correct BOOLEAN; v_winner TEXT; v_earned INT;
BEGIN
  FOR v_pick IN
    SELECT cp.id, cp.user_id, cp.game_id, cp.picked_team, cp.confidence_points
    FROM confidence_picks cp
    WHERE cp.league_id = p_league_id AND cp.week_number = p_week_number
      AND cp.is_correct IS NULL
  LOOP
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.id::TEXT = v_pick.game_id AND ng.status = 'final'
      AND ng.home_score IS NOT NULL AND ng.away_score IS NOT NULL;

    IF FOUND THEN
      IF v_game.home_score > v_game.away_score THEN v_winner := v_game.home_team;
      ELSIF v_game.away_score > v_game.home_score THEN v_winner := v_game.away_team;
      ELSE v_winner := 'TIE'; END IF;

      v_correct := (v_pick.picked_team = v_winner) AND v_winner <> 'TIE';
      v_earned := CASE WHEN v_correct THEN v_pick.confidence_points ELSE 0 END;

      UPDATE confidence_picks
         SET is_correct = v_correct, points_earned = v_earned
       WHERE id = v_pick.id;

      pick_id := v_pick.id; user_id := v_pick.user_id; game_id := v_pick.game_id;
      picked_team := v_pick.picked_team; confidence_points := v_pick.confidence_points;
      is_correct := v_correct; points_earned := v_earned;
      RETURN NEXT;
    END IF;
  END LOOP;
  RETURN;
END $function$
