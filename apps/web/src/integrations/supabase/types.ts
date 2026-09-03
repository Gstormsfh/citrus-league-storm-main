export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _preshot_rebuild_baseline: {
        Row: {
          captured_at: string | null
          games: number | null
          goals: number | null
          neg_sec_prev: number | null
          rebounds: number | null
          rushes: number | null
          season: number | null
          shots: number | null
          sum_xg: number | null
        }
        Insert: {
          captured_at?: string | null
          games?: number | null
          goals?: number | null
          neg_sec_prev?: number | null
          rebounds?: number | null
          rushes?: number | null
          season?: number | null
          shots?: number | null
          sum_xg?: number | null
        }
        Update: {
          captured_at?: string | null
          games?: number | null
          goals?: number | null
          neg_sec_prev?: number | null
          rebounds?: number | null
          rushes?: number | null
          season?: number | null
          shots?: number | null
          sum_xg?: number | null
        }
        Relationships: []
      }
      auction_bids: {
        Row: {
          bid_amount: number
          created_at: string
          id: string
          league_id: string
          nomination_id: string
          team_id: string
        }
        Insert: {
          bid_amount: number
          created_at?: string
          id?: string
          league_id: string
          nomination_id: string
          team_id: string
        }
        Update: {
          bid_amount?: number
          created_at?: string
          id?: string
          league_id?: string
          nomination_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_bids_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_bids_nomination_id_fkey"
            columns: ["nomination_id"]
            isOneToOne: false
            referencedRelation: "auction_nominations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_budgets: {
        Row: {
          id: string
          initial_budget: number
          league_id: string
          players_won: number
          remaining_budget: number
          team_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          initial_budget?: number
          league_id: string
          players_won?: number
          remaining_budget?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          initial_budget?: number
          league_id?: string
          players_won?: number
          remaining_budget?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_budgets_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_budgets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_nominations: {
        Row: {
          created_at: string
          current_high_bid: number
          current_high_bidder_team_id: string | null
          draft_session_id: string
          expires_at: string
          id: string
          league_id: string
          minimum_bid: number
          nominated_by_team_id: string
          nomination_event_id: number | null
          nomination_number: number
          player_id: string
          player_name: string
          status: string
        }
        Insert: {
          created_at?: string
          current_high_bid?: number
          current_high_bidder_team_id?: string | null
          draft_session_id: string
          expires_at: string
          id?: string
          league_id: string
          minimum_bid?: number
          nominated_by_team_id: string
          nomination_event_id?: number | null
          nomination_number: number
          player_id: string
          player_name: string
          status?: string
        }
        Update: {
          created_at?: string
          current_high_bid?: number
          current_high_bidder_team_id?: string | null
          draft_session_id?: string
          expires_at?: string
          id?: string
          league_id?: string
          minimum_bid?: number
          nominated_by_team_id?: string
          nomination_event_id?: number | null
          nomination_number?: number
          player_id?: string
          player_name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_nominations_current_high_bidder_team_id_fkey"
            columns: ["current_high_bidder_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_nominations_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_nominations_nominated_by_team_id_fkey"
            columns: ["nominated_by_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_recovery_log: {
        Row: {
          details: string | null
          id: string
          players_restored: number | null
          recovery_method: string | null
          recovery_time: string | null
          success: boolean | null
          teams_affected: string[] | null
          trigger_reason: string
        }
        Insert: {
          details?: string | null
          id?: string
          players_restored?: number | null
          recovery_method?: string | null
          recovery_time?: string | null
          success?: boolean | null
          teams_affected?: string[] | null
          trigger_reason: string
        }
        Update: {
          details?: string | null
          id?: string
          players_restored?: number | null
          recovery_method?: string | null
          recovery_time?: string | null
          success?: boolean | null
          teams_affected?: string[] | null
          trigger_reason?: string
        }
        Relationships: []
      }
      autopick_failures: {
        Row: {
          failed_at: string
          id: number
          last_error: string | null
          league_id: string
          payload: Json
          pgmq_msg_id: number
          read_ct: number
        }
        Insert: {
          failed_at?: string
          id?: number
          last_error?: string | null
          league_id: string
          payload: Json
          pgmq_msg_id: number
          read_ct: number
        }
        Update: {
          failed_at?: string
          id?: number
          last_error?: string | null
          league_id?: string
          payload?: Json
          pgmq_msg_id?: number
          read_ct?: number
        }
        Relationships: []
      }
      bingo_card_recipe: {
        Row: {
          easy_lo: number
          easy_n: number
          hard_lo: number
          hard_n: number
          id: string
          long_n: number
          mid_lo: number
          mid_n: number
          near_lo: number
          near_n: number
          note: string | null
          updated_at: string
        }
        Insert: {
          easy_lo?: number
          easy_n: number
          hard_lo?: number
          hard_n: number
          id: string
          long_n: number
          mid_lo?: number
          mid_n: number
          near_lo?: number
          near_n: number
          note?: string | null
          updated_at?: string
        }
        Update: {
          easy_lo?: number
          easy_n?: number
          hard_lo?: number
          hard_n?: number
          id?: string
          long_n?: number
          mid_lo?: number
          mid_n?: number
          near_lo?: number
          near_n?: number
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bingo_card_squares: {
        Row: {
          card_id: string
          pos: number
          square_id: string
        }
        Insert: {
          card_id: string
          pos: number
          square_id: string
        }
        Update: {
          card_id?: string
          pos?: number
          square_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bingo_card_squares_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "bingo_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bingo_card_squares_square_id_fkey"
            columns: ["square_id"]
            isOneToOne: false
            referencedRelation: "bingo_squares"
            referencedColumns: ["id"]
          },
        ]
      }
      bingo_cards: {
        Row: {
          created_at: string
          focus_team: number
          game_id: number
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          focus_team: number
          game_id: number
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          focus_team?: number
          game_id?: number
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bingo_cards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bingo_hit_games: {
        Row: {
          focus_team: number
          game_id: number
          scanned_at: string
        }
        Insert: {
          focus_team: number
          game_id: number
          scanned_at?: string
        }
        Update: {
          focus_team?: number
          game_id?: number
          scanned_at?: string
        }
        Relationships: []
      }
      bingo_player_game_stats: {
        Row: {
          game_id: number
          n: number
          player_id: number
          stat: string
          team_id: number
        }
        Insert: {
          game_id: number
          n: number
          player_id: number
          stat: string
          team_id: number
        }
        Update: {
          game_id?: number
          n?: number
          player_id?: number
          stat?: string
          team_id?: number
        }
        Relationships: []
      }
      bingo_player_stat_games: {
        Row: {
          game_id: number
          scanned_at: string
        }
        Insert: {
          game_id: number
          scanned_at?: string
        }
        Update: {
          game_id?: number
          scanned_at?: string
        }
        Relationships: []
      }
      bingo_square_game_hits: {
        Row: {
          focus_team: number
          game_id: number
          hit_at: string | null
          hit_seconds: number | null
          square_id: string
        }
        Insert: {
          focus_team: number
          game_id: number
          hit_at?: string | null
          hit_seconds?: number | null
          square_id: string
        }
        Update: {
          focus_team?: number
          game_id?: number
          hit_at?: string | null
          hit_seconds?: number | null
          square_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bingo_square_game_hits_square_id_fkey"
            columns: ["square_id"]
            isOneToOne: false
            referencedRelation: "bingo_squares"
            referencedColumns: ["id"]
          },
        ]
      }
      bingo_square_rates: {
        Row: {
          calibrated_at: string
          hit_rate: number
          hit_rate_n: number
          square_id: string
          team_id: number
        }
        Insert: {
          calibrated_at?: string
          hit_rate: number
          hit_rate_n: number
          square_id: string
          team_id: number
        }
        Update: {
          calibrated_at?: string
          hit_rate?: number
          hit_rate_n?: number
          square_id?: string
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bingo_square_rates_square_id_fkey"
            columns: ["square_id"]
            isOneToOne: false
            referencedRelation: "bingo_squares"
            referencedColumns: ["id"]
          },
        ]
      }
      bingo_squares: {
        Row: {
          active: boolean
          calibrated_at: string | null
          code: string | null
          created_at: string
          headshot_url: string | null
          hit_rate: number | null
          hit_rate_n: number | null
          id: string
          kind: string
          label: string
          params: Json
          team_id: number | null
          team_scope: string
        }
        Insert: {
          active?: boolean
          calibrated_at?: string | null
          code?: string | null
          created_at?: string
          headshot_url?: string | null
          hit_rate?: number | null
          hit_rate_n?: number | null
          id?: string
          kind: string
          label: string
          params?: Json
          team_id?: number | null
          team_scope?: string
        }
        Update: {
          active?: boolean
          calibrated_at?: string | null
          code?: string | null
          created_at?: string
          headshot_url?: string | null
          hit_rate?: number | null
          hit_rate_n?: number | null
          id?: string
          kind?: string
          label?: string
          params?: Json
          team_id?: number | null
          team_scope?: string
        }
        Relationships: []
      }
      citrus_news: {
        Row: {
          analysis: string | null
          body: string
          created_at: string
          dedupe_key: string
          headline: string
          id: string
          kind: string
          player_id: number | null
          published_at: string
          season: number
          severity: string
          tags: string[]
        }
        Insert: {
          analysis?: string | null
          body: string
          created_at?: string
          dedupe_key: string
          headline: string
          id?: string
          kind: string
          player_id?: number | null
          published_at?: string
          season: number
          severity?: string
          tags?: string[]
        }
        Update: {
          analysis?: string | null
          body?: string
          created_at?: string
          dedupe_key?: string
          headline?: string
          id?: string
          kind?: string
          player_id?: number | null
          published_at?: string
          season?: number
          severity?: string
          tags?: string[]
        }
        Relationships: []
      }
      citrus_ops_config: {
        Row: {
          key: string
          note: string | null
          updated_at: string
          value_num: number | null
          value_text: string | null
        }
        Insert: {
          key: string
          note?: string | null
          updated_at?: string
          value_num?: number | null
          value_text?: string | null
        }
        Update: {
          key?: string
          note?: string | null
          updated_at?: string
          value_num?: number | null
          value_text?: string | null
        }
        Relationships: []
      }
      confidence_picks: {
        Row: {
          confidence_points: number
          created_at: string
          game_id: string
          id: string
          is_correct: boolean | null
          league_id: string
          picked_team: string
          points_earned: number
          user_id: string
          week_number: number
        }
        Insert: {
          confidence_points: number
          created_at?: string
          game_id: string
          id?: string
          is_correct?: boolean | null
          league_id: string
          picked_team: string
          points_earned?: number
          user_id: string
          week_number: number
        }
        Update: {
          confidence_points?: number
          created_at?: string
          game_id?: string
          id?: string
          is_correct?: boolean | null
          league_id?: string
          picked_team?: string
          points_earned?: number
          user_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "confidence_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_job_registry: {
        Row: {
          first_seen: string
          jobid: number
          jobname: string
        }
        Insert: {
          first_seen?: string
          jobid: number
          jobname: string
        }
        Update: {
          first_seen?: string
          jobid?: number
          jobname?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_events: {
        Row: {
          actor: Json
          causation_id: number | null
          correlation_id: string
          created_at: string
          event_type: string
          event_version: number
          id: number
          idempotency_key: string | null
          league_id: string
          payload: Json
          payload_hash: string
          seq: number
        }
        Insert: {
          actor: Json
          causation_id?: number | null
          correlation_id: string
          created_at?: string
          event_type: string
          event_version?: number
          id?: number
          idempotency_key?: string | null
          league_id: string
          payload: Json
          payload_hash: string
          seq: number
        }
        Update: {
          actor?: Json
          causation_id?: number | null
          correlation_id?: string
          created_at?: string
          event_type?: string
          event_version?: number
          id?: number
          idempotency_key?: string | null
          league_id?: string
          payload?: Json
          payload_hash?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_events_causation_id_fkey"
            columns: ["causation_id"]
            isOneToOne: false
            referencedRelation: "draft_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_events_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_kit_blurbs: {
        Row: {
          author_name: string
          author_role: string | null
          body: string
          created_at: string
          id: string
          is_published: boolean
          kind: string
          player_id: number | null
          published_at: string | null
          season: number
          source_name: string | null
          source_url: string | null
          tier_required: string
          title: string
          updated_at: string
        }
        Insert: {
          author_name: string
          author_role?: string | null
          body: string
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          player_id?: number | null
          published_at?: string | null
          season: number
          source_name?: string | null
          source_url?: string | null
          tier_required?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_name?: string
          author_role?: string | null
          body?: string
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          player_id?: number | null
          published_at?: string | null
          season?: number
          source_name?: string | null
          source_url?: string | null
          tier_required?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      draft_kit_entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_at: string
          id: string
          notes: string | null
          source: string
          tier: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          notes?: string | null
          source?: string
          tier: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_at?: string
          id?: string
          notes?: string | null
          source?: string
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      draft_metrics: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_04: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_05: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_06: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_07: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_08: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_09: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_10: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_11: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2026_12: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2027_01: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2027_02: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_2027_03: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_metrics_daily: {
        Row: {
          day: string
          id: number
          league_id: string | null
          metric: string
          total: number
        }
        Insert: {
          day: string
          id?: number
          league_id?: string | null
          metric: string
          total?: number
        }
        Update: {
          day?: string
          id?: number
          league_id?: string | null
          metric?: string
          total?: number
        }
        Relationships: []
      }
      draft_metrics_default: {
        Row: {
          detail: Json | null
          id: number
          league_id: string | null
          metric: string
          ts: string
          value: number
        }
        Insert: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric: string
          ts?: string
          value?: number
        }
        Update: {
          detail?: Json | null
          id?: number
          league_id?: string | null
          metric?: string
          ts?: string
          value?: number
        }
        Relationships: []
      }
      draft_order: {
        Row: {
          created_at: string
          deleted_at: string | null
          draft_session_id: string | null
          id: string
          league_id: string
          round_number: number
          team_order: Json
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          draft_session_id?: string | null
          id?: string
          league_id: string
          round_number: number
          team_order: Json
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          draft_session_id?: string | null
          id?: string
          league_id?: string
          round_number?: number
          team_order?: Json
        }
        Relationships: [
          {
            foreignKeyName: "draft_order_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_picks: {
        Row: {
          deleted_at: string | null
          draft_session_id: string | null
          id: string
          league_id: string
          pick_number: number
          picked_at: string
          player_id: string
          reservation_expires_at: string | null
          reserved_at: string | null
          reserved_by: string | null
          round_number: number
          team_id: string
        }
        Insert: {
          deleted_at?: string | null
          draft_session_id?: string | null
          id?: string
          league_id: string
          pick_number: number
          picked_at?: string
          player_id: string
          reservation_expires_at?: string | null
          reserved_at?: string | null
          reserved_by?: string | null
          round_number: number
          team_id: string
        }
        Update: {
          deleted_at?: string | null
          draft_session_id?: string | null
          id?: string
          league_id?: string
          pick_number?: number
          picked_at?: string
          player_id?: string
          reservation_expires_at?: string | null
          reserved_at?: string | null
          reserved_by?: string | null
          round_number?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_picks_v2: {
        Row: {
          league_id: string
          pick_number: number
          picked_at: string
          picked_by_actor: Json
          player_id: number
          round: number
          source_event_id: number
          source_seq: number
          team_id: string
        }
        Insert: {
          league_id: string
          pick_number: number
          picked_at: string
          picked_by_actor: Json
          player_id: number
          round: number
          source_event_id: number
          source_seq: number
          team_id: string
        }
        Update: {
          league_id?: string
          pick_number?: number
          picked_at?: string
          picked_by_actor?: Json
          player_id?: number
          round?: number
          source_event_id?: number
          source_seq?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_picks_v2_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_v2_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "draft_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_picks_v2_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_queues: {
        Row: {
          created_at: string
          league_id: string
          player_id: number
          position: number
          team_id: string
        }
        Insert: {
          created_at?: string
          league_id: string
          player_id: number
          position: number
          team_id: string
        }
        Update: {
          created_at?: string
          league_id?: string
          player_id?: number
          position?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_queues_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_queues_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_snapshots: {
        Row: {
          created_at: string
          engine_state: Json
          engine_version: number
          id: string
          last_applied_seq: number
          league_id: string
          snapshot_payload: Json
        }
        Insert: {
          created_at?: string
          engine_state: Json
          engine_version: number
          id?: string
          last_applied_seq: number
          league_id: string
          snapshot_payload: Json
        }
        Update: {
          created_at?: string
          engine_state?: Json
          engine_version?: number
          id?: string
          last_applied_seq?: number
          league_id?: string
          snapshot_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "draft_snapshots_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      faab_budgets: {
        Row: {
          id: string
          initial_budget: number
          league_id: string
          remaining_budget: number
          team_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          initial_budget?: number
          league_id: string
          remaining_budget?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          initial_budget?: number
          league_id?: string
          remaining_budget?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faab_budgets_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faab_budgets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_transactions: {
        Row: {
          attempted_at: string | null
          error_detail: string | null
          error_message: string | null
          id: string
          league_id: string | null
          operation_type: string | null
          player_id: string | null
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          attempted_at?: string | null
          error_detail?: string | null
          error_message?: string | null
          id?: string
          league_id?: string | null
          operation_type?: string | null
          player_id?: string | null
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          attempted_at?: string | null
          error_detail?: string | null
          error_message?: string | null
          id?: string
          league_id?: string | null
          operation_type?: string | null
          player_id?: string | null
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      fantasy_daily_rosters: {
        Row: {
          created_at: string
          id: string
          is_locked: boolean
          league_id: string
          locked_at: string | null
          matchup_id: string
          player_id: number
          roster_date: string
          slot_id: string | null
          slot_type: string
          source: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_locked?: boolean
          league_id: string
          locked_at?: string | null
          matchup_id: string
          player_id: number
          roster_date: string
          slot_id?: string | null
          slot_type: string
          source?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_locked?: boolean
          league_id?: string
          locked_at?: string | null
          matchup_id?: string
          player_id?: number
          roster_date?: string
          slot_id?: string | null
          slot_type?: string
          source?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_daily_rosters_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_daily_rosters_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_daily_rosters_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_matchup_lines: {
        Row: {
          created_at: string
          games_played: number
          games_remaining_active: number
          games_remaining_total: number
          has_live_game: boolean
          id: string
          live_game_locked: boolean
          matchup_id: string
          player_id: number
          stats_breakdown: Json
          team_id: string
          total_points: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          games_played?: number
          games_remaining_active?: number
          games_remaining_total?: number
          has_live_game?: boolean
          id?: string
          live_game_locked?: boolean
          matchup_id: string
          player_id: number
          stats_breakdown?: Json
          team_id: string
          total_points?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          games_played?: number
          games_remaining_active?: number
          games_remaining_total?: number
          has_live_game?: boolean
          id?: string
          live_game_locked?: boolean
          matchup_id?: string
          player_id?: number
          stats_breakdown?: Json
          team_id?: string
          total_points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_matchup_lines_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_matchup_lines_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      function_error_log: {
        Row: {
          context: string | null
          details: Json | null
          fn: string
          id: number
          message: string | null
          occurred_at: string
          sqlstate: string | null
          user_id: string | null
        }
        Insert: {
          context?: string | null
          details?: Json | null
          fn: string
          id?: never
          message?: string | null
          occurred_at?: string
          sqlstate?: string | null
          user_id?: string | null
        }
        Update: {
          context?: string | null
          details?: Json | null
          fn?: string
          id?: never
          message?: string | null
          occurred_at?: string
          sqlstate?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      game_contests: {
        Row: {
          created_at: string
          created_by: string | null
          finalized_at: string | null
          focus_team: number | null
          game_code: string
          id: string
          league_id: string | null
          locks_at: string | null
          nhl_game_id: number | null
          opens_at: string
          scope: string
          status: string
          title: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          focus_team?: number | null
          game_code: string
          id?: string
          league_id?: string | null
          locks_at?: string | null
          nhl_game_id?: number | null
          opens_at?: string
          scope: string
          status?: string
          title?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          focus_team?: number | null
          game_code?: string
          id?: string
          league_id?: string | null
          locks_at?: string | null
          nhl_game_id?: number | null
          opens_at?: string
          scope?: string
          status?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_contests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_contests_game_code_fkey"
            columns: ["game_code"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "game_contests_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      game_entries: {
        Row: {
          contest_id: string
          created_at: string
          detail: Json | null
          finalized_at: string | null
          id: string
          ref_id: string | null
          score: number | null
          team_id: string | null
          user_id: string
        }
        Insert: {
          contest_id: string
          created_at?: string
          detail?: Json | null
          finalized_at?: string | null
          id?: string
          ref_id?: string | null
          score?: number | null
          team_id?: string | null
          user_id: string
        }
        Update: {
          contest_id?: string
          created_at?: string
          detail?: Json | null
          finalized_at?: string | null
          id?: string
          ref_id?: string | null
          score?: number | null
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_entries_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "game_contests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_strength_intervals: {
        Row: {
          away_goalie: number
          away_skaters: number
          built_at: string
          end_s: number
          game_id: number
          home_goalie: number
          home_skaters: number
          period: number
          start_s: number
        }
        Insert: {
          away_goalie: number
          away_skaters: number
          built_at?: string
          end_s: number
          game_id: number
          home_goalie: number
          home_skaters: number
          period: number
          start_s: number
        }
        Update: {
          away_goalie?: number
          away_skaters?: number
          built_at?: string
          end_s?: number
          game_id?: number
          home_goalie?: number
          home_skaters?: number
          period?: number
          start_s?: number
        }
        Relationships: []
      }
      game_teams: {
        Row: {
          away_id: number
          game_id: number
          game_type: number
          home_id: number
          season: number
        }
        Insert: {
          away_id: number
          game_id: number
          game_type: number
          home_id: number
          season: number
        }
        Update: {
          away_id?: number
          game_id?: number
          game_type?: number
          home_id?: number
          season?: number
        }
        Relationships: []
      }
      games: {
        Row: {
          active: boolean
          code: string
          created_at: string
          name: string
          needs_nhl_game: boolean
          scorer_fn: string
          sort_order: number
          tagline: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          name: string
          needs_nhl_game?: boolean
          scorer_fn: string
          sort_order?: number
          tagline?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          name?: string
          needs_nhl_game?: boolean
          scorer_fn?: string
          sort_order?: number
          tagline?: string | null
        }
        Relationships: []
      }
      goalie_gar: {
        Row: {
          calculated_at: string | null
          goalie_id: number
          primary_gsax_score: number | null
          rebound_control_score: number | null
          total_gar: number
          updated_at: string | null
        }
        Insert: {
          calculated_at?: string | null
          goalie_id: number
          primary_gsax_score?: number | null
          rebound_control_score?: number | null
          total_gar: number
          updated_at?: string | null
        }
        Update: {
          calculated_at?: string | null
          goalie_id?: number
          primary_gsax_score?: number | null
          rebound_control_score?: number | null
          total_gar?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      goalie_gsax: {
        Row: {
          calculated_at: string
          goalie_id: number
          league_sv_pct: number | null
          raw_gsax: number
          regressed_gsax: number
          season: number
          total_ga: number
          total_shots_faced: number
          total_xga: number
          updated_at: string
        }
        Insert: {
          calculated_at?: string
          goalie_id: number
          league_sv_pct?: number | null
          raw_gsax: number
          regressed_gsax: number
          season?: number
          total_ga: number
          total_shots_faced: number
          total_xga: number
          updated_at?: string
        }
        Update: {
          calculated_at?: string
          goalie_id?: number
          league_sv_pct?: number | null
          raw_gsax?: number
          regressed_gsax?: number
          season?: number
          total_ga?: number
          total_shots_faced?: number
          total_xga?: number
          updated_at?: string
        }
        Relationships: []
      }
      goalie_gsax_primary: {
        Row: {
          calculated_at: string
          goalie_id: number
          league_sv_pct: number | null
          raw_gsax: number
          regressed_gsax: number
          season: number | null
          total_ga: number
          total_shots_faced: number
          total_xga: number
          updated_at: string
        }
        Insert: {
          calculated_at?: string
          goalie_id: number
          league_sv_pct?: number | null
          raw_gsax: number
          regressed_gsax: number
          season?: number | null
          total_ga: number
          total_shots_faced: number
          total_xga: number
          updated_at?: string
        }
        Update: {
          calculated_at?: string
          goalie_id?: number
          league_sv_pct?: number | null
          raw_gsax?: number
          regressed_gsax?: number
          season?: number | null
          total_ga?: number
          total_shots_faced?: number
          total_xga?: number
          updated_at?: string
        }
        Relationships: []
      }
      goalie_rebound_control: {
        Row: {
          adj_rebound_pct: number | null
          calculated_at: string | null
          effective_saves: number
          goalie_id: number
          puck_freezes: number
          rebound_shots_allowed: number
          rebound_shots_per_60_saves: number | null
          total_saves: number
          updated_at: string | null
        }
        Insert: {
          adj_rebound_pct?: number | null
          calculated_at?: string | null
          effective_saves?: number
          goalie_id: number
          puck_freezes?: number
          rebound_shots_allowed?: number
          rebound_shots_per_60_saves?: number | null
          total_saves?: number
          updated_at?: string | null
        }
        Update: {
          adj_rebound_pct?: number | null
          calculated_at?: string | null
          effective_saves?: number
          goalie_id?: number
          puck_freezes?: number
          rebound_shots_allowed?: number
          rebound_shots_per_60_saves?: number | null
          total_saves?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      goalie_xg_season: {
        Row: {
          avg_shot_dist_faced: number | null
          game_type: string
          goalie_id: number
          goals_allowed: number
          goals_allowed_ev: number
          goals_allowed_pk: number
          gsax: number
          season: number
          shots_faced: number
          sog_faced: number
          team_id: number
          updated_at: string
          xg_faced: number
          xg_faced_ev: number
          xg_faced_pk: number
        }
        Insert: {
          avg_shot_dist_faced?: number | null
          game_type: string
          goalie_id: number
          goals_allowed: number
          goals_allowed_ev: number
          goals_allowed_pk: number
          gsax: number
          season: number
          shots_faced: number
          sog_faced: number
          team_id: number
          updated_at?: string
          xg_faced: number
          xg_faced_ev: number
          xg_faced_pk: number
        }
        Update: {
          avg_shot_dist_faced?: number | null
          game_type?: string
          goalie_id?: number
          goals_allowed?: number
          goals_allowed_ev?: number
          goals_allowed_pk?: number
          gsax?: number
          season?: number
          shots_faced?: number
          sog_faced?: number
          team_id?: number
          updated_at?: string
          xg_faced?: number
          xg_faced_ev?: number
          xg_faced_pk?: number
        }
        Relationships: []
      }
      integrity_check_results: {
        Row: {
          affected_teams: string[] | null
          auto_fixed: boolean | null
          check_name: string
          check_time: string | null
          details: string | null
          id: string
          status: string
        }
        Insert: {
          affected_teams?: string[] | null
          auto_fixed?: boolean | null
          check_name: string
          check_time?: string | null
          details?: string | null
          id?: string
          status: string
        }
        Update: {
          affected_teams?: string[] | null
          auto_fixed?: boolean | null
          check_name?: string
          check_time?: string | null
          details?: string | null
          id?: string
          status?: string
        }
        Relationships: []
      }
      join_code_attempts: {
        Row: {
          attempt_time: string
          id: string
          ip_address: unknown
          join_code: string
          success: boolean
          user_agent: string | null
          user_id: string
        }
        Insert: {
          attempt_time?: string
          id?: string
          ip_address?: unknown
          join_code: string
          success?: boolean
          user_agent?: string | null
          user_id: string
        }
        Update: {
          attempt_time?: string
          id?: string
          ip_address?: unknown
          join_code?: string
          success?: boolean
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      keeper_designations: {
        Row: {
          approved_by: string | null
          designated_at: string
          id: string
          keeper_penalty_type: string | null
          keeper_round: number | null
          league_id: string
          original_draft_round: number | null
          player_id: string
          season_year: number
          status: string
          team_id: string
          updated_at: string
          years_kept: number
        }
        Insert: {
          approved_by?: string | null
          designated_at?: string
          id?: string
          keeper_penalty_type?: string | null
          keeper_round?: number | null
          league_id: string
          original_draft_round?: number | null
          player_id: string
          season_year: number
          status?: string
          team_id: string
          updated_at?: string
          years_kept?: number
        }
        Update: {
          approved_by?: string | null
          designated_at?: string
          id?: string
          keeper_penalty_type?: string | null
          keeper_round?: number | null
          league_id?: string
          original_draft_round?: number | null
          player_id?: string
          season_year?: number
          status?: string
          team_id?: string
          updated_at?: string
          years_kept?: number
        }
        Relationships: [
          {
            foreignKeyName: "keeper_designations_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "keeper_designations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      league_averages: {
        Row: {
          avg_assists_per_game: number
          avg_blocks_per_game: number
          avg_goals_per_game: number
          avg_hits_per_game: number
          avg_pim_per_game: number
          avg_ppg: number
          avg_ppp_per_game: number
          avg_shp_per_game: number
          avg_sog_per_game: number
          id: string
          league_avg_shots_for_per_60: number | null
          league_avg_sv_pct: number | null
          league_avg_xga_per_60: number | null
          position: string
          replacement_assists_per_game: number | null
          replacement_blocks_per_game: number | null
          replacement_fpts_per_60: number | null
          replacement_goals_per_game: number | null
          replacement_sog_per_game: number | null
          sample_size: number
          season: number
          std_dev_assists_per_game: number | null
          std_dev_blocks_per_game: number | null
          std_dev_fpts_per_60: number | null
          std_dev_goals_per_game: number | null
          std_dev_sog_per_game: number | null
          updated_at: string
        }
        Insert: {
          avg_assists_per_game?: number
          avg_blocks_per_game?: number
          avg_goals_per_game?: number
          avg_hits_per_game?: number
          avg_pim_per_game?: number
          avg_ppg?: number
          avg_ppp_per_game?: number
          avg_shp_per_game?: number
          avg_sog_per_game?: number
          id?: string
          league_avg_shots_for_per_60?: number | null
          league_avg_sv_pct?: number | null
          league_avg_xga_per_60?: number | null
          position: string
          replacement_assists_per_game?: number | null
          replacement_blocks_per_game?: number | null
          replacement_fpts_per_60?: number | null
          replacement_goals_per_game?: number | null
          replacement_sog_per_game?: number | null
          sample_size?: number
          season: number
          std_dev_assists_per_game?: number | null
          std_dev_blocks_per_game?: number | null
          std_dev_fpts_per_60?: number | null
          std_dev_goals_per_game?: number | null
          std_dev_sog_per_game?: number | null
          updated_at?: string
        }
        Update: {
          avg_assists_per_game?: number
          avg_blocks_per_game?: number
          avg_goals_per_game?: number
          avg_hits_per_game?: number
          avg_pim_per_game?: number
          avg_ppg?: number
          avg_ppp_per_game?: number
          avg_shp_per_game?: number
          avg_sog_per_game?: number
          id?: string
          league_avg_shots_for_per_60?: number | null
          league_avg_sv_pct?: number | null
          league_avg_xga_per_60?: number | null
          position?: string
          replacement_assists_per_game?: number | null
          replacement_blocks_per_game?: number | null
          replacement_fpts_per_60?: number | null
          replacement_goals_per_game?: number | null
          replacement_sog_per_game?: number | null
          sample_size?: number
          season?: number
          std_dev_assists_per_game?: number | null
          std_dev_blocks_per_game?: number | null
          std_dev_fpts_per_60?: number | null
          std_dev_goals_per_game?: number | null
          std_dev_sog_per_game?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      league_history_requests: {
        Row: {
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          league_id: string
          outcome_note: string | null
          platform: string | null
          ready_at: string | null
          requested_by: string
          screenshot_paths: string[]
          seasons_note: string | null
          source_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          league_id: string
          outcome_note?: string | null
          platform?: string | null
          ready_at?: string | null
          requested_by: string
          screenshot_paths?: string[]
          seasons_note?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          league_id?: string
          outcome_note?: string | null
          platform?: string | null
          ready_at?: string | null
          requested_by?: string
          screenshot_paths?: string[]
          seasons_note?: string | null
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_history_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_history_requests_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_history_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_members: {
        Row: {
          created_at: string
          display_name: string
          first_season: number | null
          id: string
          last_season: number | null
          league_id: string
          owner_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          first_season?: number | null
          id?: string
          last_season?: number | null
          league_id: string
          owner_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          first_season?: number | null
          id?: string
          last_season?: number | null
          league_id?: string
          owner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_members_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_scoring_audit: {
        Row: {
          actor_id: string | null
          created_at: string
          id: number
          league_id: string
          new_scoring: Json | null
          old_scoring: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: number
          league_id: string
          new_scoring?: Json | null
          old_scoring?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: number
          league_id?: string
          new_scoring?: Json | null
          old_scoring?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "league_scoring_audit_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_scoring_rules: {
        Row: {
          league_id: string
          multiplier: number
          stat_key: string
          updated_at: string
        }
        Insert: {
          league_id: string
          multiplier: number
          stat_key: string
          updated_at?: string
        }
        Update: {
          league_id?: string
          multiplier?: number
          stat_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_scoring_rules_stat_key_fkey"
            columns: ["stat_key"]
            isOneToOne: false
            referencedRelation: "stat_catalog"
            referencedColumns: ["stat_key"]
          },
        ]
      }
      league_season_teams: {
        Row: {
          league_id: string
          losses: number | null
          made_playoffs: boolean | null
          member_id: string
          playoff_finish: number | null
          points_against: number | null
          points_for: number | null
          rank: number | null
          season: number
          team_name: string | null
          ties: number | null
          wins: number | null
        }
        Insert: {
          league_id: string
          losses?: number | null
          made_playoffs?: boolean | null
          member_id: string
          playoff_finish?: number | null
          points_against?: number | null
          points_for?: number | null
          rank?: number | null
          season: number
          team_name?: string | null
          ties?: number | null
          wins?: number | null
        }
        Update: {
          league_id?: string
          losses?: number | null
          made_playoffs?: boolean | null
          member_id?: string
          playoff_finish?: number | null
          points_against?: number | null
          points_for?: number | null
          rank?: number | null
          season?: number
          team_name?: string | null
          ties?: number | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "league_season_teams_league_id_season_fkey"
            columns: ["league_id", "season"]
            isOneToOne: false
            referencedRelation: "league_history_handback"
            referencedColumns: ["league_id", "season"]
          },
          {
            foreignKeyName: "league_season_teams_league_id_season_fkey"
            columns: ["league_id", "season"]
            isOneToOne: false
            referencedRelation: "league_season_results"
            referencedColumns: ["league_id", "season"]
          },
          {
            foreignKeyName: "league_season_teams_league_id_season_fkey"
            columns: ["league_id", "season"]
            isOneToOne: false
            referencedRelation: "league_seasons"
            referencedColumns: ["league_id", "season"]
          },
          {
            foreignKeyName: "league_season_teams_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "league_member_honours"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "league_season_teams_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "league_members"
            referencedColumns: ["id"]
          },
        ]
      }
      league_seasons: {
        Row: {
          champion_member_id: string | null
          external_league_id: string | null
          imported_at: string
          imported_by: string | null
          league_id: string
          note: string | null
          platform: string
          regular_winner_id: string | null
          runner_up_member_id: string | null
          season: number
          team_count: number | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          champion_member_id?: string | null
          external_league_id?: string | null
          imported_at?: string
          imported_by?: string | null
          league_id: string
          note?: string | null
          platform?: string
          regular_winner_id?: string | null
          runner_up_member_id?: string | null
          season: number
          team_count?: number | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          champion_member_id?: string | null
          external_league_id?: string | null
          imported_at?: string
          imported_by?: string | null
          league_id?: string
          note?: string | null
          platform?: string
          regular_winner_id?: string | null
          runner_up_member_id?: string | null
          season?: number
          team_count?: number | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_seasons_champion_member_id_fkey"
            columns: ["champion_member_id"]
            isOneToOne: false
            referencedRelation: "league_member_honours"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "league_seasons_champion_member_id_fkey"
            columns: ["champion_member_id"]
            isOneToOne: false
            referencedRelation: "league_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_seasons_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_seasons_regular_winner_id_fkey"
            columns: ["regular_winner_id"]
            isOneToOne: false
            referencedRelation: "league_member_honours"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "league_seasons_regular_winner_id_fkey"
            columns: ["regular_winner_id"]
            isOneToOne: false
            referencedRelation: "league_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_seasons_runner_up_member_id_fkey"
            columns: ["runner_up_member_id"]
            isOneToOne: false
            referencedRelation: "league_member_honours"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "league_seasons_runner_up_member_id_fkey"
            columns: ["runner_up_member_id"]
            isOneToOne: false
            referencedRelation: "league_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_seasons_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          allow_trades_during_games: boolean | null
          commissioner_id: string
          created_at: string
          draft_event_counter: number
          draft_generation: number
          draft_rounds: number
          draft_shadow_mode: boolean
          draft_state: string
          draft_status: Database["public"]["Enums"]["draft_status"]
          feature_flags: Json
          id: string
          join_code: string
          league_size: number | null
          name: string
          pick_deadline: string | null
          pool_status: string | null
          pool_winner_declared_at: string | null
          pool_winner_id: string | null
          roster_size: number
          roster_slots: Json | null
          scheduled_draft_time: string | null
          scoring_settings: Json | null
          settings: Json | null
          trade_review_period_hours: number | null
          trade_review_type: string | null
          trade_veto_threshold: number | null
          updated_at: string
          waiver_game_lock: boolean | null
          waiver_period_hours: number | null
          waiver_process_time: string | null
          waiver_type: string | null
        }
        Insert: {
          allow_trades_during_games?: boolean | null
          commissioner_id: string
          created_at?: string
          draft_event_counter?: number
          draft_generation?: number
          draft_rounds?: number
          draft_shadow_mode?: boolean
          draft_state?: string
          draft_status?: Database["public"]["Enums"]["draft_status"]
          feature_flags?: Json
          id?: string
          join_code?: string
          league_size?: number | null
          name: string
          pick_deadline?: string | null
          pool_status?: string | null
          pool_winner_declared_at?: string | null
          pool_winner_id?: string | null
          roster_size?: number
          roster_slots?: Json | null
          scheduled_draft_time?: string | null
          scoring_settings?: Json | null
          settings?: Json | null
          trade_review_period_hours?: number | null
          trade_review_type?: string | null
          trade_veto_threshold?: number | null
          updated_at?: string
          waiver_game_lock?: boolean | null
          waiver_period_hours?: number | null
          waiver_process_time?: string | null
          waiver_type?: string | null
        }
        Update: {
          allow_trades_during_games?: boolean | null
          commissioner_id?: string
          created_at?: string
          draft_event_counter?: number
          draft_generation?: number
          draft_rounds?: number
          draft_shadow_mode?: boolean
          draft_state?: string
          draft_status?: Database["public"]["Enums"]["draft_status"]
          feature_flags?: Json
          id?: string
          join_code?: string
          league_size?: number | null
          name?: string
          pick_deadline?: string | null
          pool_status?: string | null
          pool_winner_declared_at?: string | null
          pool_winner_id?: string | null
          roster_size?: number
          roster_slots?: Json | null
          scheduled_draft_time?: string | null
          scoring_settings?: Json | null
          settings?: Json | null
          trade_review_period_hours?: number | null
          trade_review_type?: string | null
          trade_veto_threshold?: number | null
          updated_at?: string
          waiver_game_lock?: boolean | null
          waiver_period_hours?: number | null
          waiver_process_time?: string | null
          waiver_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leagues_commissioner_id_fkey"
            columns: ["commissioner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matchup_scoring_snapshots: {
        Row: {
          created_at: string
          league_id: string
          matchup_id: string
          rules: Json
        }
        Insert: {
          created_at?: string
          league_id: string
          matchup_id: string
          rules?: Json
        }
        Update: {
          created_at?: string
          league_id?: string
          matchup_id?: string
          rules?: Json
        }
        Relationships: [
          {
            foreignKeyName: "matchup_scoring_snapshots_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchup_scoring_snapshots_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: true
            referencedRelation: "matchups"
            referencedColumns: ["id"]
          },
        ]
      }
      matchups: {
        Row: {
          created_at: string
          id: string
          league_id: string
          status: Database["public"]["Enums"]["matchup_status"]
          team1_id: string
          team1_score: number
          team2_id: string | null
          team2_score: number
          updated_at: string
          week_end_date: string
          week_number: number
          week_start_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          status?: Database["public"]["Enums"]["matchup_status"]
          team1_id: string
          team1_score?: number
          team2_id?: string | null
          team2_score?: number
          updated_at?: string
          week_end_date: string
          week_number: number
          week_start_date: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          status?: Database["public"]["Enums"]["matchup_status"]
          team1_id?: string
          team1_score?: number
          team2_id?: string | null
          team2_score?: number
          updated_at?: string
          week_end_date?: string
          week_number?: number
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "matchups_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_team1_id_fkey"
            columns: ["team1_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchups_team2_id_fkey"
            columns: ["team2_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      nhl_game_arena: {
        Row: {
          game_id: number
          home_team: number
          season: number
        }
        Insert: {
          game_id: number
          home_team: number
          season: number
        }
        Update: {
          game_id?: number
          home_team?: number
          season?: number
        }
        Relationships: []
      }
      nhl_games: {
        Row: {
          away_score: number | null
          away_team: string
          away_team_id: number | null
          created_at: string
          game_date: string
          game_id: number
          game_time: string | null
          game_type: string | null
          home_score: number | null
          home_team: string
          home_team_id: number | null
          id: string
          implied_win_probability_away: number | null
          implied_win_probability_home: number | null
          moneyline_away: number | null
          moneyline_home: number | null
          period: string | null
          period_time: string | null
          playoff_round: number | null
          season: number
          series_game_number: number | null
          series_id: string | null
          status: string | null
          updated_at: string
          venue: string | null
        }
        Insert: {
          away_score?: number | null
          away_team: string
          away_team_id?: number | null
          created_at?: string
          game_date: string
          game_id: number
          game_time?: string | null
          game_type?: string | null
          home_score?: number | null
          home_team: string
          home_team_id?: number | null
          id?: string
          implied_win_probability_away?: number | null
          implied_win_probability_home?: number | null
          moneyline_away?: number | null
          moneyline_home?: number | null
          period?: string | null
          period_time?: string | null
          playoff_round?: number | null
          season: number
          series_game_number?: number | null
          series_id?: string | null
          status?: string | null
          updated_at?: string
          venue?: string | null
        }
        Update: {
          away_score?: number | null
          away_team?: string
          away_team_id?: number | null
          created_at?: string
          game_date?: string
          game_id?: number
          game_time?: string | null
          game_type?: string | null
          home_score?: number | null
          home_team?: string
          home_team_id?: number | null
          id?: string
          implied_win_probability_away?: number | null
          implied_win_probability_home?: number | null
          moneyline_away?: number | null
          moneyline_home?: number | null
          period?: string | null
          period_time?: string | null
          playoff_round?: number | null
          season?: number
          series_game_number?: number | null
          series_id?: string | null
          status?: string | null
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nhl_games_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "nhl_games_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      nhl_games_retired_phantoms: {
        Row: {
          away_score: number | null
          away_team: string
          away_team_id: number | null
          created_at: string
          game_date: string
          game_id: number
          game_time: string | null
          game_type: string | null
          home_score: number | null
          home_team: string
          home_team_id: number | null
          id: string
          implied_win_probability_away: number | null
          implied_win_probability_home: number | null
          moneyline_away: number | null
          moneyline_home: number | null
          period: string | null
          period_time: string | null
          playoff_round: number | null
          season: number
          series_game_number: number | null
          series_id: string | null
          status: string | null
          updated_at: string
          venue: string | null
        }
        Insert: {
          away_score?: number | null
          away_team: string
          away_team_id?: number | null
          created_at?: string
          game_date: string
          game_id: number
          game_time?: string | null
          game_type?: string | null
          home_score?: number | null
          home_team: string
          home_team_id?: number | null
          id?: string
          implied_win_probability_away?: number | null
          implied_win_probability_home?: number | null
          moneyline_away?: number | null
          moneyline_home?: number | null
          period?: string | null
          period_time?: string | null
          playoff_round?: number | null
          season: number
          series_game_number?: number | null
          series_id?: string | null
          status?: string | null
          updated_at?: string
          venue?: string | null
        }
        Update: {
          away_score?: number | null
          away_team?: string
          away_team_id?: number | null
          created_at?: string
          game_date?: string
          game_id?: number
          game_time?: string | null
          game_type?: string | null
          home_score?: number | null
          home_team?: string
          home_team_id?: number | null
          id?: string
          implied_win_probability_away?: number | null
          implied_win_probability_home?: number | null
          moneyline_away?: number | null
          moneyline_home?: number | null
          period?: string | null
          period_time?: string | null
          playoff_round?: number | null
          season?: number
          series_game_number?: number | null
          series_id?: string | null
          status?: string | null
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
      }
      nhl_pipeline_meta: {
        Row: {
          key: string
          last_refresh: string
        }
        Insert: {
          key: string
          last_refresh?: string
        }
        Update: {
          key?: string
          last_refresh?: string
        }
        Relationships: []
      }
      nhl_player_identity: {
        Row: {
          first_name: string | null
          first_season: number
          full_name: string
          games_played: number
          headshot_url: string | null
          is_goalie: boolean
          last_name: string | null
          last_season: number
          last_sweater: number | null
          last_team: string | null
          player_id: number
          position_code: string | null
          primary_position: string | null
          seasons_played: number
          short_name: string | null
          teams: string[]
          updated_at: string
        }
        Insert: {
          first_name?: string | null
          first_season: number
          full_name: string
          games_played: number
          headshot_url?: string | null
          is_goalie: boolean
          last_name?: string | null
          last_season: number
          last_sweater?: number | null
          last_team?: string | null
          player_id: number
          position_code?: string | null
          primary_position?: string | null
          seasons_played: number
          short_name?: string | null
          teams: string[]
          updated_at?: string
        }
        Update: {
          first_name?: string | null
          first_season?: number
          full_name?: string
          games_played?: number
          headshot_url?: string | null
          is_goalie?: boolean
          last_name?: string | null
          last_season?: number
          last_sweater?: number | null
          last_team?: string | null
          player_id?: number
          position_code?: string | null
          primary_position?: string | null
          seasons_played?: number
          short_name?: string | null
          teams?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      nhl_player_names: {
        Row: {
          first_name: string | null
          headshot_url: string | null
          last_name: string | null
          last_seen_season: number | null
          player_id: number
          position_code: string | null
          updated_at: string
        }
        Insert: {
          first_name?: string | null
          headshot_url?: string | null
          last_name?: string | null
          last_seen_season?: number | null
          player_id: number
          position_code?: string | null
          updated_at?: string
        }
        Update: {
          first_name?: string | null
          headshot_url?: string | null
          last_name?: string | null
          last_seen_season?: number | null
          player_id?: number
          position_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nhl_playoff_seeds: {
        Row: {
          conference: string
          created_at: string | null
          division: string
          id: string
          losses: number | null
          ot_losses: number | null
          points: number | null
          row_wins: number | null
          season: number
          seed: number
          team_abbrev: string | null
          team_id: number
          wins: number | null
        }
        Insert: {
          conference: string
          created_at?: string | null
          division: string
          id?: string
          losses?: number | null
          ot_losses?: number | null
          points?: number | null
          row_wins?: number | null
          season: number
          seed: number
          team_abbrev?: string | null
          team_id: number
          wins?: number | null
        }
        Update: {
          conference?: string
          created_at?: string | null
          division?: string
          id?: string
          losses?: number | null
          ot_losses?: number | null
          points?: number | null
          row_wins?: number | null
          season?: number
          seed?: number
          team_abbrev?: string | null
          team_id?: number
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nhl_playoff_seeds_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      nhl_playoff_series: {
        Row: {
          bracket_slot: number
          conference: string | null
          games_played: number
          high_seed_team_id: number | null
          high_seed_wins: number
          low_seed_team_id: number | null
          low_seed_wins: number
          parent_slot_a: number | null
          parent_slot_b: number | null
          round: number
          season: number
          series_id: string
          series_status: string
          starts_at: string | null
          updated_at: string | null
          winner_team_id: number | null
        }
        Insert: {
          bracket_slot: number
          conference?: string | null
          games_played?: number
          high_seed_team_id?: number | null
          high_seed_wins?: number
          low_seed_team_id?: number | null
          low_seed_wins?: number
          parent_slot_a?: number | null
          parent_slot_b?: number | null
          round: number
          season: number
          series_id?: string
          series_status?: string
          starts_at?: string | null
          updated_at?: string | null
          winner_team_id?: number | null
        }
        Update: {
          bracket_slot?: number
          conference?: string | null
          games_played?: number
          high_seed_team_id?: number | null
          high_seed_wins?: number
          low_seed_team_id?: number | null
          low_seed_wins?: number
          parent_slot_a?: number | null
          parent_slot_b?: number | null
          round?: number
          season?: number
          series_id?: string
          series_status?: string
          starts_at?: string | null
          updated_at?: string | null
          winner_team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nhl_playoff_series_high_seed_team_id_fkey"
            columns: ["high_seed_team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "nhl_playoff_series_low_seed_team_id_fkey"
            columns: ["low_seed_team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "nhl_playoff_series_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      nhl_rink_cdf: {
        Row: {
          cdf_mid: number
          coord: string
          home_team: number
          n_group: number
          season: number
          v: number
        }
        Insert: {
          cdf_mid: number
          coord: string
          home_team: number
          n_group: number
          season: number
          v: number
        }
        Update: {
          cdf_mid?: number
          coord?: string
          home_team?: number
          n_group?: number
          season?: number
          v?: number
        }
        Relationships: []
      }
      nhl_rink_ref_knots: {
        Row: {
          coord: string
          k: number
          v: number
        }
        Insert: {
          coord: string
          k: number
          v: number
        }
        Update: {
          coord?: string
          k?: number
          v?: number
        }
        Relationships: []
      }
      nhl_shots: {
        Row: {
          angle: number | null
          angle_adj: number | null
          assist1_id: number | null
          assist2_id: number | null
          created_at: string
          distance: number | null
          distance_adj: number | null
          distance_from_prev: number | null
          event_id: number
          event_type: string
          game_date: string | null
          game_id: number
          game_type: string
          goalie_id: number | null
          is_empty_net: boolean | null
          is_goal: boolean
          is_home: boolean | null
          is_penalty_shot: boolean
          is_power_play: boolean | null
          is_rebound: boolean | null
          is_rush: boolean | null
          is_shorthanded: boolean | null
          opp_goalie: number | null
          opp_skaters: number | null
          own_goalie: number | null
          own_skaters: number | null
          period: number | null
          period_type: string | null
          prev_event_type: string | null
          prev_x: number | null
          prev_y: number | null
          score_diff: number | null
          season: number
          seconds_elapsed: number | null
          seconds_since_prev: number | null
          shooter_id: number | null
          shot_type: string | null
          strength_source: string
          strength_state: string | null
          team_id: number | null
          x_adj: number | null
          x_norm: number | null
          x_raw: number | null
          xg_sql: number | null
          y_adj: number | null
          y_norm: number | null
          y_raw: number | null
        }
        Insert: {
          angle?: number | null
          angle_adj?: number | null
          assist1_id?: number | null
          assist2_id?: number | null
          created_at?: string
          distance?: number | null
          distance_adj?: number | null
          distance_from_prev?: number | null
          event_id: number
          event_type: string
          game_date?: string | null
          game_id: number
          game_type: string
          goalie_id?: number | null
          is_empty_net?: boolean | null
          is_goal: boolean
          is_home?: boolean | null
          is_penalty_shot?: boolean
          is_power_play?: boolean | null
          is_rebound?: boolean | null
          is_rush?: boolean | null
          is_shorthanded?: boolean | null
          opp_goalie?: number | null
          opp_skaters?: number | null
          own_goalie?: number | null
          own_skaters?: number | null
          period?: number | null
          period_type?: string | null
          prev_event_type?: string | null
          prev_x?: number | null
          prev_y?: number | null
          score_diff?: number | null
          season: number
          seconds_elapsed?: number | null
          seconds_since_prev?: number | null
          shooter_id?: number | null
          shot_type?: string | null
          strength_source?: string
          strength_state?: string | null
          team_id?: number | null
          x_adj?: number | null
          x_norm?: number | null
          x_raw?: number | null
          xg_sql?: number | null
          y_adj?: number | null
          y_norm?: number | null
          y_raw?: number | null
        }
        Update: {
          angle?: number | null
          angle_adj?: number | null
          assist1_id?: number | null
          assist2_id?: number | null
          created_at?: string
          distance?: number | null
          distance_adj?: number | null
          distance_from_prev?: number | null
          event_id?: number
          event_type?: string
          game_date?: string | null
          game_id?: number
          game_type?: string
          goalie_id?: number | null
          is_empty_net?: boolean | null
          is_goal?: boolean
          is_home?: boolean | null
          is_penalty_shot?: boolean
          is_power_play?: boolean | null
          is_rebound?: boolean | null
          is_rush?: boolean | null
          is_shorthanded?: boolean | null
          opp_goalie?: number | null
          opp_skaters?: number | null
          own_goalie?: number | null
          own_skaters?: number | null
          period?: number | null
          period_type?: string | null
          prev_event_type?: string | null
          prev_x?: number | null
          prev_y?: number | null
          score_diff?: number | null
          season?: number
          seconds_elapsed?: number | null
          seconds_since_prev?: number | null
          shooter_id?: number | null
          shot_type?: string | null
          strength_source?: string
          strength_state?: string | null
          team_id?: number | null
          x_adj?: number | null
          x_norm?: number | null
          x_raw?: number | null
          xg_sql?: number | null
          y_adj?: number | null
          y_norm?: number | null
          y_raw?: number | null
        }
        Relationships: []
      }
      nhl_teams: {
        Row: {
          abbreviation: string
          city: string
          created_at: string
          name: string
          team_id: number
          updated_at: string
        }
        Insert: {
          abbreviation: string
          city: string
          created_at?: string
          name: string
          team_id: number
          updated_at?: string
        }
        Update: {
          abbreviation?: string
          city?: string
          created_at?: string
          name?: string
          team_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      nhl_xg_sql_cells: {
        Row: {
          ckey: string
          fold: number
          k: number
          lvl: number
          n: number
          rate: number
        }
        Insert: {
          ckey: string
          fold: number
          k: number
          lvl: number
          n: number
          rate: number
        }
        Update: {
          ckey?: string
          fold?: number
          k?: number
          lvl?: number
          n?: number
          rate?: number
        }
        Relationships: []
      }
      nightly_job_runs: {
        Row: {
          completed_at: string | null
          details: Json | null
          id: string
          job_name: string
          run_date: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          details?: Json | null
          id?: string
          job_name: string
          run_date?: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          details?: Json | null
          id?: string
          job_name?: string
          run_date?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          league_id: string
          message: string
          metadata: Json | null
          read_at: string | null
          read_status: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          message: string
          metadata?: Json | null
          read_at?: string | null
          read_status?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          message?: string
          metadata?: Json | null
          read_at?: string | null
          read_status?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_ci_runs: {
        Row: {
          created_at: string
          finished_at: string
          id: number
          job: string
          ref: string | null
          run_attempt: number
          run_id: number
          sha: string
          started_at: string | null
          status: string
          summary: string | null
          url: string | null
          workflow: string
        }
        Insert: {
          created_at?: string
          finished_at?: string
          id?: never
          job: string
          ref?: string | null
          run_attempt?: number
          run_id: number
          sha: string
          started_at?: string | null
          status: string
          summary?: string | null
          url?: string | null
          workflow: string
        }
        Update: {
          created_at?: string
          finished_at?: string
          id?: never
          job?: string
          ref?: string | null
          run_attempt?: number
          run_id?: number
          sha?: string
          started_at?: string | null
          status?: string
          summary?: string | null
          url?: string | null
          workflow?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json | null
          rows_ingested: number | null
          service_name: string
          started_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          rows_ingested?: number | null
          service_name: string
          started_at?: string
          status: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          rows_ingested?: number | null
          service_name?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      player_autopick_rankings: {
        Row: {
          id: string
          league_id: string | null
          player_id: number
          position_code: string | null
          rank_position: number
          team_id: string | null
          tier: number | null
          updated_at: string
        }
        Insert: {
          id?: string
          league_id?: string | null
          player_id: number
          position_code?: string | null
          rank_position: number
          team_id?: string | null
          tier?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string | null
          player_id?: number
          position_code?: string | null
          rank_position?: number
          team_id?: string | null
          tier?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_autopick_rankings_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_autopick_rankings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_directory: {
        Row: {
          bio_summary: string | null
          birthdate: string | null
          college_team: string | null
          created_at: string
          eligible_positions: string | null
          full_name: string
          headshot_url: string | null
          height_in: number | null
          is_goalie: boolean
          jersey_number: string | null
          nationality: string | null
          notes: string | null
          player_id: number
          position_code: string | null
          prior_team: string | null
          season: number
          shoots_catches: string | null
          source_last_fetched_at: string | null
          team_abbrev: string | null
          updated_at: string
          weight_lb: number | null
        }
        Insert: {
          bio_summary?: string | null
          birthdate?: string | null
          college_team?: string | null
          created_at?: string
          eligible_positions?: string | null
          full_name: string
          headshot_url?: string | null
          height_in?: number | null
          is_goalie?: boolean
          jersey_number?: string | null
          nationality?: string | null
          notes?: string | null
          player_id: number
          position_code?: string | null
          prior_team?: string | null
          season: number
          shoots_catches?: string | null
          source_last_fetched_at?: string | null
          team_abbrev?: string | null
          updated_at?: string
          weight_lb?: number | null
        }
        Update: {
          bio_summary?: string | null
          birthdate?: string | null
          college_team?: string | null
          created_at?: string
          eligible_positions?: string | null
          full_name?: string
          headshot_url?: string | null
          height_in?: number | null
          is_goalie?: boolean
          jersey_number?: string | null
          nationality?: string | null
          notes?: string | null
          player_id?: number
          position_code?: string | null
          prior_team?: string | null
          season?: number
          shoots_catches?: string | null
          source_last_fetched_at?: string | null
          team_abbrev?: string | null
          updated_at?: string
          weight_lb?: number | null
        }
        Relationships: []
      }
      player_game_stats: {
        Row: {
          blocks: number
          created_at: string
          game_date: string
          game_id: number
          goalie_gp: number
          goals: number
          goals_against: number
          hits: number
          icetime_seconds: number
          is_goalie: boolean
          nhl_assists: number
          nhl_blocks: number
          nhl_even_saves: number
          nhl_even_shots_against: number
          nhl_faceoff_losses: number
          nhl_faceoff_taken: number
          nhl_faceoff_wins: number
          nhl_giveaways: number
          nhl_goals: number
          nhl_goals_against: number
          nhl_gwg: number
          nhl_hits: number
          nhl_losses: number
          nhl_ot_losses: number
          nhl_otg: number
          nhl_pim: number
          nhl_plus_minus: number
          nhl_points: number
          nhl_pp_saves: number
          nhl_pp_shots_against: number
          nhl_ppa: number
          nhl_ppg: number
          nhl_ppp: number
          nhl_save_pct: number
          nhl_saves: number
          nhl_sh_saves: number
          nhl_sh_shots_against: number
          nhl_sha: number
          nhl_shg: number
          nhl_shifts: number
          nhl_shot_attempts: number
          nhl_shots_attempted: number
          nhl_shots_blocked: number
          nhl_shots_faced: number
          nhl_shots_missed: number
          nhl_shots_on_goal: number
          nhl_shp: number
          nhl_shutouts: number
          nhl_takeaways: number
          nhl_toi_seconds: number
          nhl_wins: number
          pim: number
          player_id: number
          plus_minus: number
          points: number
          position_code: string | null
          ppp: number
          primary_assists: number
          saves: number
          season: number
          secondary_assists: number
          shots_faced: number
          shots_on_goal: number
          shp: number
          shutouts: number
          team_abbrev: string | null
          updated_at: string
          wins: number
        }
        Insert: {
          blocks?: number
          created_at?: string
          game_date: string
          game_id: number
          goalie_gp?: number
          goals?: number
          goals_against?: number
          hits?: number
          icetime_seconds?: number
          is_goalie?: boolean
          nhl_assists?: number
          nhl_blocks?: number
          nhl_even_saves?: number
          nhl_even_shots_against?: number
          nhl_faceoff_losses?: number
          nhl_faceoff_taken?: number
          nhl_faceoff_wins?: number
          nhl_giveaways?: number
          nhl_goals?: number
          nhl_goals_against?: number
          nhl_gwg?: number
          nhl_hits?: number
          nhl_losses?: number
          nhl_ot_losses?: number
          nhl_otg?: number
          nhl_pim?: number
          nhl_plus_minus?: number
          nhl_points?: number
          nhl_pp_saves?: number
          nhl_pp_shots_against?: number
          nhl_ppa?: number
          nhl_ppg?: number
          nhl_ppp?: number
          nhl_save_pct?: number
          nhl_saves?: number
          nhl_sh_saves?: number
          nhl_sh_shots_against?: number
          nhl_sha?: number
          nhl_shg?: number
          nhl_shifts?: number
          nhl_shot_attempts?: number
          nhl_shots_attempted?: number
          nhl_shots_blocked?: number
          nhl_shots_faced?: number
          nhl_shots_missed?: number
          nhl_shots_on_goal?: number
          nhl_shp?: number
          nhl_shutouts?: number
          nhl_takeaways?: number
          nhl_toi_seconds?: number
          nhl_wins?: number
          pim?: number
          player_id: number
          plus_minus?: number
          points?: number
          position_code?: string | null
          ppp?: number
          primary_assists?: number
          saves?: number
          season: number
          secondary_assists?: number
          shots_faced?: number
          shots_on_goal?: number
          shp?: number
          shutouts?: number
          team_abbrev?: string | null
          updated_at?: string
          wins?: number
        }
        Update: {
          blocks?: number
          created_at?: string
          game_date?: string
          game_id?: number
          goalie_gp?: number
          goals?: number
          goals_against?: number
          hits?: number
          icetime_seconds?: number
          is_goalie?: boolean
          nhl_assists?: number
          nhl_blocks?: number
          nhl_even_saves?: number
          nhl_even_shots_against?: number
          nhl_faceoff_losses?: number
          nhl_faceoff_taken?: number
          nhl_faceoff_wins?: number
          nhl_giveaways?: number
          nhl_goals?: number
          nhl_goals_against?: number
          nhl_gwg?: number
          nhl_hits?: number
          nhl_losses?: number
          nhl_ot_losses?: number
          nhl_otg?: number
          nhl_pim?: number
          nhl_plus_minus?: number
          nhl_points?: number
          nhl_pp_saves?: number
          nhl_pp_shots_against?: number
          nhl_ppa?: number
          nhl_ppg?: number
          nhl_ppp?: number
          nhl_save_pct?: number
          nhl_saves?: number
          nhl_sh_saves?: number
          nhl_sh_shots_against?: number
          nhl_sha?: number
          nhl_shg?: number
          nhl_shifts?: number
          nhl_shot_attempts?: number
          nhl_shots_attempted?: number
          nhl_shots_blocked?: number
          nhl_shots_faced?: number
          nhl_shots_missed?: number
          nhl_shots_on_goal?: number
          nhl_shp?: number
          nhl_shutouts?: number
          nhl_takeaways?: number
          nhl_toi_seconds?: number
          nhl_wins?: number
          pim?: number
          player_id?: number
          plus_minus?: number
          points?: number
          position_code?: string | null
          ppp?: number
          primary_assists?: number
          saves?: number
          season?: number
          secondary_assists?: number
          shots_faced?: number
          shots_on_goal?: number
          shp?: number
          shutouts?: number
          team_abbrev?: string | null
          updated_at?: string
          wins?: number
        }
        Relationships: []
      }
      player_gar_components: {
        Row: {
          calculated_at: string | null
          evd_gar_per_60: number | null
          evd_rate_raw: number | null
          evd_rate_regressed: number | null
          evo_gar_per_60: number | null
          evo_rate_raw: number | null
          evo_rate_regressed: number | null
          goals_per_minor: number | null
          penalty_component_raw: number | null
          penalty_component_regressed: number | null
          penalty_gar_per_60: number | null
          player_id: number
          ppd_gar_per_60: number | null
          ppd_rate_raw: number | null
          ppd_rate_regressed: number | null
          ppo_gar_per_60: number | null
          ppo_rate_raw: number | null
          ppo_rate_regressed: number | null
          rp_evd_rate: number | null
          rp_evo_rate: number | null
          rp_penalty_rate: number | null
          rp_ppd_rate: number | null
          rp_ppo_rate: number | null
          season: number
          toi_5v5_minutes: number | null
          toi_pk_minutes: number | null
          toi_pp_minutes: number | null
          toi_total_minutes: number | null
          total_gar: number | null
          total_gar_per_60: number | null
          updated_at: string | null
        }
        Insert: {
          calculated_at?: string | null
          evd_gar_per_60?: number | null
          evd_rate_raw?: number | null
          evd_rate_regressed?: number | null
          evo_gar_per_60?: number | null
          evo_rate_raw?: number | null
          evo_rate_regressed?: number | null
          goals_per_minor?: number | null
          penalty_component_raw?: number | null
          penalty_component_regressed?: number | null
          penalty_gar_per_60?: number | null
          player_id: number
          ppd_gar_per_60?: number | null
          ppd_rate_raw?: number | null
          ppd_rate_regressed?: number | null
          ppo_gar_per_60?: number | null
          ppo_rate_raw?: number | null
          ppo_rate_regressed?: number | null
          rp_evd_rate?: number | null
          rp_evo_rate?: number | null
          rp_penalty_rate?: number | null
          rp_ppd_rate?: number | null
          rp_ppo_rate?: number | null
          season: number
          toi_5v5_minutes?: number | null
          toi_pk_minutes?: number | null
          toi_pp_minutes?: number | null
          toi_total_minutes?: number | null
          total_gar?: number | null
          total_gar_per_60?: number | null
          updated_at?: string | null
        }
        Update: {
          calculated_at?: string | null
          evd_gar_per_60?: number | null
          evd_rate_raw?: number | null
          evd_rate_regressed?: number | null
          evo_gar_per_60?: number | null
          evo_rate_raw?: number | null
          evo_rate_regressed?: number | null
          goals_per_minor?: number | null
          penalty_component_raw?: number | null
          penalty_component_regressed?: number | null
          penalty_gar_per_60?: number | null
          player_id?: number
          ppd_gar_per_60?: number | null
          ppd_rate_raw?: number | null
          ppd_rate_regressed?: number | null
          ppo_gar_per_60?: number | null
          ppo_rate_raw?: number | null
          ppo_rate_regressed?: number | null
          rp_evd_rate?: number | null
          rp_evo_rate?: number | null
          rp_penalty_rate?: number | null
          rp_ppd_rate?: number | null
          rp_ppo_rate?: number | null
          season?: number
          toi_5v5_minutes?: number | null
          toi_pk_minutes?: number | null
          toi_pp_minutes?: number | null
          toi_total_minutes?: number | null
          total_gar?: number | null
          total_gar_per_60?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      player_identity_bridge: {
        Row: {
          created_at: string
          full_name: string
          is_ambiguous: boolean
          match_method: string
          nhl_player_id: number | null
          players_uuid: string
        }
        Insert: {
          created_at?: string
          full_name: string
          is_ambiguous?: boolean
          match_method: string
          nhl_player_id?: number | null
          players_uuid: string
        }
        Update: {
          created_at?: string
          full_name?: string
          is_ambiguous?: boolean
          match_method?: string
          nhl_player_id?: number | null
          players_uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_identity_bridge_players_uuid_fkey"
            columns: ["players_uuid"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_onice_xg: {
        Row: {
          built_at: string
          ca: number
          cf: number
          ga: number
          game_id: number
          gf: number
          player_id: number
          season: number
          state: string
          team_id: number | null
          xga: number
          xga_flurry: number
          xgf: number
          xgf_flurry: number
        }
        Insert: {
          built_at?: string
          ca?: number
          cf?: number
          ga?: number
          game_id: number
          gf?: number
          player_id: number
          season: number
          state: string
          team_id?: number | null
          xga?: number
          xga_flurry?: number
          xgf?: number
          xgf_flurry?: number
        }
        Update: {
          built_at?: string
          ca?: number
          cf?: number
          ga?: number
          game_id?: number
          gf?: number
          player_id?: number
          season?: number
          state?: string
          team_id?: number | null
          xga?: number
          xga_flurry?: number
          xgf?: number
          xgf_flurry?: number
        }
        Relationships: []
      }
      player_penalty_events: {
        Row: {
          committed_by: number | null
          desc_key: string | null
          drawn_by: number | null
          duration_min: number | null
          event_id: number
          game_id: number
          period: number
          period_s: number
          season: number
          team_id: number | null
          type_code: string | null
        }
        Insert: {
          committed_by?: number | null
          desc_key?: string | null
          drawn_by?: number | null
          duration_min?: number | null
          event_id: number
          game_id: number
          period: number
          period_s: number
          season: number
          team_id?: number | null
          type_code?: string | null
        }
        Update: {
          committed_by?: number | null
          desc_key?: string | null
          drawn_by?: number | null
          duration_min?: number | null
          event_id?: number
          game_id?: number
          period?: number
          period_s?: number
          season?: number
          team_id?: number | null
          type_code?: string | null
        }
        Relationships: []
      }
      player_playoff_stats: {
        Row: {
          assists: number | null
          blocks: number | null
          games_played: number | null
          goals: number | null
          goals_against: number | null
          hits: number | null
          is_goalie: boolean | null
          last_game_id: number | null
          pim: number | null
          player_id: number
          plus_minus: number | null
          points: number | null
          ppp: number | null
          saves: number | null
          season: number
          shots: number | null
          shp: number | null
          shutouts: number | null
          team_abbrev: string | null
          updated_at: string | null
          wins: number | null
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          games_played?: number | null
          goals?: number | null
          goals_against?: number | null
          hits?: number | null
          is_goalie?: boolean | null
          last_game_id?: number | null
          pim?: number | null
          player_id: number
          plus_minus?: number | null
          points?: number | null
          ppp?: number | null
          saves?: number | null
          season: number
          shots?: number | null
          shp?: number | null
          shutouts?: number | null
          team_abbrev?: string | null
          updated_at?: string | null
          wins?: number | null
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          games_played?: number | null
          goals?: number | null
          goals_against?: number | null
          hits?: number | null
          is_goalie?: boolean | null
          last_game_id?: number | null
          pim?: number | null
          player_id?: number
          plus_minus?: number | null
          points?: number | null
          ppp?: number | null
          saves?: number | null
          season?: number
          shots?: number | null
          shp?: number | null
          shutouts?: number | null
          team_abbrev?: string | null
          updated_at?: string | null
          wins?: number | null
        }
        Relationships: []
      }
      player_projected_stats: {
        Row: {
          b2b_penalty: number | null
          base_ppg: number | null
          calculation_method: string | null
          confidence_label: string | null
          confidence_score: number | null
          created_at: string
          dynamic_confidence: number | null
          finishing_multiplier: number | null
          floor_probability: number | null
          game_id: number
          game_start_time: string | null
          home_away_adjustment: number | null
          injury_status: string | null
          is_goalie: boolean
          is_home_game: boolean | null
          likely_high: number | null
          likely_low: number | null
          matchup_difficulty: number | null
          opponent_abbrev: string | null
          opponent_adjustment: number | null
          opponent_team_id: number | null
          player_id: number
          projected_assists: number
          projected_blocks: number
          projected_gaa: number | null
          projected_goals: number
          projected_goals_against: number | null
          projected_gp: number | null
          projected_hits: number | null
          projected_pim: number | null
          projected_ppp: number | null
          projected_save_pct: number | null
          projected_saves: number | null
          projected_shp: number | null
          projected_shutouts: number | null
          projected_sog: number
          projected_vopa: number | null
          projected_wins: number | null
          projected_xg: number
          projection_ci_50_lower: number | null
          projection_ci_50_upper: number | null
          projection_ci_lower: number | null
          projection_ci_upper: number | null
          projection_date: string
          projection_id: string
          projection_mean: number | null
          projection_median: number | null
          projection_skewness: number | null
          projection_std_dev: number | null
          season: number
          shrinkage_weight: number | null
          starter_confirmed: boolean | null
          total_projected_points: number
          updated_at: string
          upside_probability: number | null
        }
        Insert: {
          b2b_penalty?: number | null
          base_ppg?: number | null
          calculation_method?: string | null
          confidence_label?: string | null
          confidence_score?: number | null
          created_at?: string
          dynamic_confidence?: number | null
          finishing_multiplier?: number | null
          floor_probability?: number | null
          game_id: number
          game_start_time?: string | null
          home_away_adjustment?: number | null
          injury_status?: string | null
          is_goalie?: boolean
          is_home_game?: boolean | null
          likely_high?: number | null
          likely_low?: number | null
          matchup_difficulty?: number | null
          opponent_abbrev?: string | null
          opponent_adjustment?: number | null
          opponent_team_id?: number | null
          player_id: number
          projected_assists?: number
          projected_blocks?: number
          projected_gaa?: number | null
          projected_goals?: number
          projected_goals_against?: number | null
          projected_gp?: number | null
          projected_hits?: number | null
          projected_pim?: number | null
          projected_ppp?: number | null
          projected_save_pct?: number | null
          projected_saves?: number | null
          projected_shp?: number | null
          projected_shutouts?: number | null
          projected_sog?: number
          projected_vopa?: number | null
          projected_wins?: number | null
          projected_xg?: number
          projection_ci_50_lower?: number | null
          projection_ci_50_upper?: number | null
          projection_ci_lower?: number | null
          projection_ci_upper?: number | null
          projection_date: string
          projection_id?: string
          projection_mean?: number | null
          projection_median?: number | null
          projection_skewness?: number | null
          projection_std_dev?: number | null
          season: number
          shrinkage_weight?: number | null
          starter_confirmed?: boolean | null
          total_projected_points?: number
          updated_at?: string
          upside_probability?: number | null
        }
        Update: {
          b2b_penalty?: number | null
          base_ppg?: number | null
          calculation_method?: string | null
          confidence_label?: string | null
          confidence_score?: number | null
          created_at?: string
          dynamic_confidence?: number | null
          finishing_multiplier?: number | null
          floor_probability?: number | null
          game_id?: number
          game_start_time?: string | null
          home_away_adjustment?: number | null
          injury_status?: string | null
          is_goalie?: boolean
          is_home_game?: boolean | null
          likely_high?: number | null
          likely_low?: number | null
          matchup_difficulty?: number | null
          opponent_abbrev?: string | null
          opponent_adjustment?: number | null
          opponent_team_id?: number | null
          player_id?: number
          projected_assists?: number
          projected_blocks?: number
          projected_gaa?: number | null
          projected_goals?: number
          projected_goals_against?: number | null
          projected_gp?: number | null
          projected_hits?: number | null
          projected_pim?: number | null
          projected_ppp?: number | null
          projected_save_pct?: number | null
          projected_saves?: number | null
          projected_shp?: number | null
          projected_shutouts?: number | null
          projected_sog?: number
          projected_vopa?: number | null
          projected_wins?: number | null
          projected_xg?: number
          projection_ci_50_lower?: number | null
          projection_ci_50_upper?: number | null
          projection_ci_lower?: number | null
          projection_ci_upper?: number | null
          projection_date?: string
          projection_id?: string
          projection_mean?: number | null
          projection_median?: number | null
          projection_skewness?: number | null
          projection_std_dev?: number | null
          season?: number
          shrinkage_weight?: number | null
          starter_confirmed?: boolean | null
          total_projected_points?: number
          updated_at?: string
          upside_probability?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_projected_stats_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nhl_games"
            referencedColumns: ["game_id"]
          },
        ]
      }
      player_projections: {
        Row: {
          base_xg: number
          calculated_at: string
          final_projected_xg: number
          game_id: number
          goalie_factor: number
          gsax_adjusted_xg: number
          gsax_factor_pct: number
          opponent_team_id: number | null
          player_id: number
          qoc_adjusted_xg: number
          qoc_factor_pct: number
          season: number
          updated_at: string
        }
        Insert: {
          base_xg: number
          calculated_at?: string
          final_projected_xg: number
          game_id: number
          goalie_factor?: number
          gsax_adjusted_xg: number
          gsax_factor_pct?: number
          opponent_team_id?: number | null
          player_id: number
          qoc_adjusted_xg: number
          qoc_factor_pct?: number
          season?: number
          updated_at?: string
        }
        Update: {
          base_xg?: number
          calculated_at?: string
          final_projected_xg?: number
          game_id?: number
          goalie_factor?: number
          gsax_adjusted_xg?: number
          gsax_factor_pct?: number
          opponent_team_id?: number | null
          player_id?: number
          qoc_adjusted_xg?: number
          qoc_factor_pct?: number
          season?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_player_projections_game"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nhl_games"
            referencedColumns: ["game_id"]
          },
        ]
      }
      player_ros_projections: {
        Row: {
          avg_assists_per_game: number | null
          avg_goals_per_game: number | null
          avg_points_per_game: number | null
          created_at: string
          games_played: number | null
          games_remaining: number | null
          is_goalie: boolean | null
          player_id: number
          player_name: string | null
          playoff_games: number | null
          playoff_week_projection: number | null
          position: string | null
          projected_assists: number | null
          projected_blocks: number | null
          projected_ga_ros: number | null
          projected_goals: number | null
          projected_hits: number | null
          projected_pim: number | null
          projected_ppp: number | null
          projected_saves_ros: number | null
          projected_shp: number | null
          projected_shutouts_ros: number | null
          projected_sog: number | null
          projected_wins_ros: number | null
          season: number
          team_abbrev: string | null
          total_projected_points: number | null
          updated_at: string
        }
        Insert: {
          avg_assists_per_game?: number | null
          avg_goals_per_game?: number | null
          avg_points_per_game?: number | null
          created_at?: string
          games_played?: number | null
          games_remaining?: number | null
          is_goalie?: boolean | null
          player_id: number
          player_name?: string | null
          playoff_games?: number | null
          playoff_week_projection?: number | null
          position?: string | null
          projected_assists?: number | null
          projected_blocks?: number | null
          projected_ga_ros?: number | null
          projected_goals?: number | null
          projected_hits?: number | null
          projected_pim?: number | null
          projected_ppp?: number | null
          projected_saves_ros?: number | null
          projected_shp?: number | null
          projected_shutouts_ros?: number | null
          projected_sog?: number | null
          projected_wins_ros?: number | null
          season: number
          team_abbrev?: string | null
          total_projected_points?: number | null
          updated_at?: string
        }
        Update: {
          avg_assists_per_game?: number | null
          avg_goals_per_game?: number | null
          avg_points_per_game?: number | null
          created_at?: string
          games_played?: number | null
          games_remaining?: number | null
          is_goalie?: boolean | null
          player_id?: number
          player_name?: string | null
          playoff_games?: number | null
          playoff_week_projection?: number | null
          position?: string | null
          projected_assists?: number | null
          projected_blocks?: number | null
          projected_ga_ros?: number | null
          projected_goals?: number | null
          projected_hits?: number | null
          projected_pim?: number | null
          projected_ppp?: number | null
          projected_saves_ros?: number | null
          projected_shp?: number | null
          projected_shutouts_ros?: number | null
          projected_sog?: number | null
          projected_wins_ros?: number | null
          season?: number
          team_abbrev?: string | null
          total_projected_points?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      player_season_stats: {
        Row: {
          blocks: number
          created_at: string
          games_played: number
          goalie_gp: number
          goals: number
          goals_against: number
          hits: number
          icetime_seconds: number
          is_goalie: boolean
          nhl_assists: number
          nhl_blocks: number
          nhl_gaa: number | null
          nhl_goals: number
          nhl_goals_against: number
          nhl_hits: number
          nhl_losses: number
          nhl_ot_losses: number
          nhl_pim: number
          nhl_plus_minus: number
          nhl_points: number
          nhl_ppp: number
          nhl_save_pct: number | null
          nhl_saves: number
          nhl_shots_faced: number
          nhl_shots_on_goal: number
          nhl_shp: number
          nhl_shutouts: number
          nhl_toi_seconds: number
          nhl_wins: number
          pim: number
          player_id: number
          plus_minus: number
          points: number
          position_code: string | null
          ppp: number
          primary_assists: number
          save_pct: number | null
          saves: number
          season: number
          secondary_assists: number
          shots_faced: number
          shots_on_goal: number
          shp: number
          shutouts: number
          team_abbrev: string | null
          updated_at: string
          wins: number
          x_assists: number
          x_goals: number
        }
        Insert: {
          blocks?: number
          created_at?: string
          games_played?: number
          goalie_gp?: number
          goals?: number
          goals_against?: number
          hits?: number
          icetime_seconds?: number
          is_goalie?: boolean
          nhl_assists?: number
          nhl_blocks?: number
          nhl_gaa?: number | null
          nhl_goals?: number
          nhl_goals_against?: number
          nhl_hits?: number
          nhl_losses?: number
          nhl_ot_losses?: number
          nhl_pim?: number
          nhl_plus_minus?: number
          nhl_points?: number
          nhl_ppp?: number
          nhl_save_pct?: number | null
          nhl_saves?: number
          nhl_shots_faced?: number
          nhl_shots_on_goal?: number
          nhl_shp?: number
          nhl_shutouts?: number
          nhl_toi_seconds?: number
          nhl_wins?: number
          pim?: number
          player_id: number
          plus_minus?: number
          points?: number
          position_code?: string | null
          ppp?: number
          primary_assists?: number
          save_pct?: number | null
          saves?: number
          season: number
          secondary_assists?: number
          shots_faced?: number
          shots_on_goal?: number
          shp?: number
          shutouts?: number
          team_abbrev?: string | null
          updated_at?: string
          wins?: number
          x_assists?: number
          x_goals?: number
        }
        Update: {
          blocks?: number
          created_at?: string
          games_played?: number
          goalie_gp?: number
          goals?: number
          goals_against?: number
          hits?: number
          icetime_seconds?: number
          is_goalie?: boolean
          nhl_assists?: number
          nhl_blocks?: number
          nhl_gaa?: number | null
          nhl_goals?: number
          nhl_goals_against?: number
          nhl_hits?: number
          nhl_losses?: number
          nhl_ot_losses?: number
          nhl_pim?: number
          nhl_plus_minus?: number
          nhl_points?: number
          nhl_ppp?: number
          nhl_save_pct?: number | null
          nhl_saves?: number
          nhl_shots_faced?: number
          nhl_shots_on_goal?: number
          nhl_shp?: number
          nhl_shutouts?: number
          nhl_toi_seconds?: number
          nhl_wins?: number
          pim?: number
          player_id?: number
          plus_minus?: number
          points?: number
          position_code?: string | null
          ppp?: number
          primary_assists?: number
          save_pct?: number | null
          saves?: number
          season?: number
          secondary_assists?: number
          shots_faced?: number
          shots_on_goal?: number
          shp?: number
          shutouts?: number
          team_abbrev?: string | null
          updated_at?: string
          wins?: number
          x_assists?: number
          x_goals?: number
        }
        Relationships: []
      }
      player_shifts_official: {
        Row: {
          created_at: string
          duration: string | null
          duration_seconds: number | null
          end_time: string | null
          game_id: number
          period: number
          player_id: number
          shift_end_time_seconds: number
          shift_id: number
          shift_number: number
          shift_start_time_seconds: number
          start_time: string | null
          team_abbrev: string | null
          team_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration?: string | null
          duration_seconds?: number | null
          end_time?: string | null
          game_id: number
          period: number
          player_id: number
          shift_end_time_seconds?: number
          shift_id: number
          shift_number: number
          shift_start_time_seconds?: number
          start_time?: string | null
          team_abbrev?: string | null
          team_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration?: string | null
          duration_seconds?: number | null
          end_time?: string | null
          game_id?: number
          period?: number
          player_id?: number
          shift_end_time_seconds?: number
          shift_id?: number
          shift_number?: number
          shift_start_time_seconds?: number
          start_time?: string | null
          team_abbrev?: string | null
          team_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      player_talent_metrics: {
        Row: {
          avg_toi_per_game: number | null
          calculated_at: string
          created_at: string
          gp_last_10: number | null
          is_ir_eligible: boolean | null
          is_likely_to_play: boolean | null
          last_updated: string | null
          player_id: number
          positional_replacement_level: number | null
          positional_std_dev: number | null
          ros_projection_xg: number | null
          roster_status: string | null
          roster_status_source: string | null
          roster_status_updated_at: string | null
          season: number
          talent_adjusted_xg_per_60: number | null
          updated_at: string
          vopa_calculation_date: string | null
          vopa_score: number | null
          xg_per_60: number | null
          xg_rating: string | null
        }
        Insert: {
          avg_toi_per_game?: number | null
          calculated_at?: string
          created_at?: string
          gp_last_10?: number | null
          is_ir_eligible?: boolean | null
          is_likely_to_play?: boolean | null
          last_updated?: string | null
          player_id: number
          positional_replacement_level?: number | null
          positional_std_dev?: number | null
          ros_projection_xg?: number | null
          roster_status?: string | null
          roster_status_source?: string | null
          roster_status_updated_at?: string | null
          season?: number
          talent_adjusted_xg_per_60?: number | null
          updated_at?: string
          vopa_calculation_date?: string | null
          vopa_score?: number | null
          xg_per_60?: number | null
          xg_rating?: string | null
        }
        Update: {
          avg_toi_per_game?: number | null
          calculated_at?: string
          created_at?: string
          gp_last_10?: number | null
          is_ir_eligible?: boolean | null
          is_likely_to_play?: boolean | null
          last_updated?: string | null
          player_id?: number
          positional_replacement_level?: number | null
          positional_std_dev?: number | null
          ros_projection_xg?: number | null
          roster_status?: string | null
          roster_status_source?: string | null
          roster_status_updated_at?: string | null
          season?: number
          talent_adjusted_xg_per_60?: number | null
          updated_at?: string
          vopa_calculation_date?: string | null
          vopa_score?: number | null
          xg_per_60?: number | null
          xg_rating?: string | null
        }
        Relationships: []
      }
      player_toi_by_state: {
        Row: {
          built_at: string
          game_id: number
          player_id: number
          season: number
          state: string
          team_id: number | null
          toi_seconds: number
        }
        Insert: {
          built_at?: string
          game_id: number
          player_id: number
          season: number
          state: string
          team_id?: number | null
          toi_seconds: number
        }
        Update: {
          built_at?: string
          game_id?: number
          player_id?: number
          season?: number
          state?: string
          team_id?: number | null
          toi_seconds?: number
        }
        Relationships: []
      }
      player_transactions: {
        Row: {
          created_at: string
          id: string
          league_id: string
          player_id: number
          player_name: string | null
          player_position: string | null
          player_team: string | null
          source: string | null
          team_id: string
          transaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          player_id: number
          player_name?: string | null
          player_position?: string | null
          player_team?: string | null
          source?: string | null
          team_id: string
          transaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          player_id?: number
          player_name?: string | null
          player_position?: string | null
          player_team?: string | null
          source?: string | null
          team_id?: string
          transaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_transactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_waiver_status: {
        Row: {
          cleared_at: string | null
          dropped_at: string
          dropped_by_team_id: string | null
          id: string
          league_id: string
          player_id: number
        }
        Insert: {
          cleared_at?: string | null
          dropped_at?: string
          dropped_by_team_id?: string | null
          id?: string
          league_id: string
          player_id: number
        }
        Update: {
          cleared_at?: string | null
          dropped_at?: string
          dropped_by_team_id?: string | null
          id?: string
          league_id?: string
          player_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_waiver_status_dropped_by_team_id_fkey"
            columns: ["dropped_by_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_waiver_status_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      player_weekly_stats: {
        Row: {
          assists: number | null
          blocks: number | null
          created_at: string | null
          games_played: number | null
          goalie_gp: number | null
          goals: number | null
          goals_against: number | null
          hits: number | null
          id: number
          nhl_assists: number
          nhl_blocks: number
          nhl_goals: number
          nhl_goals_against: number
          nhl_hits: number
          nhl_losses: number
          nhl_ot_losses: number
          nhl_pim: number
          nhl_plus_minus: number
          nhl_points: number
          nhl_ppp: number
          nhl_saves: number
          nhl_shots_faced: number
          nhl_shots_on_goal: number
          nhl_shp: number
          nhl_shutouts: number
          nhl_wins: number
          pim: number | null
          player_id: number
          plus_minus: number | null
          points: number | null
          ppp: number | null
          primary_assists: number | null
          saves: number | null
          secondary_assists: number | null
          shots_faced: number | null
          shots_on_goal: number | null
          shp: number | null
          shutouts: number | null
          updated_at: string | null
          week_end_date: string
          week_number: number
          week_start_date: string
          wins: number | null
          x_goals: number | null
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          created_at?: string | null
          games_played?: number | null
          goalie_gp?: number | null
          goals?: number | null
          goals_against?: number | null
          hits?: number | null
          id?: number
          nhl_assists?: number
          nhl_blocks?: number
          nhl_goals?: number
          nhl_goals_against?: number
          nhl_hits?: number
          nhl_losses?: number
          nhl_ot_losses?: number
          nhl_pim?: number
          nhl_plus_minus?: number
          nhl_points?: number
          nhl_ppp?: number
          nhl_saves?: number
          nhl_shots_faced?: number
          nhl_shots_on_goal?: number
          nhl_shp?: number
          nhl_shutouts?: number
          nhl_wins?: number
          pim?: number | null
          player_id: number
          plus_minus?: number | null
          points?: number | null
          ppp?: number | null
          primary_assists?: number | null
          saves?: number | null
          secondary_assists?: number | null
          shots_faced?: number | null
          shots_on_goal?: number | null
          shp?: number | null
          shutouts?: number | null
          updated_at?: string | null
          week_end_date: string
          week_number: number
          week_start_date: string
          wins?: number | null
          x_goals?: number | null
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          created_at?: string | null
          games_played?: number | null
          goalie_gp?: number | null
          goals?: number | null
          goals_against?: number | null
          hits?: number | null
          id?: number
          nhl_assists?: number
          nhl_blocks?: number
          nhl_goals?: number
          nhl_goals_against?: number
          nhl_hits?: number
          nhl_losses?: number
          nhl_ot_losses?: number
          nhl_pim?: number
          nhl_plus_minus?: number
          nhl_points?: number
          nhl_ppp?: number
          nhl_saves?: number
          nhl_shots_faced?: number
          nhl_shots_on_goal?: number
          nhl_shp?: number
          nhl_shutouts?: number
          nhl_wins?: number
          pim?: number | null
          player_id?: number
          plus_minus?: number | null
          points?: number | null
          ppp?: number | null
          primary_assists?: number | null
          saves?: number | null
          secondary_assists?: number | null
          shots_faced?: number | null
          shots_on_goal?: number | null
          shp?: number | null
          shutouts?: number | null
          updated_at?: string | null
          week_end_date?: string
          week_number?: number
          week_start_date?: string
          wins?: number | null
          x_goals?: number | null
        }
        Relationships: []
      }
      player_xg_season: {
        Row: {
          avg_dist: number | null
          avg_xg_per_shot: number | null
          finishing: number
          game_type: string
          goals: number
          goals_en: number
          goals_ev: number
          goals_pp: number
          goals_sh: number
          player_id: number
          rebounds_shot: number
          rush_shots: number
          season: number
          shots: number
          shots_ev: number
          shots_pk: number
          shots_pp: number
          sog: number
          team_id: number
          updated_at: string
          xg: number
          xg_en: number
          xg_ev: number
          xg_pk: number
          xg_pp: number
        }
        Insert: {
          avg_dist?: number | null
          avg_xg_per_shot?: number | null
          finishing: number
          game_type: string
          goals: number
          goals_en: number
          goals_ev: number
          goals_pp: number
          goals_sh: number
          player_id: number
          rebounds_shot: number
          rush_shots: number
          season: number
          shots: number
          shots_ev: number
          shots_pk: number
          shots_pp: number
          sog: number
          team_id: number
          updated_at?: string
          xg: number
          xg_en: number
          xg_ev: number
          xg_pk: number
          xg_pp: number
        }
        Update: {
          avg_dist?: number | null
          avg_xg_per_shot?: number | null
          finishing?: number
          game_type?: string
          goals?: number
          goals_en?: number
          goals_ev?: number
          goals_pp?: number
          goals_sh?: number
          player_id?: number
          rebounds_shot?: number
          rush_shots?: number
          season?: number
          shots?: number
          shots_ev?: number
          shots_pk?: number
          shots_pp?: number
          sog?: number
          team_id?: number
          updated_at?: string
          xg?: number
          xg_en?: number
          xg_ev?: number
          xg_pk?: number
          xg_pp?: number
        }
        Relationships: []
      }
      players: {
        Row: {
          assists: number | null
          blocks: number | null
          full_name: string
          goals: number | null
          goals_against_average: number | null
          headshot_url: string | null
          hits: number | null
          id: string
          jersey_number: string | null
          last_updated: string | null
          losses: number | null
          ot_losses: number | null
          plus_minus: number | null
          points: number | null
          position: string
          save_percentage: number | null
          saves: number | null
          shots: number | null
          status: string | null
          team: string
          team_id: number | null
          wins: number | null
        }
        Insert: {
          assists?: number | null
          blocks?: number | null
          full_name: string
          goals?: number | null
          goals_against_average?: number | null
          headshot_url?: string | null
          hits?: number | null
          id?: string
          jersey_number?: string | null
          last_updated?: string | null
          losses?: number | null
          ot_losses?: number | null
          plus_minus?: number | null
          points?: number | null
          position: string
          save_percentage?: number | null
          saves?: number | null
          shots?: number | null
          status?: string | null
          team: string
          team_id?: number | null
          wins?: number | null
        }
        Update: {
          assists?: number | null
          blocks?: number | null
          full_name?: string
          goals?: number | null
          goals_against_average?: number | null
          headshot_url?: string | null
          hits?: number | null
          id?: string
          jersey_number?: string | null
          last_updated?: string | null
          losses?: number | null
          ot_losses?: number | null
          plus_minus?: number | null
          points?: number | null
          position?: string
          save_percentage?: number | null
          saves?: number | null
          shots?: number | null
          status?: string | null
          team?: string
          team_id?: number | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      playoff_bracket_picks: {
        Row: {
          created_at: string | null
          id: string
          is_correct: boolean | null
          league_id: string
          locked_at: string | null
          picked_team_id: number
          points_earned: number | null
          predicted_games: number | null
          series_slot: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          league_id: string
          locked_at?: string | null
          picked_team_id: number
          points_earned?: number | null
          predicted_games?: number | null
          series_slot: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          league_id?: string
          locked_at?: string | null
          picked_team_id?: number
          points_earned?: number | null
          predicted_games?: number | null
          series_slot?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_bracket_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_bracket_picks_picked_team_id_fkey"
            columns: ["picked_team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      playoff_brackets: {
        Row: {
          bracket_size: number
          champion_team_id: string | null
          completed_at: string | null
          consolation_enabled: boolean
          created_at: string
          current_round: number
          generated_by: string | null
          id: string
          league_id: string
          reseed_each_round: boolean
          runner_up_team_id: string | null
          season: number
          seeding_method: string
          started_at: string | null
          status: string
          third_place_team_id: string | null
          total_rounds: number
          two_week_matchups: boolean
          updated_at: string
        }
        Insert: {
          bracket_size: number
          champion_team_id?: string | null
          completed_at?: string | null
          consolation_enabled?: boolean
          created_at?: string
          current_round?: number
          generated_by?: string | null
          id?: string
          league_id: string
          reseed_each_round?: boolean
          runner_up_team_id?: string | null
          season?: number
          seeding_method?: string
          started_at?: string | null
          status?: string
          third_place_team_id?: string | null
          total_rounds: number
          two_week_matchups?: boolean
          updated_at?: string
        }
        Update: {
          bracket_size?: number
          champion_team_id?: string | null
          completed_at?: string | null
          consolation_enabled?: boolean
          created_at?: string
          current_round?: number
          generated_by?: string | null
          id?: string
          league_id?: string
          reseed_each_round?: boolean
          runner_up_team_id?: string | null
          season?: number
          seeding_method?: string
          started_at?: string | null
          status?: string
          third_place_team_id?: string | null
          total_rounds?: number
          two_week_matchups?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_brackets_champion_team_id_fkey"
            columns: ["champion_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_brackets_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_brackets_runner_up_team_id_fkey"
            columns: ["runner_up_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_brackets_third_place_team_id_fkey"
            columns: ["third_place_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_confidence_picks: {
        Row: {
          confidence_value: number
          created_at: string | null
          id: string
          is_correct: boolean | null
          league_id: string
          locked_at: string | null
          picked_team_id: number
          points_earned: number | null
          series_slot: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          confidence_value: number
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          league_id: string
          locked_at?: string | null
          picked_team_id: number
          points_earned?: number | null
          series_slot: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          confidence_value?: number
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          league_id?: string
          locked_at?: string | null
          picked_team_id?: number
          points_earned?: number | null
          series_slot?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_confidence_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_confidence_picks_picked_team_id_fkey"
            columns: ["picked_team_id"]
            isOneToOne: false
            referencedRelation: "nhl_teams"
            referencedColumns: ["team_id"]
          },
        ]
      }
      playoff_pool_standings: {
        Row: {
          correct_picks: number
          current_rank: number | null
          last_updated: string | null
          league_id: string
          total_points: number
          user_id: string
        }
        Insert: {
          correct_picks?: number
          current_rank?: number | null
          last_updated?: string | null
          league_id: string
          total_points?: number
          user_id: string
        }
        Update: {
          correct_picks?: number
          current_rank?: number | null
          last_updated?: string | null
          league_id?: string
          total_points?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_pool_standings_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_roster_picks: {
        Row: {
          created_at: string | null
          id: string
          league_id: string
          locked_at: string | null
          player_id: number
          position_slot: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          league_id: string
          locked_at?: string | null
          player_id: number
          position_slot: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          league_id?: string
          locked_at?: string | null
          player_id?: number
          position_slot?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_roster_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_seeds: {
        Row: {
          bracket_id: string
          created_at: string
          id: string
          regular_season_losses: number
          regular_season_points_for: number
          regular_season_ties: number
          regular_season_wins: number
          seed_number: number
          source: string
          team_id: string
        }
        Insert: {
          bracket_id: string
          created_at?: string
          id?: string
          regular_season_losses?: number
          regular_season_points_for?: number
          regular_season_ties?: number
          regular_season_wins?: number
          seed_number: number
          source?: string
          team_id: string
        }
        Update: {
          bracket_id?: string
          created_at?: string
          id?: string
          regular_season_losses?: number
          regular_season_points_for?: number
          regular_season_ties?: number
          regular_season_wins?: number
          seed_number?: number
          source?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playoff_seeds_bracket_id_fkey"
            columns: ["bracket_id"]
            isOneToOne: false
            referencedRelation: "playoff_brackets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_seeds_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      playoff_series: {
        Row: {
          away_score: number
          away_seed: number | null
          away_team_id: string | null
          bracket_id: string
          bracket_position: string
          created_at: string
          home_score: number
          home_seed: number | null
          home_team_id: string | null
          id: string
          loser_drops_to: string | null
          loser_slot: string | null
          loser_team_id: string | null
          match_number: number
          matchup_week_1: number | null
          matchup_week_2: number | null
          round_number: number
          status: string
          updated_at: string
          winner_advances_to: string | null
          winner_slot: string | null
          winner_team_id: string | null
        }
        Insert: {
          away_score?: number
          away_seed?: number | null
          away_team_id?: string | null
          bracket_id: string
          bracket_position?: string
          created_at?: string
          home_score?: number
          home_seed?: number | null
          home_team_id?: string | null
          id?: string
          loser_drops_to?: string | null
          loser_slot?: string | null
          loser_team_id?: string | null
          match_number: number
          matchup_week_1?: number | null
          matchup_week_2?: number | null
          round_number: number
          status?: string
          updated_at?: string
          winner_advances_to?: string | null
          winner_slot?: string | null
          winner_team_id?: string | null
        }
        Update: {
          away_score?: number
          away_seed?: number | null
          away_team_id?: string | null
          bracket_id?: string
          bracket_position?: string
          created_at?: string
          home_score?: number
          home_seed?: number | null
          home_team_id?: string | null
          id?: string
          loser_drops_to?: string | null
          loser_slot?: string | null
          loser_team_id?: string | null
          match_number?: number
          matchup_week_1?: number | null
          matchup_week_2?: number | null
          round_number?: number
          status?: string
          updated_at?: string
          winner_advances_to?: string | null
          winner_slot?: string | null
          winner_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playoff_series_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_bracket_id_fkey"
            columns: ["bracket_id"]
            isOneToOne: false
            referencedRelation: "playoff_brackets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_loser_drops_to_fkey"
            columns: ["loser_drops_to"]
            isOneToOne: false
            referencedRelation: "playoff_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_loser_team_id_fkey"
            columns: ["loser_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_winner_advances_to_fkey"
            columns: ["winner_advances_to"]
            isOneToOne: false
            referencedRelation: "playoff_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playoff_series_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_versions: {
        Row: {
          effective_from: string
          policy_type: string
          requires_consent: boolean
          updated_at: string
          version: string
        }
        Insert: {
          effective_from?: string
          policy_type: string
          requires_consent?: boolean
          updated_at?: string
          version: string
        }
        Update: {
          effective_from?: string
          policy_type?: string
          requires_consent?: boolean
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      pool_picks: {
        Row: {
          created_at: string
          game_id: string
          id: string
          is_correct: boolean | null
          league_id: string
          picked_team: string
          spread_value: number | null
          updated_at: string
          user_id: string
          week_number: number
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          is_correct?: boolean | null
          league_id: string
          picked_team: string
          spread_value?: number | null
          updated_at?: string
          user_id: string
          week_number: number
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          is_correct?: boolean | null
          league_id?: string
          picked_team?: string
          spread_value?: number | null
          updated_at?: string
          user_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "pool_picks_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          default_team_name: string | null
          display_name: string | null
          Email: string | null
          first_name: string | null
          id: string
          is_admin: boolean
          is_engine_admin: boolean
          last_name: string | null
          location: string | null
          phone: string | null
          timezone: string | null
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          default_team_name?: string | null
          display_name?: string | null
          Email?: string | null
          first_name?: string | null
          id: string
          is_admin?: boolean
          is_engine_admin?: boolean
          last_name?: string | null
          location?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          default_team_name?: string | null
          display_name?: string | null
          Email?: string | null
          first_name?: string | null
          id?: string
          is_admin?: boolean
          is_engine_admin?: boolean
          last_name?: string | null
          location?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      projection_cache: {
        Row: {
          base_assists: number | null
          base_blocks: number | null
          base_goals: number | null
          base_shots: number | null
          cache_id: string
          calculation_timestamp: string
          data_source_hash: string | null
          finishing_multiplier: number | null
          game_id: number
          goalie_gsax_factor: number | null
          opponent_adjustment: number | null
          opponent_xga_suppression: number | null
          player_id: number
          projected_assists: number
          projected_blocks: number
          projected_goals: number
          projected_saves: number
          projected_shots: number
          projected_toi_seconds: number
          projection_date: string
          season: number
        }
        Insert: {
          base_assists?: number | null
          base_blocks?: number | null
          base_goals?: number | null
          base_shots?: number | null
          cache_id?: string
          calculation_timestamp?: string
          data_source_hash?: string | null
          finishing_multiplier?: number | null
          game_id: number
          goalie_gsax_factor?: number | null
          opponent_adjustment?: number | null
          opponent_xga_suppression?: number | null
          player_id: number
          projected_assists?: number
          projected_blocks?: number
          projected_goals?: number
          projected_saves?: number
          projected_shots?: number
          projected_toi_seconds?: number
          projection_date: string
          season: number
        }
        Update: {
          base_assists?: number | null
          base_blocks?: number | null
          base_goals?: number | null
          base_shots?: number | null
          cache_id?: string
          calculation_timestamp?: string
          data_source_hash?: string | null
          finishing_multiplier?: number | null
          game_id?: number
          goalie_gsax_factor?: number | null
          opponent_adjustment?: number | null
          opponent_xga_suppression?: number | null
          player_id?: number
          projected_assists?: number
          projected_blocks?: number
          projected_goals?: number
          projected_saves?: number
          projected_shots?: number
          projected_toi_seconds?: number
          projection_date?: string
          season?: number
        }
        Relationships: [
          {
            foreignKeyName: "projection_cache_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nhl_games"
            referencedColumns: ["game_id"]
          },
        ]
      }
      projections: {
        Row: {
          created_at: string
          game_id: number
          notes: string | null
          player_id: string
          projected_points: number | null
          projection_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_id: number
          notes?: string | null
          player_id: string
          projected_points?: number | null
          projection_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_id?: number
          notes?: string | null
          player_id?: string
          projected_points?: number | null
          projection_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projections_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "nhl_games"
            referencedColumns: ["game_id"]
          },
          {
            foreignKeyName: "projections_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      push_deliveries: {
        Row: {
          league_id: string
          pick_number: number
          sent_at: string
        }
        Insert: {
          league_id: string
          pick_number: number
          sent_at?: string
        }
        Update: {
          league_id?: string
          pick_number?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_deliveries_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_nhl_data: {
        Row: {
          boxscore_json: Json | null
          content_sha256: string | null
          created_at: string | null
          fetched_at: string | null
          game_date: string
          game_id: number
          id: number
          processed: boolean | null
          raw_json: Json
          scraped_at: string | null
          source_url: string | null
          stats_extracted: boolean | null
          stats_extracted_at: string | null
        }
        Insert: {
          boxscore_json?: Json | null
          content_sha256?: string | null
          created_at?: string | null
          fetched_at?: string | null
          game_date: string
          game_id: number
          id?: number
          processed?: boolean | null
          raw_json: Json
          scraped_at?: string | null
          source_url?: string | null
          stats_extracted?: boolean | null
          stats_extracted_at?: string | null
        }
        Update: {
          boxscore_json?: Json | null
          content_sha256?: string | null
          created_at?: string | null
          fetched_at?: string | null
          game_date?: string
          game_id?: number
          id?: number
          processed?: boolean | null
          raw_json?: Json
          scraped_at?: string | null
          source_url?: string | null
          stats_extracted?: boolean | null
          stats_extracted_at?: string | null
        }
        Relationships: []
      }
      raw_player_stats: {
        Row: {
          created_at: string | null
          game_id: number
          goals_saved_above_expected: number | null
          I_F_highDangerxGoals: number | null
          I_F_lowDangerxGoals: number | null
          I_F_xGoals: number | null
          id: number
          OnIce_xGoalsPercentage: number | null
          playerId: number
          season: number | null
        }
        Insert: {
          created_at?: string | null
          game_id: number
          goals_saved_above_expected?: number | null
          I_F_highDangerxGoals?: number | null
          I_F_lowDangerxGoals?: number | null
          I_F_xGoals?: number | null
          id?: number
          OnIce_xGoalsPercentage?: number | null
          playerId: number
          season?: number | null
        }
        Update: {
          created_at?: string | null
          game_id?: number
          goals_saved_above_expected?: number | null
          I_F_highDangerxGoals?: number | null
          I_F_lowDangerxGoals?: number | null
          I_F_xGoals?: number | null
          id?: number
          OnIce_xGoalsPercentage?: number | null
          playerId?: number
          season?: number | null
        }
        Relationships: []
      }
      raw_shots: {
        Row: {
          angle: number
          angle_change_from_last_event: number | null
          angle_change_squared: number | null
          arena_adjusted_shot_distance: number | null
          arena_adjusted_x: number | null
          arena_adjusted_x_abs: number | null
          arena_adjusted_y: number | null
          arena_adjusted_y_abs: number | null
          assist1_player_id: number | null
          assist2_player_id: number | null
          average_rest_difference: number | null
          away_empty_net: boolean | null
          away_score: number | null
          away_skaters_on_ice: number | null
          away_sog: number | null
          away_team_abbrev: string | null
          away_team_id: number | null
          created_at: string | null
          created_expected_goals: number | null
          defending_team_average_time_on_ice: number | null
          defending_team_average_time_on_ice_of_defencemen: number | null
          defending_team_average_time_on_ice_of_defencemen_since_faceoff:
            | number
            | null
          defending_team_average_time_on_ice_of_forwards: number | null
          defending_team_average_time_on_ice_of_forwards_since_faceoff:
            | number
            | null
          defending_team_average_time_on_ice_since_faceoff: number | null
          defending_team_code: string | null
          defending_team_defencemen_on_ice: number | null
          defending_team_forwards_on_ice: number | null
          defending_team_max_time_on_ice: number | null
          defending_team_max_time_on_ice_of_defencemen: number | null
          defending_team_max_time_on_ice_of_defencemen_since_faceoff:
            | number
            | null
          defending_team_max_time_on_ice_of_forwards: number | null
          defending_team_max_time_on_ice_of_forwards_since_faceoff:
            | number
            | null
          defending_team_max_time_on_ice_since_faceoff: number | null
          defending_team_min_time_on_ice: number | null
          defending_team_min_time_on_ice_of_defencemen: number | null
          defending_team_min_time_on_ice_of_defencemen_since_faceoff:
            | number
            | null
          defending_team_min_time_on_ice_of_forwards: number | null
          defending_team_min_time_on_ice_of_forwards_since_faceoff:
            | number
            | null
          defending_team_min_time_on_ice_since_faceoff: number | null
          defending_team_skaters_on_ice: number | null
          distance: number
          distance_change_from_last_event: number | null
          distance_from_last_event: number | null
          distance_to_nearest_defender: number | null
          east_west_location_of_last_event: number | null
          east_west_location_of_shot: number | null
          event_id: number | null
          event_owner_team_id: number | null
          expected_goals_of_expected_rebounds: number | null
          expected_rebound_probability: number | null
          flurry_adjusted_xg: number | null
          game_id: number
          goalie_id: number | null
          goalie_in_net_id: number | null
          goalie_movement_score: number | null
          goalie_name: string | null
          has_pass_before_shot: boolean | null
          home_empty_net: boolean | null
          home_score: number | null
          home_skaters_on_ice: number | null
          home_sog: number | null
          home_team_abbrev: string | null
          home_team_defending_side: string | null
          home_team_id: number | null
          id: number
          is_empty_net: boolean | null
          is_goal: boolean | null
          is_home_team: boolean | null
          is_power_play: boolean | null
          is_rebound: boolean | null
          is_rush: boolean | null
          last_event_category: string | null
          last_event_shot_angle: number | null
          last_event_shot_distance: number | null
          last_event_team: string | null
          last_event_x: number | null
          last_event_y: number | null
          miss_reason: string | null
          nearest_defender_to_net_distance: number | null
          normalized_lateral_distance: number | null
          north_south_location_of_shot: number | null
          pass_angle: number | null
          pass_immediacy_score: number | null
          pass_lateral_distance: number | null
          pass_quality_score: number | null
          pass_to_net_distance: number | null
          pass_x: number | null
          pass_y: number | null
          pass_zone: string | null
          pass_zone_encoded: number | null
          passer_id: number | null
          penalty_length: number | null
          penalty_time_left: number | null
          period: number | null
          period_type: string | null
          player_id: number
          player_num_that_did_last_event: number | null
          player_position: string | null
          score_differential: number | null
          scoring_player_id: number | null
          season: number | null
          shooter_time_on_ice: number | null
          shooter_time_on_ice_since_faceoff: number | null
          shooting_player_id: number | null
          shooting_talent_adjusted_xg: number | null
          shooting_talent_multiplier: number | null
          shooting_team_average_time_on_ice: number | null
          shooting_team_average_time_on_ice_of_defencemen: number | null
          shooting_team_average_time_on_ice_of_defencemen_since_faceoff:
            | number
            | null
          shooting_team_average_time_on_ice_of_forwards: number | null
          shooting_team_average_time_on_ice_of_forwards_since_faceoff:
            | number
            | null
          shooting_team_average_time_on_ice_since_faceoff: number | null
          shooting_team_code: string | null
          shooting_team_defencemen_on_ice: number | null
          shooting_team_forwards_on_ice: number | null
          shooting_team_max_time_on_ice: number | null
          shooting_team_max_time_on_ice_of_defencemen: number | null
          shooting_team_max_time_on_ice_of_defencemen_since_faceoff:
            | number
            | null
          shooting_team_max_time_on_ice_of_forwards: number | null
          shooting_team_max_time_on_ice_of_forwards_since_faceoff: number | null
          shooting_team_max_time_on_ice_since_faceoff: number | null
          shooting_team_min_time_on_ice: number | null
          shooting_team_min_time_on_ice_of_defencemen: number | null
          shooting_team_min_time_on_ice_of_defencemen_since_faceoff:
            | number
            | null
          shooting_team_min_time_on_ice_of_forwards: number | null
          shooting_team_min_time_on_ice_of_forwards_since_faceoff: number | null
          shooting_team_min_time_on_ice_since_faceoff: number | null
          shot_angle_adjusted: number | null
          shot_angle_plus_rebound: number | null
          shot_angle_plus_rebound_speed: number | null
          shot_angle_rebound_royal_road: number | null
          shot_generated_rebound: boolean | null
          shot_goalie_froze: boolean | null
          shot_play_continued_in_zone: boolean | null
          shot_play_continued_outside_zone: boolean | null
          shot_play_stopped: boolean | null
          shot_type: string | null
          shot_type_code: number | null
          shot_type_encoded: number | null
          shot_type_raw: string | null
          shot_was_on_goal: boolean | null
          shot_x: number
          shot_y: number
          situation_code: string | null
          skaters_in_screening_box: number | null
          sort_order: number | null
          source: string
          speed_from_last_event: number | null
          team_code: string | null
          time_before_shot: number | null
          time_difference_since_change: number | null
          time_in_period: string | null
          time_remaining: string | null
          time_remaining_seconds: number | null
          time_since_faceoff: number | null
          time_since_last_event: number | null
          time_since_powerplay_started: number | null
          type_desc: string | null
          updated_at: string | null
          xa_value: number | null
          xg_honest: number | null
          xg_v5: number | null
          xg_value: number
          xg_value_recomputed: number | null
          zone: string | null
          zone_code: string | null
          zone_relative_distance: number | null
        }
        Insert: {
          angle: number
          angle_change_from_last_event?: number | null
          angle_change_squared?: number | null
          arena_adjusted_shot_distance?: number | null
          arena_adjusted_x?: number | null
          arena_adjusted_x_abs?: number | null
          arena_adjusted_y?: number | null
          arena_adjusted_y_abs?: number | null
          assist1_player_id?: number | null
          assist2_player_id?: number | null
          average_rest_difference?: number | null
          away_empty_net?: boolean | null
          away_score?: number | null
          away_skaters_on_ice?: number | null
          away_sog?: number | null
          away_team_abbrev?: string | null
          away_team_id?: number | null
          created_at?: string | null
          created_expected_goals?: number | null
          defending_team_average_time_on_ice?: number | null
          defending_team_average_time_on_ice_of_defencemen?: number | null
          defending_team_average_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          defending_team_average_time_on_ice_of_forwards?: number | null
          defending_team_average_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          defending_team_average_time_on_ice_since_faceoff?: number | null
          defending_team_code?: string | null
          defending_team_defencemen_on_ice?: number | null
          defending_team_forwards_on_ice?: number | null
          defending_team_max_time_on_ice?: number | null
          defending_team_max_time_on_ice_of_defencemen?: number | null
          defending_team_max_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          defending_team_max_time_on_ice_of_forwards?: number | null
          defending_team_max_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          defending_team_max_time_on_ice_since_faceoff?: number | null
          defending_team_min_time_on_ice?: number | null
          defending_team_min_time_on_ice_of_defencemen?: number | null
          defending_team_min_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          defending_team_min_time_on_ice_of_forwards?: number | null
          defending_team_min_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          defending_team_min_time_on_ice_since_faceoff?: number | null
          defending_team_skaters_on_ice?: number | null
          distance: number
          distance_change_from_last_event?: number | null
          distance_from_last_event?: number | null
          distance_to_nearest_defender?: number | null
          east_west_location_of_last_event?: number | null
          east_west_location_of_shot?: number | null
          event_id?: number | null
          event_owner_team_id?: number | null
          expected_goals_of_expected_rebounds?: number | null
          expected_rebound_probability?: number | null
          flurry_adjusted_xg?: number | null
          game_id: number
          goalie_id?: number | null
          goalie_in_net_id?: number | null
          goalie_movement_score?: number | null
          goalie_name?: string | null
          has_pass_before_shot?: boolean | null
          home_empty_net?: boolean | null
          home_score?: number | null
          home_skaters_on_ice?: number | null
          home_sog?: number | null
          home_team_abbrev?: string | null
          home_team_defending_side?: string | null
          home_team_id?: number | null
          id?: number
          is_empty_net?: boolean | null
          is_goal?: boolean | null
          is_home_team?: boolean | null
          is_power_play?: boolean | null
          is_rebound?: boolean | null
          is_rush?: boolean | null
          last_event_category?: string | null
          last_event_shot_angle?: number | null
          last_event_shot_distance?: number | null
          last_event_team?: string | null
          last_event_x?: number | null
          last_event_y?: number | null
          miss_reason?: string | null
          nearest_defender_to_net_distance?: number | null
          normalized_lateral_distance?: number | null
          north_south_location_of_shot?: number | null
          pass_angle?: number | null
          pass_immediacy_score?: number | null
          pass_lateral_distance?: number | null
          pass_quality_score?: number | null
          pass_to_net_distance?: number | null
          pass_x?: number | null
          pass_y?: number | null
          pass_zone?: string | null
          pass_zone_encoded?: number | null
          passer_id?: number | null
          penalty_length?: number | null
          penalty_time_left?: number | null
          period?: number | null
          period_type?: string | null
          player_id: number
          player_num_that_did_last_event?: number | null
          player_position?: string | null
          score_differential?: number | null
          scoring_player_id?: number | null
          season?: number | null
          shooter_time_on_ice?: number | null
          shooter_time_on_ice_since_faceoff?: number | null
          shooting_player_id?: number | null
          shooting_talent_adjusted_xg?: number | null
          shooting_talent_multiplier?: number | null
          shooting_team_average_time_on_ice?: number | null
          shooting_team_average_time_on_ice_of_defencemen?: number | null
          shooting_team_average_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          shooting_team_average_time_on_ice_of_forwards?: number | null
          shooting_team_average_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          shooting_team_average_time_on_ice_since_faceoff?: number | null
          shooting_team_code?: string | null
          shooting_team_defencemen_on_ice?: number | null
          shooting_team_forwards_on_ice?: number | null
          shooting_team_max_time_on_ice?: number | null
          shooting_team_max_time_on_ice_of_defencemen?: number | null
          shooting_team_max_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          shooting_team_max_time_on_ice_of_forwards?: number | null
          shooting_team_max_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          shooting_team_max_time_on_ice_since_faceoff?: number | null
          shooting_team_min_time_on_ice?: number | null
          shooting_team_min_time_on_ice_of_defencemen?: number | null
          shooting_team_min_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          shooting_team_min_time_on_ice_of_forwards?: number | null
          shooting_team_min_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          shooting_team_min_time_on_ice_since_faceoff?: number | null
          shot_angle_adjusted?: number | null
          shot_angle_plus_rebound?: number | null
          shot_angle_plus_rebound_speed?: number | null
          shot_angle_rebound_royal_road?: number | null
          shot_generated_rebound?: boolean | null
          shot_goalie_froze?: boolean | null
          shot_play_continued_in_zone?: boolean | null
          shot_play_continued_outside_zone?: boolean | null
          shot_play_stopped?: boolean | null
          shot_type?: string | null
          shot_type_code?: number | null
          shot_type_encoded?: number | null
          shot_type_raw?: string | null
          shot_was_on_goal?: boolean | null
          shot_x: number
          shot_y: number
          situation_code?: string | null
          skaters_in_screening_box?: number | null
          sort_order?: number | null
          source?: string
          speed_from_last_event?: number | null
          team_code?: string | null
          time_before_shot?: number | null
          time_difference_since_change?: number | null
          time_in_period?: string | null
          time_remaining?: string | null
          time_remaining_seconds?: number | null
          time_since_faceoff?: number | null
          time_since_last_event?: number | null
          time_since_powerplay_started?: number | null
          type_desc?: string | null
          updated_at?: string | null
          xa_value?: number | null
          xg_honest?: number | null
          xg_v5?: number | null
          xg_value: number
          xg_value_recomputed?: number | null
          zone?: string | null
          zone_code?: string | null
          zone_relative_distance?: number | null
        }
        Update: {
          angle?: number
          angle_change_from_last_event?: number | null
          angle_change_squared?: number | null
          arena_adjusted_shot_distance?: number | null
          arena_adjusted_x?: number | null
          arena_adjusted_x_abs?: number | null
          arena_adjusted_y?: number | null
          arena_adjusted_y_abs?: number | null
          assist1_player_id?: number | null
          assist2_player_id?: number | null
          average_rest_difference?: number | null
          away_empty_net?: boolean | null
          away_score?: number | null
          away_skaters_on_ice?: number | null
          away_sog?: number | null
          away_team_abbrev?: string | null
          away_team_id?: number | null
          created_at?: string | null
          created_expected_goals?: number | null
          defending_team_average_time_on_ice?: number | null
          defending_team_average_time_on_ice_of_defencemen?: number | null
          defending_team_average_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          defending_team_average_time_on_ice_of_forwards?: number | null
          defending_team_average_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          defending_team_average_time_on_ice_since_faceoff?: number | null
          defending_team_code?: string | null
          defending_team_defencemen_on_ice?: number | null
          defending_team_forwards_on_ice?: number | null
          defending_team_max_time_on_ice?: number | null
          defending_team_max_time_on_ice_of_defencemen?: number | null
          defending_team_max_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          defending_team_max_time_on_ice_of_forwards?: number | null
          defending_team_max_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          defending_team_max_time_on_ice_since_faceoff?: number | null
          defending_team_min_time_on_ice?: number | null
          defending_team_min_time_on_ice_of_defencemen?: number | null
          defending_team_min_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          defending_team_min_time_on_ice_of_forwards?: number | null
          defending_team_min_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          defending_team_min_time_on_ice_since_faceoff?: number | null
          defending_team_skaters_on_ice?: number | null
          distance?: number
          distance_change_from_last_event?: number | null
          distance_from_last_event?: number | null
          distance_to_nearest_defender?: number | null
          east_west_location_of_last_event?: number | null
          east_west_location_of_shot?: number | null
          event_id?: number | null
          event_owner_team_id?: number | null
          expected_goals_of_expected_rebounds?: number | null
          expected_rebound_probability?: number | null
          flurry_adjusted_xg?: number | null
          game_id?: number
          goalie_id?: number | null
          goalie_in_net_id?: number | null
          goalie_movement_score?: number | null
          goalie_name?: string | null
          has_pass_before_shot?: boolean | null
          home_empty_net?: boolean | null
          home_score?: number | null
          home_skaters_on_ice?: number | null
          home_sog?: number | null
          home_team_abbrev?: string | null
          home_team_defending_side?: string | null
          home_team_id?: number | null
          id?: number
          is_empty_net?: boolean | null
          is_goal?: boolean | null
          is_home_team?: boolean | null
          is_power_play?: boolean | null
          is_rebound?: boolean | null
          is_rush?: boolean | null
          last_event_category?: string | null
          last_event_shot_angle?: number | null
          last_event_shot_distance?: number | null
          last_event_team?: string | null
          last_event_x?: number | null
          last_event_y?: number | null
          miss_reason?: string | null
          nearest_defender_to_net_distance?: number | null
          normalized_lateral_distance?: number | null
          north_south_location_of_shot?: number | null
          pass_angle?: number | null
          pass_immediacy_score?: number | null
          pass_lateral_distance?: number | null
          pass_quality_score?: number | null
          pass_to_net_distance?: number | null
          pass_x?: number | null
          pass_y?: number | null
          pass_zone?: string | null
          pass_zone_encoded?: number | null
          passer_id?: number | null
          penalty_length?: number | null
          penalty_time_left?: number | null
          period?: number | null
          period_type?: string | null
          player_id?: number
          player_num_that_did_last_event?: number | null
          player_position?: string | null
          score_differential?: number | null
          scoring_player_id?: number | null
          season?: number | null
          shooter_time_on_ice?: number | null
          shooter_time_on_ice_since_faceoff?: number | null
          shooting_player_id?: number | null
          shooting_talent_adjusted_xg?: number | null
          shooting_talent_multiplier?: number | null
          shooting_team_average_time_on_ice?: number | null
          shooting_team_average_time_on_ice_of_defencemen?: number | null
          shooting_team_average_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          shooting_team_average_time_on_ice_of_forwards?: number | null
          shooting_team_average_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          shooting_team_average_time_on_ice_since_faceoff?: number | null
          shooting_team_code?: string | null
          shooting_team_defencemen_on_ice?: number | null
          shooting_team_forwards_on_ice?: number | null
          shooting_team_max_time_on_ice?: number | null
          shooting_team_max_time_on_ice_of_defencemen?: number | null
          shooting_team_max_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          shooting_team_max_time_on_ice_of_forwards?: number | null
          shooting_team_max_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          shooting_team_max_time_on_ice_since_faceoff?: number | null
          shooting_team_min_time_on_ice?: number | null
          shooting_team_min_time_on_ice_of_defencemen?: number | null
          shooting_team_min_time_on_ice_of_defencemen_since_faceoff?:
            | number
            | null
          shooting_team_min_time_on_ice_of_forwards?: number | null
          shooting_team_min_time_on_ice_of_forwards_since_faceoff?:
            | number
            | null
          shooting_team_min_time_on_ice_since_faceoff?: number | null
          shot_angle_adjusted?: number | null
          shot_angle_plus_rebound?: number | null
          shot_angle_plus_rebound_speed?: number | null
          shot_angle_rebound_royal_road?: number | null
          shot_generated_rebound?: boolean | null
          shot_goalie_froze?: boolean | null
          shot_play_continued_in_zone?: boolean | null
          shot_play_continued_outside_zone?: boolean | null
          shot_play_stopped?: boolean | null
          shot_type?: string | null
          shot_type_code?: number | null
          shot_type_encoded?: number | null
          shot_type_raw?: string | null
          shot_was_on_goal?: boolean | null
          shot_x?: number
          shot_y?: number
          situation_code?: string | null
          skaters_in_screening_box?: number | null
          sort_order?: number | null
          source?: string
          speed_from_last_event?: number | null
          team_code?: string | null
          time_before_shot?: number | null
          time_difference_since_change?: number | null
          time_in_period?: string | null
          time_remaining?: string | null
          time_remaining_seconds?: number | null
          time_since_faceoff?: number | null
          time_since_last_event?: number | null
          time_since_powerplay_started?: number | null
          type_desc?: string | null
          updated_at?: string | null
          xa_value?: number | null
          xg_honest?: number | null
          xg_v5?: number | null
          xg_value?: number
          xg_value_recomputed?: number | null
          zone?: string | null
          zone_code?: string | null
          zone_relative_distance?: number | null
        }
        Relationships: []
      }
      rebound_window_era: {
        Row: {
          max_gap_s: number
          note: string | null
          season_from: number
        }
        Insert: {
          max_gap_s: number
          note?: string | null
          season_from: number
        }
        Update: {
          max_gap_s?: number
          note?: string | null
          season_from?: number
        }
        Relationships: []
      }
      roster_assignments: {
        Row: {
          acquired_at: string
          created_at: string
          id: string
          league_id: string
          player_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          acquired_at?: string
          created_at?: string
          id?: string
          league_id: string
          player_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          acquired_at?: string
          created_at?: string
          id?: string
          league_id?: string
          player_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_assignments_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_log: {
        Row: {
          created_at: string
          details: Json | null
          event_type: string
          id: string
          ip_address: string | null
          league_id: string | null
          severity: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          ip_address?: string | null
          league_id?: string | null
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          ip_address?: string | null
          league_id?: string | null
          severity?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_audit_log_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_clock_repairs: {
        Row: {
          duration_s: number
          game_id: number
          new_end: number
          new_start: number
          old_end: number
          old_start: number
          pattern: string
          period: number
          player_id: number
          repaired_at: string
          shift_id: number
        }
        Insert: {
          duration_s: number
          game_id: number
          new_end: number
          new_start: number
          old_end: number
          old_start: number
          pattern: string
          period: number
          player_id: number
          repaired_at?: string
          shift_id: number
        }
        Update: {
          duration_s?: number
          game_id?: number
          new_end?: number
          new_start?: number
          old_end?: number
          old_start?: number
          pattern?: string
          period?: number
          player_id?: number
          repaired_at?: string
          shift_id?: number
        }
        Relationships: []
      }
      shift_ingest_quality: {
        Row: {
          fetched_at: string
          game_id: number
          n_checked: number
          n_exact: number
          n_players: number
          n_shifts: number
          n_within_30s: number
          pct_within_30s: number | null
          verdict: string
          worst_diff_s: number | null
        }
        Insert: {
          fetched_at?: string
          game_id: number
          n_checked: number
          n_exact: number
          n_players: number
          n_shifts: number
          n_within_30s: number
          pct_within_30s?: number | null
          verdict: string
          worst_diff_s?: number | null
        }
        Update: {
          fetched_at?: string
          game_id?: number
          n_checked?: number
          n_exact?: number
          n_players?: number
          n_shifts?: number
          n_within_30s?: number
          pct_within_30s?: number | null
          verdict?: string
          worst_diff_s?: number | null
        }
        Relationships: []
      }
      shot_rebound_derived: {
        Row: {
          event_id: number
          game_id: number
          is_rebound: boolean
          period: number
          prev_gap_s: number | null
          prev_type: string | null
          t_sec: number
          team_id: number | null
        }
        Insert: {
          event_id: number
          game_id: number
          is_rebound: boolean
          period: number
          prev_gap_s?: number | null
          prev_type?: string | null
          t_sec: number
          team_id?: number | null
        }
        Update: {
          event_id?: number
          game_id?: number
          is_rebound?: boolean
          period?: number
          prev_gap_s?: number | null
          prev_type?: string | null
          t_sec?: number
          team_id?: number | null
        }
        Relationships: []
      }
      stat_catalog: {
        Row: {
          applies_to: string
          default_multiplier: number
          display_name: string
          is_core: boolean
          sort_order: number
          stat_key: string
        }
        Insert: {
          applies_to: string
          default_multiplier?: number
          display_name: string
          is_core?: boolean
          sort_order?: number
          stat_key: string
        }
        Update: {
          applies_to?: string
          default_multiplier?: number
          display_name?: string
          is_core?: boolean
          sort_order?: number
          stat_key?: string
        }
        Relationships: []
      }
      stormy_chat_log: {
        Row: {
          created_at: string | null
          id: string
          message_preview: string | null
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_preview?: string | null
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_preview?: string | null
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: []
      }
      strength_build_state: {
        Row: {
          built_at: string | null
          game_id: number
          n_intervals: number | null
          onice_built_at: string | null
          penalties_built_at: string | null
          refined_at: string | null
          toi_built_at: string | null
        }
        Insert: {
          built_at?: string | null
          game_id: number
          n_intervals?: number | null
          onice_built_at?: string | null
          penalties_built_at?: string | null
          refined_at?: string | null
          toi_built_at?: string | null
        }
        Update: {
          built_at?: string | null
          game_id?: number
          n_intervals?: number | null
          onice_built_at?: string | null
          penalties_built_at?: string | null
          refined_at?: string | null
          toi_built_at?: string | null
        }
        Relationships: []
      }
      strength_refine_log: {
        Row: {
          boundaries_moved: number
          games: number
          id: number
          ran_at: string
          seconds_reassigned: number
        }
        Insert: {
          boundaries_moved: number
          games: number
          id?: number
          ran_at?: string
          seconds_reassigned: number
        }
        Update: {
          boundaries_moved?: number
          games?: number
          id?: number
          ran_at?: string
          seconds_reassigned?: number
        }
        Relationships: []
      }
      survivor_selections: {
        Row: {
          created_at: string
          eliminated_at: string | null
          id: string
          is_correct: boolean | null
          league_id: string
          picked_team: string
          user_id: string
          week_number: number
        }
        Insert: {
          created_at?: string
          eliminated_at?: string | null
          id?: string
          is_correct?: boolean | null
          league_id: string
          picked_team: string
          user_id: string
          week_number: number
        }
        Update: {
          created_at?: string
          eliminated_at?: string | null
          id?: string
          is_correct?: boolean | null
          league_id?: string
          picked_team?: string
          user_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "survivor_selections_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      system_flags: {
        Row: {
          flag_name: string
          flag_value: boolean
          reason: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          flag_name: string
          flag_value?: boolean
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          flag_name?: string
          flag_value?: boolean
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_lineups: {
        Row: {
          bench: Json
          ir: Json
          league_id: string
          slot_assignments: Json
          starters: Json
          team_id: string
          updated_at: string | null
        }
        Insert: {
          bench?: Json
          ir?: Json
          league_id: string
          slot_assignments?: Json
          starters?: Json
          team_id: string
          updated_at?: string | null
        }
        Update: {
          bench?: Json
          ir?: Json
          league_id?: string
          slot_assignments?: Json
          starters?: Json
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_lineups_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      team_lineups_backup_log: {
        Row: {
          backup_data: Json
          backup_name: string
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          player_count: number | null
          team_count: number | null
        }
        Insert: {
          backup_data: Json
          backup_name: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          player_count?: number | null
          team_count?: number | null
        }
        Update: {
          backup_data?: Json
          backup_name?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          player_count?: number | null
          team_count?: number | null
        }
        Relationships: []
      }
      team_mapping_config: {
        Row: {
          aliased_team_codes: string[]
          canonical_team_code: string
          created_at: string
          effective_date: string
          mapping_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          aliased_team_codes: string[]
          canonical_team_code: string
          created_at?: string
          effective_date?: string
          mapping_id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          aliased_team_codes?: string[]
          canonical_team_code?: string
          created_at?: string
          effective_date?: string
          mapping_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      team_stats: {
        Row: {
          created_at: string | null
          games_played: number | null
          goal_diff: number | null
          goals_against_avg: number | null
          goals_for_avg: number | null
          id: string
          save_pct: number | null
          season: number
          shots_against_avg: number | null
          shots_for_avg: number | null
          team_abbrev: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          games_played?: number | null
          goal_diff?: number | null
          goals_against_avg?: number | null
          goals_for_avg?: number | null
          id?: string
          save_pct?: number | null
          season: number
          shots_against_avg?: number | null
          shots_for_avg?: number | null
          team_abbrev: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          games_played?: number | null
          goal_diff?: number | null
          goals_against_avg?: number | null
          goals_for_avg?: number | null
          id?: string
          save_pct?: number | null
          season?: number
          shots_against_avg?: number | null
          shots_for_avg?: number | null
          team_abbrev?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      team_xg_season: {
        Row: {
          game_type: string
          goals_against: number
          goals_for: number
          season: number
          shots_against: number
          shots_for: number
          team_id: number
          updated_at: string
          xg_against: number
          xg_for: number
        }
        Insert: {
          game_type: string
          goals_against: number
          goals_for: number
          season: number
          shots_against: number
          shots_for: number
          team_id: number
          updated_at?: string
          xg_against: number
          xg_for: number
        }
        Update: {
          game_type?: string
          goals_against?: number
          goals_for?: number
          season?: number
          shots_against?: number
          shots_for?: number
          team_id?: number
          updated_at?: string
          xg_against?: number
          xg_for?: number
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          id: string
          league_id: string
          owner_id: string | null
          team_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          owner_id?: string | null
          team_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          owner_id?: string | null
          team_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_history: {
        Row: {
          executed_at: string
          id: string
          league_id: string
          team1_id: string
          team1_players: number[]
          team2_id: string
          team2_players: number[]
          trade_offer_id: string
        }
        Insert: {
          executed_at?: string
          id?: string
          league_id: string
          team1_id: string
          team1_players: number[]
          team2_id: string
          team2_players: number[]
          trade_offer_id: string
        }
        Update: {
          executed_at?: string
          id?: string
          league_id?: string
          team1_id?: string
          team1_players?: number[]
          team2_id?: string
          team2_players?: number[]
          trade_offer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_history_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_history_team1_id_fkey"
            columns: ["team1_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_history_team2_id_fkey"
            columns: ["team2_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_history_trade_offer_id_fkey"
            columns: ["trade_offer_id"]
            isOneToOne: false
            referencedRelation: "trade_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_offers: {
        Row: {
          counter_offer_id: string | null
          created_at: string
          expires_at: string | null
          from_team_id: string
          id: string
          league_id: string
          message: string | null
          offered_player_ids: number[]
          processed_at: string | null
          requested_player_ids: number[]
          review_ends_at: string | null
          review_started_at: string | null
          review_type: string
          status: string
          to_team_id: string
          updated_at: string
          vetoed_at: string | null
        }
        Insert: {
          counter_offer_id?: string | null
          created_at?: string
          expires_at?: string | null
          from_team_id: string
          id?: string
          league_id: string
          message?: string | null
          offered_player_ids: number[]
          processed_at?: string | null
          requested_player_ids: number[]
          review_ends_at?: string | null
          review_started_at?: string | null
          review_type?: string
          status: string
          to_team_id: string
          updated_at?: string
          vetoed_at?: string | null
        }
        Update: {
          counter_offer_id?: string | null
          created_at?: string
          expires_at?: string | null
          from_team_id?: string
          id?: string
          league_id?: string
          message?: string | null
          offered_player_ids?: number[]
          processed_at?: string | null
          requested_player_ids?: number[]
          review_ends_at?: string | null
          review_started_at?: string | null
          review_type?: string
          status?: string
          to_team_id?: string
          updated_at?: string
          vetoed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_offers_counter_offer_id_fkey"
            columns: ["counter_offer_id"]
            isOneToOne: false
            referencedRelation: "trade_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_offers_from_team_id_fkey"
            columns: ["from_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_offers_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_offers_to_team_id_fkey"
            columns: ["to_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_votes: {
        Row: {
          created_at: string
          id: string
          league_id: string
          trade_offer_id: string
          updated_at: string
          vote: string
          voter_team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          trade_offer_id: string
          updated_at?: string
          vote: string
          voter_team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          trade_offer_id?: string
          updated_at?: string
          vote?: string
          voter_team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_votes_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_votes_trade_offer_id_fkey"
            columns: ["trade_offer_id"]
            isOneToOne: false
            referencedRelation: "trade_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_votes_voter_team_id_fkey"
            columns: ["voter_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_ledger: {
        Row: {
          created_at: string
          id: string
          league_id: string
          player_id: string
          source: string | null
          team_id: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          player_id: string
          source?: string | null
          team_id: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          player_id?: string
          source?: string | null
          team_id?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_transactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_privacy_consent: {
        Row: {
          consented_at: string
          created_at: string
          granted: boolean
          id: string
          policy_type: string
          source: string
          user_id: string
          version: string
          withdrawn_at: string | null
        }
        Insert: {
          consented_at?: string
          created_at?: string
          granted?: boolean
          id?: string
          policy_type: string
          source?: string
          user_id: string
          version: string
          withdrawn_at?: string | null
        }
        Update: {
          consented_at?: string
          created_at?: string
          granted?: boolean
          id?: string
          policy_type?: string
          source?: string
          user_id?: string
          version?: string
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_address: string | null
          source: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_address?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_address?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      waiver_claims: {
        Row: {
          bid_amount: number | null
          created_at: string
          drop_player_id: number | null
          failure_reason: string | null
          id: string
          is_conditional_drop: boolean | null
          league_id: string
          player_id: number
          priority: number | null
          processed_at: string | null
          status: string
          team_id: string
          updated_at: string
        }
        Insert: {
          bid_amount?: number | null
          created_at?: string
          drop_player_id?: number | null
          failure_reason?: string | null
          id?: string
          is_conditional_drop?: boolean | null
          league_id: string
          player_id: number
          priority?: number | null
          processed_at?: string | null
          status: string
          team_id: string
          updated_at?: string
        }
        Update: {
          bid_amount?: number | null
          created_at?: string
          drop_player_id?: number | null
          failure_reason?: string | null
          id?: string
          is_conditional_drop?: boolean | null
          league_id?: string
          player_id?: number
          priority?: number | null
          processed_at?: string | null
          status?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiver_claims_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_claims_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      waiver_priority: {
        Row: {
          id: string
          league_id: string
          priority: number
          team_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          league_id: string
          priority: number
          team_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          league_id?: string
          priority?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiver_priority_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_priority_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      xg_honest_meta: {
        Row: {
          fitted_at: string
          holdout_auc: number | null
          holdout_ratio: number | null
          holdout_season: number | null
          id: number
          notes: string | null
          train_seasons: string
          train_shots: number
        }
        Insert: {
          fitted_at?: string
          holdout_auc?: number | null
          holdout_ratio?: number | null
          holdout_season?: number | null
          id?: number
          notes?: string | null
          train_seasons: string
          train_shots: number
        }
        Update: {
          fitted_at?: string
          holdout_auc?: number | null
          holdout_ratio?: number | null
          holdout_season?: number | null
          id?: number
          notes?: string | null
          train_seasons?: string
          train_shots?: number
        }
        Relationships: []
      }
      xg_rebuild_audit: {
        Row: {
          actual: number | null
          detail: string | null
          expected: number | null
          id: number
          layer: string
          measured_at: string
          season: number
          status: string
        }
        Insert: {
          actual?: number | null
          detail?: string | null
          expected?: number | null
          id?: never
          layer: string
          measured_at?: string
          season: number
          status: string
        }
        Update: {
          actual?: number | null
          detail?: string | null
          expected?: number | null
          id?: never
          layer?: string
          measured_at?: string
          season?: number
          status?: string
        }
        Relationships: []
      }
      xg_retrain_log: {
        Row: {
          auc: number | null
          calibration: number | null
          captured_at: string
          goals: number | null
          id: number
          note: string | null
          phase: string
          season: number | null
          shots: number | null
        }
        Insert: {
          auc?: number | null
          calibration?: number | null
          captured_at?: string
          goals?: number | null
          id?: never
          note?: string | null
          phase: string
          season?: number | null
          shots?: number | null
        }
        Update: {
          auc?: number | null
          calibration?: number | null
          captured_at?: string
          goals?: number | null
          id?: never
          note?: string | null
          phase?: string
          season?: number | null
          shots?: number | null
        }
        Relationships: []
      }
      xg_v5_cells: {
        Row: {
          angle_band: number
          dist_band: number
          goals: number
          is_rebound: boolean
          n: number
          p: number
          shot_class: string
          skater_edge: number
        }
        Insert: {
          angle_band: number
          dist_band: number
          goals: number
          is_rebound: boolean
          n: number
          p: number
          shot_class: string
          skater_edge: number
        }
        Update: {
          angle_band?: number
          dist_band?: number
          goals?: number
          is_rebound?: boolean
          n?: number
          p?: number
          shot_class?: string
          skater_edge?: number
        }
        Relationships: []
      }
      xg_v5_en: {
        Row: {
          dist_band: number
          goals: number
          n: number
          p: number
        }
        Insert: {
          dist_band: number
          goals: number
          n: number
          p: number
        }
        Update: {
          dist_band?: number
          goals?: number
          n?: number
          p?: number
        }
        Relationships: []
      }
      xg_v5_era: {
        Row: {
          expected: number
          fitted_at: string
          goals: number
          is_rebound: boolean
          mult: number
          n: number
          season: number
        }
        Insert: {
          expected: number
          fitted_at?: string
          goals: number
          is_rebound: boolean
          mult: number
          n: number
          season: number
        }
        Update: {
          expected?: number
          fitted_at?: string
          goals?: number
          is_rebound?: boolean
          mult?: number
          n?: number
          season?: number
        }
        Relationships: []
      }
      xg_v5_fit_rows: {
        Row: {
          base: number
          bucket: number
          game_type: number | null
          id: number
          is_empty_net: boolean | null
          is_goal: boolean
          is_rebound: boolean | null
          season: number | null
        }
        Insert: {
          base: number
          bucket: number
          game_type?: number | null
          id: number
          is_empty_net?: boolean | null
          is_goal: boolean
          is_rebound?: boolean | null
          season?: number | null
        }
        Update: {
          base?: number
          bucket?: number
          game_type?: number | null
          id?: number
          is_empty_net?: boolean | null
          is_goal?: boolean
          is_rebound?: boolean | null
          season?: number | null
        }
        Relationships: []
      }
      xg_v5_global: {
        Row: {
          id: number
          p: number
        }
        Insert: {
          id?: number
          p: number
        }
        Update: {
          id?: number
          p?: number
        }
        Relationships: []
      }
      xg_v5_moat: {
        Row: {
          bucket: number
          expected: number
          goals: number
          label: string
          mult: number
          n: number
        }
        Insert: {
          bucket: number
          expected: number
          goals: number
          label: string
          mult: number
          n: number
        }
        Update: {
          bucket?: number
          expected?: number
          goals?: number
          label?: string
          mult?: number
          n?: number
        }
        Relationships: []
      }
      xg_v5_parent: {
        Row: {
          dist_band: number
          goals: number
          n: number
          p: number
          shot_class: string
        }
        Insert: {
          dist_band: number
          goals: number
          n: number
          p: number
          shot_class: string
        }
        Update: {
          dist_band?: number
          goals?: number
          n?: number
          p?: number
          shot_class?: string
        }
        Relationships: []
      }
      xg_v5_playoff: {
        Row: {
          expected: number
          fitted_at: string
          goals: number
          id: number
          mult: number
          n: number
        }
        Insert: {
          expected: number
          fitted_at?: string
          goals: number
          id: number
          mult: number
          n: number
        }
        Update: {
          expected?: number
          fitted_at?: string
          goals?: number
          id?: number
          mult?: number
          n?: number
        }
        Relationships: []
      }
      xg_v5_season_scale: {
        Row: {
          fitted_at: string
          goals: number
          raw_sum: number
          scale: number
          season: number
          shots: number
        }
        Insert: {
          fitted_at?: string
          goals: number
          raw_sum: number
          scale: number
          season: number
          shots: number
        }
        Update: {
          fitted_at?: string
          goals?: number
          raw_sum?: number
          scale?: number
          season?: number
          shots?: number
        }
        Relationships: []
      }
      xg_v5_shape: {
        Row: {
          band: number
          expected: number
          fitted_at: string
          goals: number
          hi: number
          lo: number
          mult: number
          n: number
        }
        Insert: {
          band: number
          expected: number
          fitted_at?: string
          goals: number
          hi: number
          lo: number
          mult: number
          n: number
        }
        Update: {
          band?: number
          expected?: number
          fitted_at?: string
          goals?: number
          hi?: number
          lo?: number
          mult?: number
          n?: number
        }
        Relationships: []
      }
    }
    Views: {
      current_rosters: {
        Row: {
          acquired_at: string | null
          assignment_id: string | null
          created_at: string | null
          league_id: string | null
          league_name: string | null
          owner_id: string | null
          player_id: string | null
          team_id: string | null
          team_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_assignments_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_latency_scorecard: {
        Row: {
          autopick_deadline_max_ms: number | null
          autopick_deadline_p50_ms: number | null
          autopick_deadline_p95_ms: number | null
          autopick_share: number | null
          autopicks: number | null
          completed_at: string | null
          completed_total_picks: number | null
          deadline_autopicks: number | null
          draft_duration: string | null
          draft_duration_minutes: number | null
          draft_format: string | null
          draft_state: string | null
          instant_autopicks: number | null
          league_id: string | null
          league_name: string | null
          manual_picks: number | null
          pick_time_limit_seconds: number | null
          picks: number | null
          picks_per_minute: number | null
          started_at: string | null
          total_rounds: number | null
          total_teams: number | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_events_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_history_handback: {
        Row: {
          champion: string | null
          confirmed: boolean | null
          league_id: string | null
          note: string | null
          platform: string | null
          runner_up: string | null
          season: number | null
          standings_rows: number | null
          verified_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_seasons_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_history_queue: {
        Row: {
          created_at: string | null
          id: string | null
          league_name: string | null
          platform: string | null
          requested_by_email: string | null
          requested_by_name: string | null
          screenshot_paths: string[] | null
          screenshots: number | null
          seasons_already_imported: number | null
          seasons_note: string | null
          source_url: string | null
          status: string | null
        }
        Relationships: []
      }
      league_member_honours: {
        Row: {
          best_finish: number | null
          career_losses: number | null
          career_ties: number | null
          career_wins: number | null
          display_name: string | null
          finals_lost: number | null
          first_season: number | null
          last_season: number | null
          league_id: string | null
          member_id: string | null
          owner_id: string | null
          playoff_seasons: number | null
          seasons_played: number | null
          titles: number | null
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_members_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_season_results: {
        Row: {
          champion: string | null
          league_id: string | null
          platform: string | null
          regular_season_winner: string | null
          runner_up: string | null
          season: number | null
          team_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "league_seasons_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      nhl_shot_features: {
        Row: {
          event_id: number | null
          f_ang: number | null
          f_behind_net: boolean | null
          f_dist: number | null
          f_dist_prev: number | null
          f_en_against: boolean | null
          f_en_for: boolean | null
          f_penalty_shot: boolean | null
          f_period: number | null
          f_playoff: boolean | null
          f_prev: string | null
          f_rebound: boolean | null
          f_royal_road: boolean | null
          f_rush: boolean | null
          f_score_diff: number | null
          f_sec_elapsed: number | null
          f_sec_prev: number | null
          f_strength: string | null
          f_type: string | null
          f_x: number | null
          f_yabs: number | null
          game_date: string | null
          game_id: number | null
          game_type: string | null
          goalie_id: number | null
          is_goal: boolean | null
          is_home: boolean | null
          opp_goalie: number | null
          opp_skaters: number | null
          own_goalie: number | null
          own_skaters: number | null
          season: number | null
          shooter_id: number | null
          strength_source: string | null
          team_id: number | null
        }
        Insert: {
          event_id?: number | null
          f_ang?: never
          f_behind_net?: never
          f_dist?: never
          f_dist_prev?: never
          f_en_against?: never
          f_en_for?: never
          f_penalty_shot?: boolean | null
          f_period?: never
          f_playoff?: never
          f_prev?: never
          f_rebound?: never
          f_royal_road?: never
          f_rush?: never
          f_score_diff?: never
          f_sec_elapsed?: number | null
          f_sec_prev?: never
          f_strength?: never
          f_type?: never
          f_x?: number | null
          f_yabs?: never
          game_date?: string | null
          game_id?: number | null
          game_type?: string | null
          goalie_id?: number | null
          is_goal?: boolean | null
          is_home?: boolean | null
          opp_goalie?: number | null
          opp_skaters?: number | null
          own_goalie?: number | null
          own_skaters?: number | null
          season?: number | null
          shooter_id?: number | null
          strength_source?: string | null
          team_id?: number | null
        }
        Update: {
          event_id?: number | null
          f_ang?: never
          f_behind_net?: never
          f_dist?: never
          f_dist_prev?: never
          f_en_against?: never
          f_en_for?: never
          f_penalty_shot?: boolean | null
          f_period?: never
          f_playoff?: never
          f_prev?: never
          f_rebound?: never
          f_royal_road?: never
          f_rush?: never
          f_score_diff?: never
          f_sec_elapsed?: number | null
          f_sec_prev?: never
          f_strength?: never
          f_type?: never
          f_x?: number | null
          f_yabs?: never
          game_date?: string | null
          game_id?: number | null
          game_type?: string | null
          goalie_id?: number | null
          is_goal?: boolean | null
          is_home?: boolean | null
          opp_goalie?: number | null
          opp_skaters?: number | null
          own_goalie?: number | null
          own_skaters?: number | null
          season?: number | null
          shooter_id?: number | null
          strength_source?: string | null
          team_id?: number | null
        }
        Relationships: []
      }
      nhl_shot_fold: {
        Row: {
          event_id: number | null
          fold_id: number | null
          game_id: number | null
        }
        Insert: {
          event_id?: number | null
          fold_id?: never
          game_id?: number | null
        }
        Update: {
          event_id?: number | null
          fold_id?: never
          game_id?: number | null
        }
        Relationships: []
      }
      nhl_xg_sql_keys: {
        Row: {
          ab: number | null
          ctx: number | null
          db: number | null
          dbc: number | null
          event_id: number | null
          f_ang: number | null
          f_behind_net: boolean | null
          f_dist: number | null
          f_dist_prev: number | null
          f_en_against: boolean | null
          f_en_for: boolean | null
          f_penalty_shot: boolean | null
          f_period: number | null
          f_playoff: boolean | null
          f_prev: string | null
          f_rebound: boolean | null
          f_royal_road: boolean | null
          f_rush: boolean | null
          f_score_diff: number | null
          f_sec_elapsed: number | null
          f_sec_prev: number | null
          f_strength: string | null
          f_type: string | null
          f_x: number | null
          f_yabs: number | null
          game_date: string | null
          game_id: number | null
          game_type: string | null
          goalie_id: number | null
          is_goal: boolean | null
          is_home: boolean | null
          k1: string | null
          k2: string | null
          k3: string | null
          k4: string | null
          k5: string | null
          opp_goalie: number | null
          opp_skaters: number | null
          own_goalie: number | null
          own_skaters: number | null
          psb: number | null
          rr: number | null
          season: number | null
          shooter_id: number | null
          strc: number | null
          strength_source: string | null
          t3a: number | null
          t3d: number | null
          team_id: number | null
        }
        Relationships: []
      }
      nhl_xg_sql_keys_exp: {
        Row: {
          a1: string | null
          a2: string | null
          a3: string | null
          a4: string | null
          a5: string | null
          ab: number | null
          b1: string | null
          b2: string | null
          b3: string | null
          b4: string | null
          b5: string | null
          ctx: number | null
          ctx2: number | null
          ctx3: number | null
          db: number | null
          dbc: number | null
          event_id: number | null
          f_ang: number | null
          f_behind_net: boolean | null
          f_dist: number | null
          f_dist_prev: number | null
          f_en_against: boolean | null
          f_en_for: boolean | null
          f_penalty_shot: boolean | null
          f_period: number | null
          f_playoff: boolean | null
          f_prev: string | null
          f_rebound: boolean | null
          f_royal_road: boolean | null
          f_rush: boolean | null
          f_score_diff: number | null
          f_sec_elapsed: number | null
          f_sec_prev: number | null
          f_strength: string | null
          f_type: string | null
          f_x: number | null
          f_yabs: number | null
          game_date: string | null
          game_id: number | null
          game_type: string | null
          goalie_id: number | null
          is_goal: boolean | null
          is_home: boolean | null
          k1: string | null
          k2: string | null
          k3: string | null
          k4: string | null
          k5: string | null
          opp_goalie: number | null
          opp_skaters: number | null
          own_goalie: number | null
          own_skaters: number | null
          psb: number | null
          rr: number | null
          season: number | null
          shooter_id: number | null
          spd_fps: number | null
          strc: number | null
          strength_source: string | null
          t3a: number | null
          t3d: number | null
          team_id: number | null
          x1: string | null
          x2: string | null
          x3: string | null
          x4: string | null
          x5: string | null
        }
        Relationships: []
      }
      player_career_totals: {
        Row: {
          assists: number | null
          blocks: number | null
          first_season: number | null
          full_name: string | null
          game_type: string | null
          games_played: number | null
          giveaways: number | null
          goalie_games: number | null
          goals: number | null
          goals_against: number | null
          gw_goals: number | null
          headshot_url: string | null
          hits: number | null
          is_goalie: boolean | null
          last_season: number | null
          last_team: string | null
          losses: number | null
          ot_goals: number | null
          ot_losses: number | null
          pim: number | null
          player_id: number | null
          plus_minus: number | null
          points: number | null
          points_per_game: number | null
          position_code: string | null
          pp_goals: number | null
          pp_points: number | null
          primary_assists: number | null
          save_pct: number | null
          saves: number | null
          seasons: number | null
          secondary_assists: number | null
          sh_goals: number | null
          sh_points: number | null
          shooting_pct: number | null
          shots_faced: number | null
          shots_on_goal: number | null
          shutouts: number | null
          takeaways: number | null
          toi_seconds: number | null
          wins: number | null
        }
        Relationships: []
      }
      player_gar_inputs: {
        Row: {
          evd_xga60: number | null
          evd_xga60_unadj: number | null
          evo_xgf60: number | null
          evo_xgf60_unadj: number | null
          ga_5v5: number | null
          games: number | null
          gf_5v5: number | null
          minors_drawn: number | null
          minors_taken: number | null
          pen_net60: number | null
          player_id: number | null
          ppd_xga60: number | null
          ppo_xgf60: number | null
          season: number | null
          toi_5v5_minutes: number | null
          toi_pk_minutes: number | null
          toi_pp_minutes: number | null
          toi_total_minutes: number | null
        }
        Relationships: []
      }
      player_gar_inputs_by_type: {
        Row: {
          evd_xga60: number | null
          evd_xga60_unadj: number | null
          evo_xgf60: number | null
          evo_xgf60_unadj: number | null
          ga_5v5: number | null
          game_type: number | null
          games: number | null
          gf_5v5: number | null
          minors_drawn: number | null
          minors_taken: number | null
          pen_net60: number | null
          player_id: number | null
          ppd_xga60: number | null
          ppo_xgf60: number | null
          season: number | null
          toi_5v5_minutes: number | null
          toi_pk_minutes: number | null
          toi_pp_minutes: number | null
          toi_total_minutes: number | null
        }
        Relationships: []
      }
      player_season_totals: {
        Row: {
          assists: number | null
          blocks: number | null
          full_name: string | null
          gaa: number | null
          game_type: string | null
          games_played: number | null
          giveaways: number | null
          goalie_games: number | null
          goals: number | null
          goals_against: number | null
          gw_goals: number | null
          headshot_url: string | null
          hits: number | null
          is_goalie: boolean | null
          last_game_date: string | null
          losses: number | null
          ot_goals: number | null
          ot_losses: number | null
          pim: number | null
          player_id: number | null
          plus_minus: number | null
          points: number | null
          position_code: string | null
          pp_goals: number | null
          pp_points: number | null
          primary_assists: number | null
          save_pct: number | null
          saves: number | null
          season: number | null
          secondary_assists: number | null
          sh_goals: number | null
          sh_points: number | null
          shifts: number | null
          shooting_pct: number | null
          shots_faced: number | null
          shots_on_goal: number | null
          shutouts: number | null
          takeaways: number | null
          team_abbrev: string | null
          toi_per_game_min: number | null
          toi_seconds: number | null
          wins: number | null
        }
        Relationships: []
      }
      player_toi_by_situation: {
        Row: {
          created_at: string | null
          game_id: number | null
          player_id: number | null
          season: number | null
          situation: string | null
          toi_seconds: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          game_id?: number | null
          player_id?: number | null
          season?: number | null
          situation?: string | null
          toi_seconds?: never
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          game_id?: number | null
          player_id?: number | null
          season?: number | null
          situation?: string | null
          toi_seconds?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      v_player_game_stat_long: {
        Row: {
          game_date: string | null
          game_id: number | null
          is_goalie: boolean | null
          player_id: number | null
          stat_key: string | null
          value: number | null
        }
        Relationships: []
      }
      xg_model_coverage: {
        Row: {
          calibration: number | null
          scored_by_our_model: number | null
          season: number | null
          shots: number | null
          unscored: number | null
          with_moat_features: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      advance_playoff_round: { Args: { p_bracket_id: string }; Returns: Json }
      aggregate_player_playoff_stats: {
        Args: { p_season: number }
        Returns: number
      }
      aggregate_player_playoff_stats_live: {
        Args: { p_season: number }
        Returns: number
      }
      append_draft_event: {
        Args: {
          p_actor: Json
          p_correlation_id: string
          p_event_type: string
          p_idempotency_key: string
          p_league_id: string
          p_payload: Json
          p_payload_hash: string
        }
        Returns: Json
      }
      apply_rink_adjustment: { Args: { p_season: number }; Returns: number }
      apply_rink_adjustment_live: {
        Args: { p_season: number }
        Returns: number
      }
      auction_commissioner_override_v2: {
        Args: {
          p_action_payload: Json
          p_actor: Json
          p_idempotency_key: string
          p_league_id: string
          p_override_action: string
          p_rationale: string
        }
        Returns: Json
      }
      auction_nomination_skip_v2: {
        Args: {
          p_actor: Json
          p_idempotency_key: string
          p_league_id: string
          p_reason: string
          p_team_id: string
        }
        Returns: Json
      }
      auction_pause_v2: {
        Args: {
          p_actor: Json
          p_idempotency_key: string
          p_league_id: string
          p_reason: string
        }
        Returns: Json
      }
      auction_resume_v2: {
        Args: { p_actor: Json; p_idempotency_key: string; p_league_id: string }
        Returns: Json
      }
      auto_advance_playoff_rounds: { Args: never; Returns: Json }
      auto_complete_matchups: {
        Args: never
        Returns: {
          updated_count: number
        }[]
      }
      auto_fix_integrity_issues: {
        Args: never
        Returns: {
          fix_applied: string
          players_restored: number
          teams_affected: number
        }[]
      }
      auto_generate_playoff_bracket: {
        Args: { p_league_id: string }
        Returns: Json
      }
      autopick_next_player: {
        Args: {
          p_draft_session_id: string
          p_league_id: string
          p_pick_number: number
          p_round_number: number
          p_team_id: string
        }
        Returns: {
          pick_id: string
          picked_player_id: number
          player_name: string
          position: string
        }[]
      }
      backtest_inseason_weight: {
        Args: {
          p_asof: string
          p_min_holdout_gp?: number
          p_season: number
          p_w: number
        }
        Returns: {
          corr: number
          mae: number
          mean_actual: number
          mean_pred: number
          n_players: number
          rmse: number
        }[]
      }
      backup_team_lineups: {
        Args: { p_backup_name?: string; p_notes?: string }
        Returns: string
      }
      build_xg_exp2: {
        Args: {
          p_m?: number
          p_pfx: string
          p_season_hi: number
          p_season_lo: number
          p_slot: number
        }
        Returns: number
      }
      build_xg_sql_fold: {
        Args: { p_m?: number; p_score_fold: number }
        Returns: {
          o_cells: number
          o_lvl: number
        }[]
      }
      build_xg_sql_slot: {
        Args: {
          p_hi?: number
          p_lo?: number
          p_m?: number
          p_mode: string
          p_slot: number
        }
        Returns: number
      }
      build_xg_sql_variant: {
        Args: {
          p_m?: number
          p_season_hi: number
          p_season_lo: number
          p_slot: number
        }
        Returns: number
      }
      calculate_daily_matchup_scores: {
        Args: {
          p_matchup_id: string
          p_team_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: {
          daily_score: number
          roster_date: string
        }[]
      }
      calculate_daily_matchup_scores_v2: {
        Args: {
          p_matchup_id: string
          p_team_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: {
          daily_score: number
          roster_date: string
        }[]
      }
      calculate_h2h_category_matchup: {
        Args: {
          p_categories: string[]
          p_league_id: string
          p_matchup_id: string
          p_team1_id: string
          p_team2_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: {
          category: string
          team1_value: number
          team2_value: number
          winner: string
        }[]
      }
      calculate_implied_probability: {
        Args: { moneyline: number }
        Returns: number
      }
      calculate_matchup_total_score: {
        Args: {
          p_matchup_id: string
          p_team_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: number
      }
      calculate_ppg_standings: {
        Args: { p_league_id: string; p_through_week?: number }
        Returns: {
          games_played: number
          ppg: number
          rank: number
          team_id: string
          team_name: string
          total_points: number
        }[]
      }
      calculate_roto_standings: {
        Args: {
          p_categories: string[]
          p_league_id: string
          p_through_week?: number
        }
        Returns: {
          category_name: string
          category_rank: number
          roto_points: number
          stat_value: number
          team_id: string
          team_name: string
        }[]
      }
      can_insert_team: { Args: { p_league_id: string }; Returns: boolean }
      check_audit_trail_integrity: {
        Args: { p_days?: number }
        Returns: {
          detail: string
          problem: string
          severity: string
        }[]
      }
      check_boxscore_reconciliation: {
        Args: { p_season: number }
        Returns: {
          net_delta: number
          rows_compared: number
          rows_disagreeing: number
          severity: string
          stat: string
        }[]
      }
      check_cron_job_health: {
        Args: { p_hours?: number }
        Returns: {
          failed_runs: number
          issue: string
          jobname: string
          last_failure: string
          last_message: string
          severity: string
        }[]
      }
      check_data_integrity: {
        Args: never
        Returns: {
          affected_teams: string[]
          check_name: string
          details: string
          status: string
        }[]
      }
      check_data_integrity_check1_scope: {
        Args: never
        Returns: {
          detail: string
          draft_count: number
          lineup_count: number
          missing_lineup_row: boolean
          team_id: string
          team_name: string
        }[]
      }
      check_data_integrity_check2_scope: {
        Args: never
        Returns: {
          actual: number
          expected: number
          team_id: string
          team_name: string
        }[]
      }
      check_matchup_score_calibration: {
        Args: never
        Returns: {
          calc_t1: number
          calc_t2: number
          matchup_id: string
          severity: string
          stored_t1: number
          stored_t2: number
        }[]
      }
      check_monitor_liveness: {
        Args: never
        Returns: {
          expected: string
          hours_quiet: number
          last_seen: string
          monitor: string
          severity: string
        }[]
      }
      check_pipeline_coverage: {
        Args: never
        Returns: {
          detail: string
          game_type: string
          games_affected: number
          layer: string
          severity: string
        }[]
      }
      check_player_directory_freshness: {
        Args: never
        Returns: {
          detail: string
          problem: string
          severity: string
          target_season: number
        }[]
      }
      check_pool_scoring_integrity: {
        Args: { p_grace_days?: number }
        Returns: {
          expected: string
          issue: string
          metric: string
          scope: string
          severity: string
          value: number
        }[]
      }
      check_scoring_config_divergence: {
        Args: never
        Returns: {
          effective_value: number
          jsonb_value: number
          league_id: string
          league_name: string
          severity: string
          stat_key: string
        }[]
      }
      check_season_boundary: {
        Args: { p_horizon_days?: number }
        Returns: {
          detail: string
          problem: string
          severity: string
        }[]
      }
      check_security_drift: {
        Args: never
        Returns: {
          issue: string
          object_name: string
          object_type: string
          severity: string
        }[]
      }
      check_stat_column_parity: {
        Args: never
        Returns: {
          net_delta: number
          rows_disagreeing: number
          severity: string
          stat: string
        }[]
      }
      check_stats_layer_freshness: {
        Args: never
        Returns: {
          detail: string
          layer: string
          severity: string
        }[]
      }
      check_waiver_priority_integrity: {
        Args: never
        Returns: {
          detail: string
          league_id: string
          league_name: string
          problem: string
          severity: string
        }[]
      }
      check_weekly_stats_vs_source: {
        Args: never
        Returns: {
          delta: number
          severity: string
          source: number
          stat: string
          stored: number
          week_number: number
        }[]
      }
      check_xg_chain_integrity: {
        Args: never
        Returns: {
          expected: string
          issue: string
          metric: string
          season: number
          severity: string
          value: number
        }[]
      }
      check_xg_integrity: {
        Args: never
        Returns: {
          expected: string
          issue: string
          metric: string
          season: number
          severity: string
          value: number
        }[]
      }
      check_xg_integrity_v2: {
        Args: never
        Returns: {
          expected: string
          issue: string
          metric: string
          season: number
          severity: string
          value: number
        }[]
      }
      citrus_apply_rebounds_batch: {
        Args: { p_batch?: number }
        Returns: {
          changed: number
          next_after: number
          processed: number
          remaining: number
        }[]
      }
      citrus_apply_xg_scores: { Args: { p_scores: Json }; Returns: number }
      citrus_backfill_shot_fields: {
        Args: { p_batch?: number }
        Returns: {
          changed: number
          next_after: number
          processed: number
          remaining: number
        }[]
      }
      citrus_bingo_actors: {
        Args: { p_game_id: number }
        Returns: {
          player_id: number
          secs: number
          shown: string
          so: number
          stat: string
        }[]
      }
      citrus_bingo_build_hits: {
        Args: {
          p_from_game: number
          p_limit?: number
          p_rebuild?: boolean
          p_team: number
          p_to_game: number
        }
        Returns: number
      }
      citrus_bingo_build_player_stats: {
        Args: {
          p_from_game: number
          p_limit?: number
          p_team: number
          p_to_game: number
        }
        Returns: number
      }
      citrus_bingo_card_state: {
        Args: { p_card_id: string }
        Returns: {
          headshot_url: string
          hit_at: string
          hit_rate: number
          hit_seconds: number
          label: string
          marked: boolean
          player_id: number
          pos: number
        }[]
      }
      citrus_bingo_evaluate: {
        Args: { p_focus_team: number; p_game_id: number }
        Returns: {
          hit_at: string
          hit_seconds: number
          label: string
          square_id: string
        }[]
      }
      citrus_bingo_generate_player_squares: {
        Args: { p_min_games?: number; p_per_band_cap?: number; p_team: number }
        Returns: {
          created: number
          retired: number
        }[]
      }
      citrus_bingo_lines: {
        Args: { p_card_id: string }
        Returns: {
          complete: boolean
          line: string
          marked_count: number
        }[]
      }
      citrus_bingo_new_card: {
        Args: { p_focus_team: number; p_game_id: number; p_user_id?: string }
        Returns: string
      }
      citrus_bingo_pool: {
        Args: { p_team: number }
        Returns: {
          band: number
          hit_rate: number
          player_id: number
          square_id: string
        }[]
      }
      citrus_bingo_recalibrate: {
        Args: { p_team: number }
        Returns: {
          games: number
          squares: number
        }[]
      }
      citrus_bingo_roster: {
        Args: { p_game_id: number }
        Returns: {
          first_name: string
          last_name: string
          player_id: number
          position_code: string
          sweater: number
          team_id: number
        }[]
      }
      citrus_bingo_sim_rows: {
        Args: {
          p_cards?: number
          p_easy?: number
          p_hard?: number
          p_long?: number
          p_mid?: number
          p_near?: number
          p_team: number
        }
        Returns: {
          card_no: number
          first_line_at: number
          game_id: number
          lines_done: number
          n_marked: number
        }[]
      }
      citrus_bingo_simulate: {
        Args: {
          p_cards?: number
          p_easy?: number
          p_hard?: number
          p_long?: number
          p_mid?: number
          p_near?: number
          p_team: number
        }
        Returns: {
          avg_marked: number
          cards: number
          games: number
          games_all_won: number
          games_nobody_won: number
          median_line_at: string
          pct_any_line: number
          pct_blackout: number
          pct_line_in_p1: number
          pct_line_in_p3ot: number
          pct_two_plus: number
        }[]
      }
      citrus_bingo_simulate_current: {
        Args: { p_cards?: number; p_team: number }
        Returns: {
          avg_marked: number
          cards: number
          games: number
          games_all_won: number
          games_nobody_won: number
          median_line_at: string
          pct_any_line: number
          pct_blackout: number
          pct_line_in_p1: number
          pct_line_in_p3ot: number
          pct_two_plus: number
        }[]
      }
      citrus_build_onice_batch: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
        }[]
      }
      citrus_build_penalties_batch: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
        }[]
      }
      citrus_build_strength_batch: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
        }[]
      }
      citrus_build_toi_batch: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
        }[]
      }
      citrus_confirm_league_history: {
        Args: { p_league_id: string; p_seasons?: number[] }
        Returns: number
      }
      citrus_data_invariants: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_derive_rebounds_batch: {
        Args: { p_games?: number }
        Returns: {
          games_done: number
          remaining: number
          rows_written: number
        }[]
      }
      citrus_disk_invariants: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_draft_kit_tier: { Args: never; Returns: string }
      citrus_feature_provenance: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_finalize_contest: {
        Args: { p_contest_id: string }
        Returns: number
      }
      citrus_fit_moat_rows: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
        }[]
      }
      citrus_fit_xg_v5_cells: {
        Args: { p_k?: number }
        Returns: {
          detail: string
          level: string
          rows_written: number
        }[]
      }
      citrus_fit_xg_v5_era: {
        Args: { p_exclude_seasons?: number[]; p_k?: number }
        Returns: {
          out_expected: number
          out_goals: number
          out_is_rebound: boolean
          out_mult: number
          out_n: number
          out_season: number
        }[]
      }
      citrus_fit_xg_v5_moat: {
        Args: { p_k?: number }
        Returns: {
          bucket: number
          expected: number
          goals: number
          mult: number
          n: number
        }[]
      }
      citrus_fit_xg_v5_shape: {
        Args: { p_bands?: number; p_k?: number }
        Returns: {
          out_band: number
          out_expected: number
          out_goals: number
          out_hi: number
          out_lo: number
          out_mult: number
          out_n: number
        }[]
      }
      citrus_flurry_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_game_leaderboard: {
        Args: { p_contest_id: string }
        Returns: {
          detail: Json
          is_final: boolean
          rank: number
          score: number
          team_id: string
          team_name: string
          user_id: string
        }[]
      }
      citrus_game_rosters: {
        Args: { p_games: number[] }
        Returns: {
          game_id: number
          is_home: boolean
          last_name: string
          player_id: number
          sweater_number: number
          team_id: number
        }[]
      }
      citrus_game_type: { Args: { p_game_id: number }; Returns: number }
      citrus_gar_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_global_game_standings: {
        Args: { p_game_code?: string; p_limit?: number }
        Returns: {
          best_score: number
          contests: number
          rank: number
          total_score: number
          user_id: string
          wins: number
        }[]
      }
      citrus_goals_per_minor: { Args: never; Returns: number }
      citrus_import_league_history: {
        Args: { p_league_id: string; p_platform: string; p_rows: Json }
        Returns: {
          identities_from_team_name: number
          members_created: number
          rows_deduped: number
          seasons_written: number
          teams_written: number
        }[]
      }
      citrus_ingest_quality_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_join_contest: {
        Args: { p_contest_id: string; p_team_id?: string }
        Returns: string
      }
      citrus_league_game_standings: {
        Args: { p_game_code?: string; p_league_id: string }
        Returns: {
          best_score: number
          contests: number
          rank: number
          team_id: string
          team_name: string
          total_score: number
          user_id: string
          wins: number
        }[]
      }
      citrus_leakage_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_mark_history_ready: {
        Args: { p_note?: string; p_request_id: string }
        Returns: string
      }
      citrus_merge_league_members: {
        Args: { p_keep_id: string; p_league_id: string; p_merge_ids: string[] }
        Returns: {
          members_removed: number
          seasons_moved: number
        }[]
      }
      citrus_model_invariants: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_moneypuck_separation: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_norm_name: { Args: { p: string }; Returns: string }
      citrus_open_contest: {
        Args: {
          p_focus_team: number
          p_game_code: string
          p_league_id?: string
          p_nhl_game_id: number
          p_title?: string
        }
        Returns: string
      }
      citrus_preview_league_history: {
        Args: { p_league_id: string; p_rows: Json }
        Returns: {
          check_name: string
          detail: string
          status: string
        }[]
      }
      citrus_prune_derived_shifts: {
        Args: { p_batch?: number; p_keep_seasons?: number[] }
        Returns: {
          games_pruned: number
          games_remaining: number
          rows_deleted: number
        }[]
      }
      citrus_rebound_window: { Args: { p_season: number }; Returns: number }
      citrus_rebuild_gar_components:
        | {
            Args: {
              p_allow_uncalibrated?: boolean
              p_min_toi?: number
              p_rp_pct?: number
              p_seasons?: number[]
            }
            Returns: {
              out_avg_gar60: number
              out_note: string
              out_players: number
              out_rp_evd: number
              out_rp_evo: number
              out_rp_pen: number
              out_rp_ppd: number
              out_rp_ppo: number
              out_season: number
            }[]
          }
        | {
            Args: {
              p_allow_uncalibrated?: boolean
              p_min_st_toi?: number
              p_min_toi?: number
              p_rp_pct?: number
              p_seasons?: number[]
            }
            Returns: {
              out_avg_gar60: number
              out_note: string
              out_players: number
              out_rp_evd: number
              out_rp_evo: number
              out_rp_pen: number
              out_rp_ppd: number
              out_rp_ppo: number
              out_season: number
            }[]
          }
      citrus_recompute_gar_totals: {
        Args: never
        Returns: {
          out_avg_total_gar: number
          out_avg_total_gar60: number
          out_gpm: number
          out_players: number
          out_pp_share_pct: number
          out_season: number
        }[]
      }
      citrus_relink_orphan_shots_batch: {
        Args: { p_games?: number }
        Returns: {
          games_done: number
          ids_recovered: number
          remaining: number
          sit_recovered: number
        }[]
      }
      citrus_relink_orphan_shots_pass2: {
        Args: { p_games?: number }
        Returns: {
          games_done: number
          paired: number
          remaining: number
          surplus_left: number
        }[]
      }
      citrus_rename_league_member: {
        Args: { p_league_id: string; p_member_id: string; p_name: string }
        Returns: string
      }
      citrus_repair_shift_clocks: {
        Args: { p_tolerance?: number }
        Returns: {
          out_games: number
          out_pattern: string
          out_repaired: number
        }[]
      }
      citrus_repair_shift_durations: {
        Args: never
        Returns: {
          game_id: number
          new_duration: number
          old_duration: number
          player_id: number
          shift_id: number
        }[]
      }
      citrus_request_league_history: {
        Args: {
          p_league_id: string
          p_note?: string
          p_screenshots?: string[]
          p_source?: string
        }
        Returns: string
      }
      citrus_rescore_agrees: {
        Args: { p_sample?: number }
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_rescore_v5_batch: {
        Args: { p_after?: number; p_batch?: number }
        Returns: {
          changed: number
          next_after: number
          processed: number
          remaining: number
        }[]
      }
      citrus_restore_shot_event_fields: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
          teams_set: number
          times_set: number
        }[]
      }
      citrus_score_bingo_entry: {
        Args: { p_entry_id: string }
        Returns: {
          detail: Json
          score: number
        }[]
      }
      citrus_score_honest_xg_batch: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
        }[]
      }
      citrus_score_v5_batch: {
        Args: { p_batch?: number }
        Returns: {
          processed: number
          remaining: number
        }[]
      }
      citrus_season_type_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_set_league_champions: {
        Args: { p_league_id: string; p_rows: Json }
        Returns: {
          members_created: number
          seasons_written: number
        }[]
      }
      citrus_shift_duration_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_shot_field_coverage: {
        Args: never
        Returns: {
          attributable_pct: number
          has_situation: number
          has_team: number
          has_time: number
          season: number
          shots: number
        }[]
      }
      citrus_shot_strength_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_xg: {
        Args: { p_honest: number; p_legacy: number; p_v5: number }
        Returns: number
      }
      citrus_xg_coverage_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      citrus_xg_shape_invariant: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          measured: string
          status: string
          threshold: string
        }[]
      }
      cleanup_expired_draft_reservations: { Args: never; Returns: number }
      cleanup_old_audit_logs: {
        Args: { p_retention_days?: number }
        Returns: number
      }
      cleanup_old_backups: {
        Args: { p_days_to_keep?: number }
        Returns: number
      }
      cleanup_old_join_attempts: { Args: never; Returns: undefined }
      close_nomination_v2: {
        Args: {
          p_actor: Json
          p_correlation_id: string
          p_idempotency_key: string
          p_league_id: string
          p_nomination_id: string
          p_payload_hash: string
        }
        Returns: Json
      }
      complete_draft_and_sync: {
        Args: {
          p_draft_session_id: string
          p_league_id: string
          p_teams_count: number
        }
        Returns: Json
      }
      compute_min_next_bid: {
        Args: { p_leading_bid: number; p_tier_table: Json }
        Returns: number
      }
      confirm_draft_pick: {
        Args: {
          p_draft_session_id: string
          p_league_id: string
          p_pick_number: number
          p_player_id: string
          p_round_number: number
          p_team_id: string
          p_user_id: string
        }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      create_waiver_priority_for_team: {
        Args: { p_league_id: string; p_team_id: string }
        Returns: {
          error_message: string
          priority: number
          success: boolean
        }[]
      }
      cron_schedule_grace: { Args: { p_schedule: string }; Returns: string }
      delete_user_account: { Args: never; Returns: Json }
      derive_season_from_date: { Args: { game_date: string }; Returns: number }
      derive_season_from_game_id: { Args: { game_id: number }; Returns: number }
      detect_security_anomalies: {
        Args: never
        Returns: {
          anomaly_type: string
          details: string
          detected_at: string
          severity: string
          user_id: string
        }[]
      }
      draft_autopick_archive: { Args: { p_msg_id: number }; Returns: boolean }
      draft_autopick_dlq: {
        Args: {
          p_correlation_id?: string
          p_last_error: string
          p_league_id: string
          p_payload: Json
          p_pgmq_msg_id: number
          p_read_ct: number
        }
        Returns: Json
      }
      draft_autopick_read: {
        Args: { p_qty?: number; p_vt?: number }
        Returns: {
          enqueued_at: string
          message: Json
          msg_id: number
          read_ct: number
          vt: string
        }[]
      }
      draft_deadline_sweep: { Args: never; Returns: number }
      draft_extend: {
        Args: { p_actor: Json; p_extra_seconds: number; p_league_id: string }
        Returns: Json
      }
      draft_freeze_blockers: {
        Args: { p_live_hours?: number; p_upcoming_hours?: number }
        Returns: {
          at_time: string
          league_id: string
          league_name: string
          reason: string
        }[]
      }
      draft_pause: {
        Args: { p_actor: Json; p_league_id: string }
        Returns: Json
      }
      draft_resume: {
        Args: { p_actor: Json; p_league_id: string }
        Returns: Json
      }
      enrich_pbp_season: {
        Args: { p_season: number }
        Returns: {
          goals_seen: number
          rows_updated: number
        }[]
      }
      eval_xg_exp2: {
        Args: { p_pfx: string; p_season: number; p_slot: number }
        Returns: {
          auc: number
          calibration: number
          goals: number
          shots: number
        }[]
      }
      eval_xg_slot: {
        Args: { p_season: number; p_slot: number }
        Returns: {
          auc: number
          cal_ratio: number
          goals: number
          n: number
        }[]
      }
      execute_trade: {
        Args: {
          p_from_team_id: string
          p_league_id: string
          p_offered_player_ids: string[]
          p_requested_player_ids: string[]
          p_to_team_id: string
          p_trade_id: string
        }
        Returns: Json
      }
      expire_stale_trade_offers: { Args: never; Returns: Json }
      export_user_data: { Args: never; Returns: Json }
      extract_shots_season: {
        Args: { p_season: number }
        Returns: {
          games: number
          goals: number
          shots: number
        }[]
      }
      fix_goalie_assists_season: {
        Args: { p_season: number }
        Returns: {
          assists_recovered: number
          rows_fixed: number
        }[]
      }
      fix_goalie_decisions_season: {
        Args: { p_season: number }
        Returns: {
          changed: number
          games: number
        }[]
      }
      games_missing_shifts: {
        Args: { p_season?: number }
        Returns: {
          game_id: number
        }[]
      }
      games_needing_shifts:
        | {
            Args: { p_season?: number }
            Returns: {
              game_id: number
              reason: string
            }[]
          }
        | {
            Args: { p_after?: number; p_limit?: number; p_season?: number }
            Returns: {
              game_id: number
              reason: string
            }[]
          }
      games_needing_shifts_count: {
        Args: { p_season?: number }
        Returns: number
      }
      gate_assist_split: { Args: { p_season: number }; Returns: string }
      generate_join_code: { Args: never; Returns: string }
      generate_playoff_bracket: {
        Args: {
          p_consolation_enabled?: boolean
          p_league_id: string
          p_reseed_each_round?: boolean
          p_seeding_method?: string
          p_two_week_matchups?: boolean
        }
        Returns: Json
      }
      get_age_multiplier: { Args: { p_age: number }; Returns: number }
      get_canonical_team_code: {
        Args: { p_team_code: string }
        Returns: string
      }
      get_current_pool_week: {
        Args: { p_on?: string; p_season?: number }
        Returns: number
      }
      get_current_season: { Args: { p_on?: string }; Returns: number }
      get_daily_game_stats: {
        Args: { p_game_date: string; p_player_ids: number[] }
        Returns: {
          assists: number
          blocks: number
          even_saves: number
          even_shots_against: number
          faceoff_losses: number
          faceoff_taken: number
          faceoff_wins: number
          game_id: number
          giveaways: number
          goals: number
          goals_against: number
          gwg: number
          hits: number
          is_goalie: boolean
          losses: number
          ot_losses: number
          otg: number
          pim: number
          player_id: number
          plus_minus: number
          points: number
          pp_saves: number
          pp_shots_against: number
          ppa: number
          ppg: number
          ppp: number
          save_pct: number
          saves: number
          sh_saves: number
          sh_shots_against: number
          sha: number
          shg: number
          shifts: number
          shot_attempts: number
          shots_blocked: number
          shots_faced: number
          shots_missed: number
          shots_on_goal: number
          shp: number
          shutouts: number
          takeaways: number
          toi_seconds: number
          wins: number
        }[]
      }
      get_daily_lineup: {
        Args: { p_date: string; p_matchup_id: string; p_team_id: string }
        Returns: {
          assists: number
          blocks: number
          daily_points: number
          goals: number
          goals_against: number
          headshot_url: string
          hits: number
          is_goalie: boolean
          is_locked: boolean
          nhl_team: string
          pim: number
          player_id: number
          player_name: string
          player_position: string
          ppp: number
          saves: number
          shots_on_goal: number
          shp: number
          shutouts: number
          slot_id: string
          slot_type: string
          wins: number
        }[]
      }
      get_daily_projections: {
        Args: { p_player_ids: number[]; p_target_date: string }
        Returns: {
          b2b_penalty: number
          base_ppg: number
          calculation_method: string
          confidence_label: string
          confidence_score: number
          dynamic_confidence: number
          finishing_multiplier: number
          game_id: number
          game_start_time: string
          home_away_adjustment: number
          injury_status: string
          is_goalie: boolean
          is_home_game: boolean
          likely_high: number
          likely_low: number
          matchup_difficulty: number
          opponent_abbrev: string
          opponent_adjustment: number
          opponent_team_id: number
          player_id: number
          projected_assists: number
          projected_blocks: number
          projected_gaa: number
          projected_goals: number
          projected_goals_against: number
          projected_gp: number
          projected_hits: number
          projected_pim: number
          projected_ppp: number
          projected_save_pct: number
          projected_saves: number
          projected_shp: number
          projected_shutouts: number
          projected_sog: number
          projected_wins: number
          projected_xg: number
          projection_ci_50_lower: number
          projection_ci_50_upper: number
          projection_ci_lower: number
          projection_ci_upper: number
          projection_date: string
          projection_mean: number
          projection_median: number
          projection_std_dev: number
          season: number
          shrinkage_weight: number
          starter_confirmed: boolean
          total_projected_points: number
        }[]
      }
      get_effective_scoring_rules: {
        Args: { p_league_id: string }
        Returns: {
          multiplier: number
          stat_key: string
        }[]
      }
      get_keeper_draft_costs: {
        Args: { p_league_id: string; p_season_year: number; p_team_id: string }
        Returns: {
          effective_round: number
          keeper_round: number
          original_draft_round: number
          penalty_type: string
          player_id: string
          years_kept: number
        }[]
      }
      get_latest_backup_id: { Args: never; Returns: string }
      get_league_invite_by_id: {
        Args: { p_league_id: string }
        Returns: {
          id: string
          join_code: string
          name: string
          settings: Json
        }[]
      }
      get_league_teams: {
        Args: { p_league_id: string }
        Returns: {
          created_at: string
          id: string
          league_id: string
          owner_id: string
          team_name: string
          updated_at: string
        }[]
      }
      get_matchup_stats: {
        Args: {
          p_end_date: string
          p_player_ids: number[]
          p_start_date: string
        }
        Returns: {
          assists: number
          blocks: number
          goalie_gp: number
          goals: number
          goals_against: number
          hits: number
          pim: number
          player_id: number
          plus_minus: number
          points: number
          ppp: number
          saves: number
          shots_faced: number
          shots_on_goal: number
          shp: number
          shutouts: number
          wins: number
          x_goals: number
        }[]
      }
      get_my_league_ids: { Args: never; Returns: string[] }
      get_nhl_season_year: { Args: { p_date: string }; Returns: number }
      get_player_waiver_clear_time: {
        Args: { p_league_id: string; p_player_id: number }
        Returns: string
      }
      get_playoff_picture: { Args: { p_league_id: string }; Returns: Json }
      get_pool_week_dates: {
        Args: { p_season?: number; p_week_number: number }
        Returns: {
          week_end: string
          week_start: string
        }[]
      }
      get_projection_target_season: { Args: never; Returns: number }
      get_season_game_count: { Args: { p_season: number }; Returns: number }
      get_trending_players: {
        Args: {
          days_back?: number
          limit_count?: number
          position_filter?: string
        }
        Returns: {
          add_count: number
          drop_count: number
          last_added: string
          net_adds: number
          player_id: number
        }[]
      }
      get_user_consent_status: {
        Args: never
        Returns: {
          consented_at: string
          consented_version: string
          policy_type: string
          required_version: string
          status: string
          withdrawn_at: string
        }[]
      }
      get_waiver_processing_status: {
        Args: never
        Returns: {
          last_processed: string
          league_id: string
          league_name: string
          next_process_time: string
          pending_claims: number
        }[]
      }
      heal_directory_for_rostered_players: {
        Args: { p_season: number }
        Returns: number
      }
      initialize_waiver_priority: {
        Args: { p_league_id: string }
        Returns: number
      }
      is_commissioner_of_league: {
        Args: { p_league_id: string }
        Returns: boolean
      }
      is_player_on_waivers: {
        Args: { p_league_id: string; p_player_id: number }
        Returns: boolean
      }
      join_league_with_code: {
        Args: { p_join_code: string; p_team_name?: string; p_user_id?: string }
        Returns: Json
      }
      list_team_lineups_backups: {
        Args: never
        Returns: {
          backup_id: string
          backup_name: string
          created_at: string
          notes: string
          players: number
          teams: number
        }[]
      }
      load_player_names_season: { Args: { p_season: number }; Returns: number }
      lock_keepers_for_season: {
        Args: { p_league_id: string; p_season_year: number }
        Returns: {
          keepers_locked: number
          rounds_consumed: number[]
          team_id: string
        }[]
      }
      log_audit_trail_integrity: { Args: never; Returns: undefined }
      log_boxscore_reconciliation: { Args: never; Returns: undefined }
      log_cron_job_health: { Args: never; Returns: undefined }
      log_function_error: {
        Args: {
          p_context?: string
          p_details?: Json
          p_fn: string
          p_message: string
          p_sqlstate: string
        }
        Returns: undefined
      }
      log_matchup_score_calibration: { Args: never; Returns: undefined }
      log_monitor_liveness: { Args: never; Returns: undefined }
      log_pipeline_coverage: { Args: never; Returns: number }
      log_player_directory_freshness: { Args: never; Returns: undefined }
      log_pool_scoring_integrity: { Args: never; Returns: undefined }
      log_scoring_config_divergence: { Args: never; Returns: undefined }
      log_season_boundary: { Args: never; Returns: undefined }
      log_security_anomalies: { Args: never; Returns: undefined }
      log_security_drift: { Args: never; Returns: number }
      log_security_event: {
        Args: {
          p_details?: Json
          p_event_type: string
          p_league_id?: string
          p_severity?: string
        }
        Returns: string
      }
      log_stat_column_parity: { Args: never; Returns: undefined }
      log_waiver_priority_integrity: { Args: never; Returns: undefined }
      log_weekly_stats_vs_source: { Args: never; Returns: undefined }
      log_xg_chain_integrity: { Args: never; Returns: undefined }
      log_xg_integrity: { Args: never; Returns: number }
      log_xg_integrity_v2: { Args: never; Returns: undefined }
      make_draft_pick: {
        Args: {
          p_draft_session_id: string
          p_league_id: string
          p_pick_number: number
          p_player_id: string
          p_round_number: number
          p_team_id: string
        }
        Returns: string
      }
      manage_draft_metrics_partitions: { Args: never; Returns: Json }
      manual_recover_team: { Args: { p_team_id: string }; Returns: string }
      materialize_scoring_settings: {
        Args: { p_league_id: string }
        Returns: number
      }
      nightly_xg_pipeline: { Args: never; Returns: string }
      nominate_player_v2: {
        Args: {
          p_actor: Json
          p_clock_seconds: number
          p_correlation_id: string
          p_idempotency_key: string
          p_league_id: string
          p_opening_bid: number
          p_payload_hash: string
          p_player_id: string
          p_player_name: string
          p_session_id: string
          p_team_id: string
        }
        Returns: Json
      }
      notify_league_members: {
        Args: {
          p_league_id: string
          p_message: string
          p_notification_type?: string
          p_title: string
        }
        Returns: Json
      }
      nuclear_reset_draft: { Args: { p_league_id: string }; Returns: undefined }
      offline_import_draft_v2: {
        Args: {
          p_actor: Json
          p_allow_partial?: boolean
          p_correlation_id?: string
          p_idempotency_key: string
          p_league_id: string
          p_picks: Json
        }
        Returns: Json
      }
      optimize_best_ball_daily_rosters: {
        Args: { p_league_id: string; p_roster_date: string }
        Returns: {
          players_optimized: number
          team_id: string
          total_points: number
        }[]
      }
      persist_matchup_lines: { Args: { p_matchup_id: string }; Returns: number }
      place_bid_v2: {
        Args: {
          p_actor: Json
          p_anti_snipe_extension_seconds: number
          p_anti_snipe_threshold_seconds: number
          p_bid_amount: number
          p_correlation_id: string
          p_idempotency_key: string
          p_league_id: string
          p_min_bid_increment_tiers: Json
          p_nomination_id: string
          p_payload_hash: string
          p_session_id: string
          p_team_id: string
        }
        Returns: Json
      }
      populate_league_averages: { Args: { p_season: number }; Returns: number }
      populate_player_weekly_stats: {
        Args: {
          p_week_end_date: string
          p_week_number: number
          p_week_start_date: string
        }
        Returns: undefined
      }
      process_all_faab_waivers: {
        Args: never
        Returns: {
          claims_processed: number
          league_id: string
          league_name: string
          status: string
        }[]
      }
      process_all_pending_waivers: {
        Args: never
        Returns: {
          details: Json
          failed: number
          league_id: string
          league_name: string
          successful: number
          total_processed: number
        }[]
      }
      process_expired_trade_reviews: {
        Args: never
        Returns: {
          action: string
          league_id: string
          trade_id: string
        }[]
      }
      process_faab_waivers_for_league: {
        Args: { p_league_id: string }
        Returns: {
          bid_amount: number
          claim_id: string
          failure_reason: string
          player_id: number
          status: string
          team_id: string
        }[]
      }
      process_roster_move: {
        Args: {
          p_add_player_id?: string
          p_drop_player_id?: string
          p_league_id: string
          p_transaction_source?: string
          p_user_id: string
        }
        Returns: Json
      }
      process_waiver_claims: {
        Args: { p_league_id: string }
        Returns: {
          out_claim_id: string
          out_failure_reason: string
          out_player_id: number
          out_status: string
          out_team_id: string
        }[]
      }
      project_ros: {
        Args: { p_season: number }
        Returns: {
          age: number
          exp_gp: number
          exp_starts: number
          is_goalie: boolean
          player_id: number
          position_code: string
          r_a: number
          r_blk: number
          r_ga: number
          r_goal: number
          r_hits: number
          r_pim: number
          r_pm: number
          r_ppp: number
          r_saves: number
          r_shp: number
          r_so: number
          r_sog: number
          r_wins: number
        }[]
      }
      rebuild_goalie_gsax_primary: {
        Args: { p_season?: number }
        Returns: {
          o_count: number
          o_metric: string
        }[]
      }
      rebuild_onice_xg: { Args: { p_games: number[] }; Returns: number }
      rebuild_penalty_events: { Args: { p_games: number[] }; Returns: number }
      rebuild_player_identity: { Args: never; Returns: number }
      rebuild_player_projected_stats: {
        Args: { p_season: number }
        Returns: {
          games: number
          players: number
          rows_written: number
        }[]
      }
      rebuild_player_season_stats: {
        Args: { p_season: number }
        Returns: {
          goalies: number
          rows_written: number
          skaters: number
        }[]
      }
      rebuild_player_talent_metrics: {
        Args: { p_season: number }
        Returns: {
          below_toi_floor: number
          rated: number
          rows_written: number
        }[]
      }
      rebuild_pp_sh_points: {
        Args: { p_season: number }
        Returns: {
          o_count: number
          o_metric: string
        }[]
      }
      rebuild_ros_projections: {
        Args: { p_season: number }
        Returns: {
          goalies: number
          rows_written: number
          skaters: number
          target_games: number
        }[]
      }
      rebuild_strength_intervals: {
        Args: { p_games: number[] }
        Returns: number
      }
      rebuild_toi_by_state: { Args: { p_games: number[] }; Returns: number }
      recalculate_reverse_standings_priority: {
        Args: { p_league_id: string }
        Returns: undefined
      }
      reconcile_pp_goals_with_boxscore: {
        Args: never
        Returns: {
          o_count: number
          o_metric: string
        }[]
      }
      reconstruct_draft_state: { Args: { p_league_id: string }; Returns: Json }
      record_player_transaction: {
        Args: {
          p_league_id: string
          p_player_id: number
          p_player_name?: string
          p_player_position?: string
          p_player_team?: string
          p_source?: string
          p_team_id: string
          p_transaction_type: string
        }
        Returns: string
      }
      record_rebuild_audit: {
        Args: {
          p_actual: number
          p_expected: number
          p_gate_name: string
          p_note?: string
          p_season: number
        }
        Returns: string
      }
      record_rebuild_band: {
        Args: {
          p_actual: number
          p_gate_name: string
          p_hi: number
          p_lo: number
          p_note?: string
          p_season: number
        }
        Returns: string
      }
      record_shadow_event: {
        Args: {
          p_correlation_id: string
          p_idempotency_key: string
          p_league_id: string
          p_payload: Json
          p_payload_hash: string
        }
        Returns: Json
      }
      record_shift_quality: { Args: { p_game_id: number }; Returns: string }
      record_user_consent: {
        Args: { p_policy_type: string; p_version: string }
        Returns: string
      }
      refresh_player_rollups: { Args: never; Returns: string }
      refresh_reverse_standings_waiver_order: { Args: never; Returns: Json }
      refresh_xg_season_layer: {
        Args: { p_season: number }
        Returns: {
          o_layer: string
          o_rows: number
        }[]
      }
      renumber_waiver_priority: {
        Args: { p_league_id: string }
        Returns: undefined
      }
      reseed_waiver_priority_for_league: {
        Args: { p_league_id: string }
        Returns: Json
      }
      reserve_draft_pick: {
        Args: {
          p_duration_seconds?: number
          p_league_id: string
          p_player_id: string
          p_user_id: string
        }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      reset_playoff_bracket: { Args: { p_league_id: string }; Returns: Json }
      resolve_pp_goals_by_penalty_window: {
        Args: never
        Returns: {
          o_count: number
          o_metric: string
        }[]
      }
      restore_team_lineups: { Args: { p_backup_id: string }; Returns: number }
      rink_cdf_season_for: {
        Args: { p_home_team: number; p_season: number }
        Returns: number
      }
      run_data_retention: { Args: never; Returns: Json }
      run_full_autopick_draft: {
        Args: { p_league_id: string }
        Returns: {
          pick_number: number
          player_id: number
          player_name: string
          round_number: number
          team_id: string
        }[]
      }
      run_weekly_stats_populate: { Args: { p_anchor: string }; Returns: number }
      score_all_playoff_roster_pools: { Args: never; Returns: number }
      score_all_pools_for_week: {
        Args: { p_week_number: number }
        Returns: {
          league_id: string
          league_name: string
          pool_type: string
          scored_count: number
        }[]
      }
      score_confidence_week: {
        Args: { p_league_id: string; p_week_number: number }
        Returns: {
          confidence_points: number
          game_id: string
          is_correct: boolean
          pick_id: string
          picked_team: string
          points_earned: number
          user_id: string
        }[]
      }
      score_matchup_lines: {
        Args: {
          p_matchup_id: string
          p_team_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: {
          is_goalie: boolean
          player_id: number
          points: number
          roster_date: string
        }[]
      }
      score_pickem_week: {
        Args: { p_league_id: string; p_week_number: number }
        Returns: {
          game_id: string
          is_correct: boolean
          pick_id: string
          picked_team: string
          user_id: string
          winning_team: string
        }[]
      }
      score_playoff_roster_pool: {
        Args: { p_league_id: string }
        Returns: number
      }
      score_playoff_series_picks: {
        Args: { p_series_id: string }
        Returns: {
          picks_scored: number
          standings_updated: number
        }[]
      }
      score_pools_pending: {
        Args: { p_max_weeks?: number }
        Returns: {
          league_id: string
          league_name: string
          pool_type: string
          scored_count: number
          week_number: number
        }[]
      }
      score_survivor_week: {
        Args: { p_league_id: string; p_week_number: number }
        Returns: {
          is_correct: boolean
          picked_team: string
          record: string
          selection_id: string
          user_id: string
        }[]
      }
      score_xg_sql: { Args: { p_season: number }; Returns: number }
      score_xg_sql_v2: { Args: { p_season: number }; Returns: number }
      scoring_rules_to_jsonb: { Args: { p_league_id: string }; Returns: Json }
      seed_faab_budgets_for_league: {
        Args: { p_league_id: string }
        Returns: number
      }
      seed_waiver_priority_for_league: {
        Args: { p_league_id: string }
        Returns: number
      }
      send_league_chat_message: {
        Args: { p_league_id: string; p_message: string; p_sender_name?: string }
        Returns: Json
      }
      set_draft_queue: {
        Args: { p_player_ids: number[]; p_team_id: string }
        Returns: number
      }
      shares_league_with: { Args: { p_user: string }; Returns: boolean }
      should_process_waivers_now: {
        Args: never
        Returns: {
          current_time_est: string
          league_id: string
          league_name: string
          should_process: boolean
          waiver_process_time: string
        }[]
      }
      smart_restore_all_teams: {
        Args: { p_league_id?: string }
        Returns: {
          bench_count: number
          ir_count: number
          starters_count: number
          team_name: string
        }[]
      }
      smart_restore_team_lineups: {
        Args: { p_team_id: string }
        Returns: {
          bench_count: number
          ir_count: number
          message: string
          starters_count: number
          success: boolean
        }[]
      }
      start_draft_v2: {
        Args: {
          p_actor: Json
          p_correlation_id?: string
          p_idempotency_key: string
          p_league_id: string
        }
        Returns: Json
      }
      submit_pick_v2: {
        Args: {
          p_actor: Json
          p_correlation_id: string
          p_idempotency_key: string
          p_league_id: string
          p_payload_hash: string
          p_pick_number: number
          p_player_id: number
          p_round: number
          p_session_id: string
          p_team_id: string
        }
        Returns: Json
      }
      submit_trade_vote: {
        Args: {
          p_trade_offer_id: string
          p_vote: string
          p_voter_team_id: string
        }
        Returns: {
          approve_count: number
          is_vetoed: boolean
          message: string
          success: boolean
          veto_count: number
          votes_needed: number
        }[]
      }
      sync_goalie_decisions: {
        Args: { p_season: number }
        Returns: {
          o_count: number
          o_metric: string
        }[]
      }
      sync_goalie_shutouts: {
        Args: { p_season: number }
        Returns: {
          o_count: number
          o_metric: string
        }[]
      }
      sync_roster_assignments_for_league: {
        Args: { p_league_id: string }
        Returns: Json
      }
      trade_move_player_lineup: {
        Args: {
          p_from_team_id: string
          p_league_id: string
          p_now: string
          p_pid: string
          p_to_team_id: string
        }
        Returns: undefined
      }
      unpack_and_gate_season: { Args: { p_season: number }; Returns: string }
      unpack_boxscore_season: {
        Args: { p_season: number }
        Returns: {
          games_done: number
          rows_written: number
        }[]
      }
      update_all_matchup_scores: {
        Args: { p_league_id?: string }
        Returns: {
          matchup_id: string
          team1_id: string
          team1_score: number
          team2_id: string
          team2_score: number
          updated: boolean
        }[]
      }
      update_playoff_series_from_games: {
        Args: { p_season?: number }
        Returns: number
      }
      user_owns_team_in_league_simple: {
        Args: { p_league_id: string }
        Returns: boolean
      }
      validate_draft_event_payload: {
        Args: { p_event_type: string; p_payload: Json }
        Returns: boolean
      }
      validate_keeper_selections: {
        Args: { p_league_id: string; p_season_year: number; p_team_id: string }
        Returns: {
          error_message: string
          is_valid: boolean
          keepers_count: number
          max_keepers: number
        }[]
      }
      validate_matchup_score: { Args: { p_score: number }; Returns: boolean }
      verify_matchup_scores: {
        Args: { p_matchup_id: string }
        Returns: {
          discrepancy_team1: number
          discrepancy_team2: number
          is_calibrated: boolean
          team1_calculated: number
          team1_stored: number
          team2_calculated: number
          team2_stored: number
        }[]
      }
      withdraw_user_consent: {
        Args: { p_policy_type: string; p_version?: string }
        Returns: Json
      }
      xg_angle_band: { Args: { a: number }; Returns: number }
      xg_dist_band: { Args: { d: number }; Returns: number }
      xg_goalie_move_band: { Args: { p_m: number }; Returns: number }
      xg_honest: {
        Args: {
          p_angle: number
          p_away_sk: number
          p_distance: number
          p_empty_net?: boolean
          p_home_sk: number
          p_is_home: boolean
          p_rebound: boolean
          p_shot_type: string
        }
        Returns: number
      }
      xg_pass_quality_band: { Args: { p_q: number }; Returns: number }
      xg_scorecard: {
        Args: { p_season?: number }
        Returns: {
          auc: number
          calibration: number
          goals: number
          season: number
          shots: number
        }[]
      }
      xg_shot_class: { Args: { p: string }; Returns: string }
      xg_shot_empty_net:
        | {
            Args: { p_is_home: boolean; p_situation_code: string }
            Returns: boolean
          }
        | {
            Args: {
              p_flag?: boolean
              p_is_home: boolean
              p_situation_code: string
            }
            Returns: boolean
          }
      xg_skater_edge: {
        Args: { a: number; h: number; is_home: boolean }
        Returns: number
      }
      xg_v5:
        | {
            Args: {
              p_angle: number
              p_away_sk: number
              p_distance: number
              p_empty_net: boolean
              p_goalie_move: number
              p_has_pass: boolean
              p_home_sk: number
              p_is_home: boolean
              p_pass_quality: number
              p_rebound: boolean
              p_shot_type: string
            }
            Returns: number
          }
        | {
            Args: {
              p_angle: number
              p_away_sk: number
              p_distance: number
              p_empty_net: boolean
              p_goalie_move: number
              p_has_pass: boolean
              p_home_sk: number
              p_is_home: boolean
              p_pass_quality: number
              p_rebound: boolean
              p_season: number
              p_shot_type: string
            }
            Returns: number
          }
        | {
            Args: {
              p_angle: number
              p_away_sk: number
              p_distance: number
              p_empty_net: boolean
              p_game_type: number
              p_goalie_move: number
              p_has_pass: boolean
              p_home_sk: number
              p_is_home: boolean
              p_pass_quality: number
              p_rebound: boolean
              p_season: number
              p_shot_type: string
            }
            Returns: number
          }
      xg_v5_base: {
        Args: {
          p_angle: number
          p_away_sk: number
          p_distance: number
          p_empty_net: boolean
          p_home_sk: number
          p_is_home: boolean
          p_rebound: boolean
          p_shot_type: string
        }
        Returns: number
      }
      xg_v5_era_mult: {
        Args: { p_rebound: boolean; p_season: number }
        Returns: number
      }
      xg_v5_moat_bucket: {
        Args: {
          p_goalie_move: number
          p_has_pass: boolean
          p_pass_quality: number
        }
        Returns: number
      }
      xg_v5_playoff_mult: { Args: { p_game_type: number }; Returns: number }
      xg_v5_shape_mult: {
        Args: { p_empty_net?: boolean; p_raw: number }
        Returns: number
      }
    }
    Enums: {
      draft_status: "not_started" | "queued" | "in_progress" | "completed"
      matchup_status: "scheduled" | "in_progress" | "completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      draft_status: ["not_started", "queued", "in_progress", "completed"],
      matchup_status: ["scheduled", "in_progress", "completed"],
    },
  },
} as const
