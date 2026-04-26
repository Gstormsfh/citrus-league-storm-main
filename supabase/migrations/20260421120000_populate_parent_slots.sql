-- Populate parent_slot_a / parent_slot_b for the NHL fixed bracket tree.
-- These define which R1 series feed into R2, R2 into R3, etc.
-- Safe to re-run (idempotent UPDATE).

UPDATE public.nhl_playoff_series SET parent_slot_a = 1, parent_slot_b = 2 WHERE bracket_slot = 9;
UPDATE public.nhl_playoff_series SET parent_slot_a = 3, parent_slot_b = 4 WHERE bracket_slot = 10;
UPDATE public.nhl_playoff_series SET parent_slot_a = 5, parent_slot_b = 6 WHERE bracket_slot = 11;
UPDATE public.nhl_playoff_series SET parent_slot_a = 7, parent_slot_b = 8 WHERE bracket_slot = 12;
UPDATE public.nhl_playoff_series SET parent_slot_a = 9, parent_slot_b = 10 WHERE bracket_slot = 13;
UPDATE public.nhl_playoff_series SET parent_slot_a = 11, parent_slot_b = 12 WHERE bracket_slot = 14;
UPDATE public.nhl_playoff_series SET parent_slot_a = 13, parent_slot_b = 14 WHERE bracket_slot = 15;
