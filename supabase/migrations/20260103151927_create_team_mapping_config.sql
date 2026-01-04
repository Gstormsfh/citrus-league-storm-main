-- ============================================================================
-- CREATE TEAM MAPPING CONFIGURATION TABLE
-- ============================================================================
-- Stores canonical team mappings for relocated franchises (e.g., ARI/UTA).
-- The Hybrid Cache uses this to treat relocated franchises as a single
-- historical entity, ensuring 10-game rolling windows remain continuous.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.team_mapping_config (
    mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_team_code TEXT NOT NULL,
    aliased_team_codes TEXT[] NOT NULL,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure canonical code is in the aliased array
    CONSTRAINT canonical_in_aliases CHECK (canonical_team_code = ANY(aliased_team_codes))
);

-- Create index on canonical_team_code for fast lookups
CREATE INDEX IF NOT EXISTS idx_team_mapping_canonical ON public.team_mapping_config(canonical_team_code);

-- Create GIN index on aliased_team_codes for array containment queries
CREATE INDEX IF NOT EXISTS idx_team_mapping_aliases ON public.team_mapping_config USING GIN(aliased_team_codes);

-- Create function to get canonical team code
CREATE OR REPLACE FUNCTION public.get_canonical_team_code(p_team_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_canonical TEXT;
BEGIN
    -- Look up the canonical code for this team
    SELECT canonical_team_code
    INTO v_canonical
    FROM public.team_mapping_config
    WHERE p_team_code = ANY(aliased_team_codes)
    ORDER BY effective_date DESC
    LIMIT 1;
    
    -- If no mapping found, return the original code
    RETURN COALESCE(v_canonical, p_team_code);
END;
$$;

-- Insert initial ARI/UTA mapping (Arizona relocated to Utah)
INSERT INTO public.team_mapping_config (
    canonical_team_code,
    aliased_team_codes,
    effective_date,
    notes
) VALUES (
    'ARI',
    ARRAY['ARI', 'UTA'],
    '2024-01-01',  -- Approximate date when mapping became relevant
    'Arizona Coyotes relocated to Utah. Historical data for both codes should be treated as single defensive unit for rolling 10-game calculations.'
)
ON CONFLICT DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE public.team_mapping_config IS 'Maps relocated franchise team codes to canonical codes. Used by Hybrid Cache to ensure continuous rolling windows for team statistics.';
COMMENT ON COLUMN public.team_mapping_config.canonical_team_code IS 'The canonical team code (e.g., "ARI") used for cache lookups';
COMMENT ON COLUMN public.team_mapping_config.aliased_team_codes IS 'Array of all team codes that map to the canonical code (e.g., ["ARI", "UTA"])';
COMMENT ON FUNCTION public.get_canonical_team_code IS 'Returns the canonical team code for a given team code. If no mapping exists, returns the original code.';


