-- ============================================================================
-- BACKFILL NHL_PPP AND NHL_SHP FROM COMPONENTS
-- ============================================================================
-- The scraper was extracting nhl_ppg, nhl_ppa, nhl_shg, nhl_sha correctly,
-- but nhl_ppp and nhl_shp were 0 because the API doesn't provide those fields.
-- This migration calculates the totals from the components for all existing records.
-- ============================================================================

-- Update nhl_ppp = nhl_ppg + nhl_ppa for all skater records
UPDATE public.player_game_stats
SET nhl_ppp = nhl_ppg + nhl_ppa
WHERE NOT is_goalie
  AND (nhl_ppg > 0 OR nhl_ppa > 0)
  AND nhl_ppp = 0;  -- Only update if currently 0 (avoid overwriting if already correct)

-- Update nhl_shp = nhl_shg + nhl_sha for all skater records
UPDATE public.player_game_stats
SET nhl_shp = nhl_shg + nhl_sha
WHERE NOT is_goalie
  AND (nhl_shg > 0 OR nhl_sha > 0)
  AND nhl_shp = 0;  -- Only update if currently 0 (avoid overwriting if already correct)

-- Report results
DO $$
DECLARE
  ppp_updated_count INTEGER;
  shp_updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO ppp_updated_count
  FROM public.player_game_stats
  WHERE NOT is_goalie
    AND nhl_ppp = nhl_ppg + nhl_ppa
    AND (nhl_ppg > 0 OR nhl_ppa > 0);
  
  SELECT COUNT(*) INTO shp_updated_count
  FROM public.player_game_stats
  WHERE NOT is_goalie
    AND nhl_shp = nhl_shg + nhl_sha
    AND (nhl_shg > 0 OR nhl_sha > 0);
  
  RAISE NOTICE 'Backfill complete: % records with calculated nhl_ppp, % records with calculated nhl_shp', 
    ppp_updated_count, shp_updated_count;
END $$;






