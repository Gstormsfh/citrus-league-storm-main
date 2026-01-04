-- ============================================================================
-- FIX PLAYER TALENT METRICS: Make ros_projection_xg nullable
-- ============================================================================
-- The table may have been created previously with ros_projection_xg as NOT NULL.
-- Since this column is not part of the new VOPA system, we make it nullable
-- to allow inserts without providing a value.
-- ============================================================================

-- Make ros_projection_xg nullable if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'player_talent_metrics' 
        AND column_name = 'ros_projection_xg'
    ) THEN
        ALTER TABLE public.player_talent_metrics 
        ALTER COLUMN ros_projection_xg DROP NOT NULL;
        
        RAISE NOTICE 'Made ros_projection_xg nullable';
    ELSE
        RAISE NOTICE 'ros_projection_xg column does not exist, skipping';
    END IF;
END $$;


