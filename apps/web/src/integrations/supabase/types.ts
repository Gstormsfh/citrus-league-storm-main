export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      players: {
        Row: {
          id: string
          full_name: string
          position: string
          team: string
          jersey_number: string | null
          status: string | null
          goals: number | null
          assists: number | null
          points: number | null
          plus_minus: number | null
          shots: number | null
          hits: number | null
          blocks: number | null
          wins: number | null
          losses: number | null
          ot_losses: number | null
          saves: number | null
          goals_against_average: number | null
          save_percentage: number | null
          headshot_url: string | null
          last_updated: string | null
        }
        Insert: {
          id?: string
          full_name: string
          position: string
          team: string
          jersey_number?: string | null
          status?: string | null
          goals?: number | null
          assists?: number | null
          points?: number | null
          plus_minus?: number | null
          shots?: number | null
          hits?: number | null
          blocks?: number | null
          wins?: number | null
          losses?: number | null
          ot_losses?: number | null
          saves?: number | null
          goals_against_average?: number | null
          save_percentage?: number | null
          headshot_url?: string | null
          last_updated?: string | null
        }
        Update: {
          id?: string
          full_name?: string
          position?: string
          team?: string
          jersey_number?: string | null
          status?: string | null
          goals?: number | null
          assists?: number | null
          points?: number | null
          plus_minus?: number | null
          shots?: number | null
          hits?: number | null
          blocks?: number | null
          wins?: number | null
          losses?: number | null
          ot_losses?: number | null
          saves?: number | null
          goals_against_average?: number | null
          save_percentage?: number | null
          headshot_url?: string | null
          last_updated?: string | null
        }
        Relationships: []
      }
      team_lineups: {
        Row: {
          team_id: number
          starters: Json
          bench: Json
          ir: Json
          slot_assignments: Json
          updated_at: string | null
        }
        Insert: {
          team_id: number
          starters?: Json
          bench?: Json
          ir?: Json
          slot_assignments?: Json
          updated_at?: string | null
        }
        Update: {
          team_id?: number
          starters?: Json
          bench?: Json
          ir?: Json
          slot_assignments?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          username: string
          first_name: string | null
          last_name: string | null
          phone: string | null
          location: string | null
          bio: string | null
          default_team_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          location?: string | null
          bio?: string | null
          default_team_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          location?: string | null
          bio?: string | null
          default_team_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      leagues: {
        Row: {
          id: string
          name: string
          commissioner_id: string
          draft_status: 'not_started' | 'queued' | 'in_progress' | 'completed'
          join_code: string
          roster_size: number
          draft_rounds: number
          settings: Json
          scoring_settings: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          commissioner_id: string
          draft_status?: 'not_started' | 'in_progress' | 'completed'
          join_code?: string
          roster_size?: number
          draft_rounds?: number
          settings?: Json
          scoring_settings?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          commissioner_id?: string
          draft_status?: 'not_started' | 'in_progress' | 'completed'
          join_code?: string
          roster_size?: number
          draft_rounds?: number
          settings?: Json
          scoring_settings?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          id: string
          league_id: string
          owner_id: string | null
          team_name: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          owner_id?: string | null
          team_name: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          owner_id?: string | null
          team_name?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      draft_picks: {
        Row: {
          id: string
          league_id: string
          round_number: number
          pick_number: number
          team_id: string
          player_id: string
          picked_at: string
        }
        Insert: {
          id?: string
          league_id: string
          round_number: number
          pick_number: number
          team_id: string
          player_id: string
          picked_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          round_number?: number
          pick_number?: number
          team_id?: string
          player_id?: string
          picked_at?: string
        }
        Relationships: []
      }
      draft_order: {
        Row: {
          id: string
          league_id: string
          round_number: number
          team_order: Json
          created_at: string
        }
        Insert: {
          id?: string
          league_id: string
          round_number: number
          team_order: Json
          created_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          round_number?: number
          team_order?: Json
          created_at?: string
        }
        Relationships: []
      }
      matchups: {
        Row: {
          id: string
          league_id: string
          week_number: number
          team1_id: string
          team2_id: string | null
          team1_score: number
          team2_score: number
          status: 'scheduled' | 'in_progress' | 'completed'
          week_start_date: string
          week_end_date: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          week_number: number
          team1_id: string
          team2_id?: string | null
          team1_score?: number
          team2_score?: number
          status?: 'scheduled' | 'in_progress' | 'completed'
          week_start_date: string
          week_end_date: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          week_number?: number
          team1_id?: string
          team2_id?: string | null
          team1_score?: number
          team2_score?: number
          status?: 'scheduled' | 'in_progress' | 'completed'
          week_start_date?: string
          week_end_date?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      roster_assignments: {
        Row: {
          id: string
          league_id: string
          team_id: string
          player_id: string
          acquired_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          team_id: string
          player_id: string
          acquired_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          team_id?: string
          player_id?: string
          acquired_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          league_id: string
          user_id: string
          type: 'ADD' | 'DROP' | 'WAIVER' | 'TRADE' | 'CHAT' | 'SYSTEM'
          title: string
          message: string
          metadata: Json
          read_status: boolean
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          league_id: string
          user_id: string
          type: 'ADD' | 'DROP' | 'WAIVER' | 'TRADE' | 'CHAT' | 'SYSTEM'
          title: string
          message: string
          metadata?: Json
          read_status?: boolean
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          league_id?: string
          user_id?: string
          type?: 'ADD' | 'DROP' | 'WAIVER' | 'TRADE' | 'CHAT' | 'SYSTEM'
          title?: string
          message?: string
          metadata?: Json
          read_status?: boolean
          created_at?: string
          read_at?: string | null
        }
        Relationships: []
      }
      nhl_games: {
        Row: {
          id: string
          game_id: number
          game_date: string
          game_time: string | null
          home_team: string
          away_team: string
          home_score: number
          away_score: number
          status: string
          period: string | null
          period_time: string | null
          venue: string | null
          season: number
          game_type: string
          moneyline_home: number | null
          moneyline_away: number | null
          implied_win_probability_home: number | null
          implied_win_probability_away: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          game_id: number
          game_date: string
          game_time?: string | null
          home_team: string
          away_team: string
          home_score?: number
          away_score?: number
          status?: string
          period?: string | null
          period_time?: string | null
          venue?: string | null
          season: number
          game_type?: string
          moneyline_home?: number | null
          moneyline_away?: number | null
          implied_win_probability_home?: number | null
          implied_win_probability_away?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          game_id?: number
          game_date?: string
          game_time?: string | null
          home_team?: string
          away_team?: string
          home_score?: number
          away_score?: number
          status?: string
          period?: string | null
          period_time?: string | null
          venue?: string | null
          season?: number
          game_type?: string
          moneyline_home?: number | null
          moneyline_away?: number | null
          implied_win_probability_home?: number | null
          implied_win_probability_away?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_directory: {
        Row: {
          season: number
          player_id: number
          full_name: string
          team_abbrev: string | null
          position_code: string | null
          is_goalie: boolean
          jersey_number: string | null
          headshot_url: string | null
          shoots_catches: string | null
          height_in: number | null
          weight_lb: number | null
          birthdate: string | null
          nationality: string | null
          college_team: string | null
          prior_team: string | null
          bio_summary: string | null
          notes: string | null
          source_last_fetched_at: string | null
          eligible_positions: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          season: number
          player_id: number
          full_name: string
          team_abbrev?: string | null
          position_code?: string | null
          is_goalie?: boolean
          jersey_number?: string | null
          headshot_url?: string | null
          shoots_catches?: string | null
          height_in?: number | null
          weight_lb?: number | null
          birthdate?: string | null
          nationality?: string | null
          college_team?: string | null
          prior_team?: string | null
          bio_summary?: string | null
          notes?: string | null
          source_last_fetched_at?: string | null
          eligible_positions?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          season?: number
          player_id?: number
          full_name?: string
          team_abbrev?: string | null
          position_code?: string | null
          is_goalie?: boolean
          jersey_number?: string | null
          headshot_url?: string | null
          shoots_catches?: string | null
          height_in?: number | null
          weight_lb?: number | null
          birthdate?: string | null
          nationality?: string | null
          college_team?: string | null
          prior_team?: string | null
          bio_summary?: string | null
          notes?: string | null
          source_last_fetched_at?: string | null
          eligible_positions?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_projected_stats: {
        Row: {
          projection_id: string
          player_id: number
          game_id: number
          projection_date: string
          projected_goals: number
          projected_assists: number
          projected_sog: number
          projected_blocks: number
          projected_xg: number
          projected_ppp: number | null
          projected_shp: number | null
          projected_hits: number | null
          projected_pim: number | null
          total_projected_points: number
          base_ppg: number | null
          shrinkage_weight: number | null
          finishing_multiplier: number | null
          opponent_adjustment: number | null
          b2b_penalty: number | null
          home_away_adjustment: number | null
          calculation_method: string | null
          confidence_score: number | null
          projected_vopa: number | null
          is_goalie: boolean
          projected_wins: number | null
          projected_saves: number | null
          projected_shutouts: number | null
          projected_goals_against: number | null
          projected_gaa: number | null
          projected_save_pct: number | null
          projected_gp: number | null
          starter_confirmed: boolean | null
          projection_mean: number | null
          projection_std_dev: number | null
          projection_ci_lower: number | null
          projection_ci_upper: number | null
          projection_ci_50_lower: number | null
          projection_ci_50_upper: number | null
          projection_median: number | null
          projection_skewness: number | null
          upside_probability: number | null
          floor_probability: number | null
          dynamic_confidence: number | null
          likely_low: number | null
          likely_high: number | null
          confidence_label: string | null
          season: number
          created_at: string
          updated_at: string
        }
        Insert: {
          projection_id?: string
          player_id: number
          game_id: number
          projection_date: string
          projected_goals?: number
          projected_assists?: number
          projected_sog?: number
          projected_blocks?: number
          projected_xg?: number
          projected_ppp?: number | null
          projected_shp?: number | null
          projected_hits?: number | null
          projected_pim?: number | null
          total_projected_points?: number
          base_ppg?: number | null
          shrinkage_weight?: number | null
          finishing_multiplier?: number | null
          opponent_adjustment?: number | null
          b2b_penalty?: number | null
          home_away_adjustment?: number | null
          calculation_method?: string | null
          confidence_score?: number | null
          projected_vopa?: number | null
          is_goalie?: boolean
          projected_wins?: number | null
          projected_saves?: number | null
          projected_shutouts?: number | null
          projected_goals_against?: number | null
          projected_gaa?: number | null
          projected_save_pct?: number | null
          projected_gp?: number | null
          starter_confirmed?: boolean | null
          projection_mean?: number | null
          projection_std_dev?: number | null
          projection_ci_lower?: number | null
          projection_ci_upper?: number | null
          projection_ci_50_lower?: number | null
          projection_ci_50_upper?: number | null
          projection_median?: number | null
          projection_skewness?: number | null
          upside_probability?: number | null
          floor_probability?: number | null
          dynamic_confidence?: number | null
          likely_low?: number | null
          likely_high?: number | null
          confidence_label?: string | null
          season: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          projection_id?: string
          player_id?: number
          game_id?: number
          projection_date?: string
          projected_goals?: number
          projected_assists?: number
          projected_sog?: number
          projected_blocks?: number
          projected_xg?: number
          projected_ppp?: number | null
          projected_shp?: number | null
          projected_hits?: number | null
          projected_pim?: number | null
          total_projected_points?: number
          base_ppg?: number | null
          shrinkage_weight?: number | null
          finishing_multiplier?: number | null
          opponent_adjustment?: number | null
          b2b_penalty?: number | null
          home_away_adjustment?: number | null
          calculation_method?: string | null
          confidence_score?: number | null
          projected_vopa?: number | null
          is_goalie?: boolean
          projected_wins?: number | null
          projected_saves?: number | null
          projected_shutouts?: number | null
          projected_goals_against?: number | null
          projected_gaa?: number | null
          projected_save_pct?: number | null
          projected_gp?: number | null
          starter_confirmed?: boolean | null
          projection_mean?: number | null
          projection_std_dev?: number | null
          projection_ci_lower?: number | null
          projection_ci_upper?: number | null
          projection_ci_50_lower?: number | null
          projection_ci_50_upper?: number | null
          projection_median?: number | null
          projection_skewness?: number | null
          upside_probability?: number | null
          floor_probability?: number | null
          dynamic_confidence?: number | null
          likely_low?: number | null
          likely_high?: number | null
          confidence_label?: string | null
          season?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_talent_metrics: {
        Row: {
          player_id: number
          season: number
          gp_last_10: number
          is_likely_to_play: boolean
          last_updated: string | null
          positional_replacement_level: number | null
          positional_std_dev: number | null
          vopa_score: number | null
          vopa_calculation_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          player_id: number
          season: number
          gp_last_10?: number
          is_likely_to_play?: boolean
          last_updated?: string | null
          positional_replacement_level?: number | null
          positional_std_dev?: number | null
          vopa_score?: number | null
          vopa_calculation_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          player_id?: number
          season?: number
          gp_last_10?: number
          is_likely_to_play?: boolean
          last_updated?: string | null
          positional_replacement_level?: number | null
          positional_std_dev?: number | null
          vopa_score?: number | null
          vopa_calculation_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      fantasy_daily_rosters: {
        Row: {
          id: string
          league_id: string
          team_id: string
          matchup_id: string
          player_id: number
          roster_date: string
          slot_type: string
          slot_id: string | null
          is_locked: boolean
          locked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          team_id: string
          matchup_id: string
          player_id: number
          roster_date: string
          slot_type: string
          slot_id?: string | null
          is_locked?: boolean
          locked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          team_id?: string
          matchup_id?: string
          player_id?: number
          roster_date?: string
          slot_type?: string
          slot_id?: string | null
          is_locked?: boolean
          locked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      transaction_ledger: {
        Row: {
          id: string
          league_id: string
          user_id: string
          team_id: string
          type: string
          player_id: string
          source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          league_id: string
          user_id: string
          team_id: string
          type: string
          player_id: string
          source?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          user_id?: string
          team_id?: string
          type?: string
          player_id?: string
          source?: string | null
          created_at?: string
        }
        Relationships: []
      }
      confidence_picks: {
        Row: {
          id: string
          league_id: string
          user_id: string
          week_number: number
          game_id: string
          picked_team: string
          confidence_points: number
          is_correct: boolean | null
          points_earned: number
          created_at: string
        }
        Insert: {
          id?: string
          league_id: string
          user_id: string
          week_number: number
          game_id: string
          picked_team: string
          confidence_points: number
          is_correct?: boolean | null
          points_earned?: number
          created_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          user_id?: string
          week_number?: number
          game_id?: string
          picked_team?: string
          confidence_points?: number
          is_correct?: boolean | null
          points_earned?: number
          created_at?: string
        }
        Relationships: []
      }
      pool_picks: {
        Row: {
          id: string
          league_id: string
          user_id: string
          week_number: number
          game_id: string
          picked_team: string
          is_correct: boolean | null
          spread_value: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          user_id: string
          week_number: number
          game_id: string
          picked_team: string
          is_correct?: boolean | null
          spread_value?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          user_id?: string
          week_number?: number
          game_id?: string
          picked_team?: string
          is_correct?: boolean | null
          spread_value?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      survivor_selections: {
        Row: {
          id: string
          league_id: string
          user_id: string
          week_number: number
          picked_team: string
          is_correct: boolean | null
          created_at: string
        }
        Insert: {
          id?: string
          league_id: string
          user_id: string
          week_number: number
          picked_team: string
          is_correct?: boolean | null
          created_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          user_id?: string
          week_number?: number
          picked_team?: string
          is_correct?: boolean | null
          created_at?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          id: string
          email: string
          created_at: string
          source: string | null
          user_agent: string | null
          ip_address: string | null
        }
        Insert: {
          id?: string
          email: string
          created_at?: string
          source?: string | null
          user_agent?: string | null
          ip_address?: string | null
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
          source?: string | null
          user_agent?: string | null
          ip_address?: string | null
        }
        Relationships: []
      }
      auction_budgets: {
        Row: {
          id: string
          league_id: string
          team_id: string
          initial_budget: number
          remaining_budget: number
          players_won: number
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          team_id: string
          initial_budget?: number
          remaining_budget?: number
          players_won?: number
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          team_id?: string
          initial_budget?: number
          remaining_budget?: number
          players_won?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
