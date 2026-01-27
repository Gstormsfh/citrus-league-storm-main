# Demo League - Quick Reference

## What It Is

A fully functional demo league (`750f4e1a-92ae-44cf-a798-2f3e06d0d5c9`) that showcases the application for non-logged-in users.

## Quick Verification

Run `verify_demo_league_complete.sql` to check:
- ✅ 1 League
- ✅ 10 Teams  
- ✅ 210 Draft Picks
- ✅ 10 Lineups
- ✅ 20 Matchups

## For Guests

- **Visible**: All pages show demo league data
- **Access**: Read-only (cannot modify)
- **Purpose**: Showcase application features

## For Logged-In Users

- **Hidden**: Demo league does NOT appear in league dropdown
- **Isolated**: Completely separate from user leagues

## Files

- `supabase/migrations/20260104000000_allow_public_read_demo_league.sql` - RLS policies
- `supabase/migrations/20260126000001_initialize_demo_league_simple.sql` - Data creation
- `verify_demo_league_complete.sql` - Verification queries

## Documentation

- `DEMO_LEAGUE_SETUP_GUIDE.md` - Full setup guide
- `DEMO_LEAGUE_FINAL_STATUS.md` - Complete status and details
