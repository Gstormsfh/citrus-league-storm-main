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
