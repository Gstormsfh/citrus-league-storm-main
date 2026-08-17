# One paste to commit everything (PowerShell)

Run `git status -sb` first and confirm the branch (expected:
fix/draft-night-hardening — if it says master, STOP: pushing master fires
production-deploy.yml).

```powershell
cd C:\Users\garre\Documents\citrus-league-storm-phase45
git status -sb | Select-Object -First 1

git add `
  apps/web/src/components/roster/MobileRosterList.tsx `
  apps/web/src/components/roster/__tests__/MobileRosterList.positionRing.test.tsx `
  apps/web/src/pages/DraftRoomV2.tsx `
  apps/web/src/pages/__tests__/DraftRoomV2.queueWiring.test.tsx `
  apps/web/src/components/draft/PlayerPool.tsx `
  apps/web/src/components/draft/__tests__/PlayerPool.queueAffordance.test.tsx `
  apps/web/src/hooks/usePreloadedPlayers.ts `
  apps/web/src/hooks/__tests__/usePreloadedPlayers.xg.test.ts `
  apps/web/src/lib/nativeAuth.ts `
  apps/web/src/lib/__tests__/nativeAuth.test.ts `
  apps/web/src/contexts/AuthContext.tsx `
  server/src/draft/autopickStrategy.ts `
  server/src/draft/__tests__/autopickStrategy.test.ts `
  server/src/draft/__tests__/LobbyManager.test.ts `
  apps/web/package.json `
  apps/web/capacitor.config.json `
  apps/web/ios `
  apps/web/src/lib/openExternal.ts `
  apps/web/src/api/client.ts `
  apps/web/src/pages/PoolPlayoffRoster.tsx `
  apps/web/src/App.tsx `
  apps/web/src/pages/Auth.tsx `
  apps/web/src/components/citrus2/HockeyNav.tsx `
  apps/web/src/components/ui/toast.tsx `
  apps/web/vite.config.ts `
  apps/web/src/index.css `
  apps/web/scripts/build-native.mjs `
  server/src/app.ts `
  supabase/migrations/20260817120000_draft_metrics_partitions_enable_rls.sql `
  supabase/migrations/20260816220000_initialize_waiver_priority_fn.sql `
  supabase/migrations/20260816221000_auto_advance_playoff_rounds_fn.sql `
  supabase/migrations/20260816230000_join_flow_friendly_codes.sql `
  server/src/lib/leagueRules.ts `
  server/src/lib/__tests__/leagueRules.test.ts `
  server/src/services/LineupService.ts `
  server/src/services/MatchupService.ts `
  server/src/routes/leagues.ts `
  server/src/services/WaiverService.ts `
  server/src/services/TradeService.ts `
  server/src/routes/scheduled.ts `
  server/src/routes/waivers.ts `
  server/src/services/LeagueService.ts `
  server/src/draft/index.ts `
  .github/workflows/daily-waiver-process.yml `
  apps/web/src/pages/CreateLeague.tsx `
  apps/web/src/pages/__tests__/CreateLeague.autoJoin.integration.test.tsx `
  apps/web/src/pages/LeagueDashboard.tsx `
  apps/web/src/pages/Roster.tsx `
  apps/web/src/pages/Standings.tsx `
  apps/web/src/pages/Profile.tsx `
  apps/web/src/pages/TeamAnalytics.tsx `
  apps/web/src/pages/NHLPlayoffBracket.tsx `
  apps/web/src/components/Navbar.tsx `
  apps/web/src/components/MobileMenuButton.tsx `
  apps/web/src/components/MobileBottomNav.tsx `
  apps/web/src/components/draft/DraftLobby.tsx `
  apps/web/src/pages/DraftRoom.tsx `
  apps/web/src/pages/DraftRoomV2.tsx `
  apps/web/src/components/draft/PlayerPool.tsx `
  apps/web/src/components/draft/PlayerCardDialog.tsx `
  apps/web/src/components/draft/__tests__/PlayerPool.cardButton.test.tsx `
  supabase/migrations/20260817200500_draft_completion_finalizes_league_state.sql `
  apps/web/src/components/__tests__/MobileBottomNav.hideRoutes.test.tsx `
  apps/web/src/components/AdSpace.tsx `
  apps/web/src/components/matchup/PlayerCard.tsx `
  apps/web/src/components/citrus2/Homepage.tsx `
  apps/web/src/pages/FreeAgents.tsx `
  apps/web/src/pages/TradeAnalyzer.tsx `
  apps/web/src/services/MatchupService.ts `
  apps/web/src/services/__tests__/MatchupService.test.ts `
  apps/web/src/utils/weekCalculator.ts `
  apps/web/src/utils/__tests__/weekCalculator.test.ts `
  apps/web/src/utils/__tests__/scoringDefaults.equivalence.test.ts `
  docs/apple

git commit -F .claude-commitmsg.txt
git push        # pushes the CURRENT branch to its upstream — verify branch above first
```

This adds ONLY the enumerated paths — any other in-progress work in the tree
stays out of the commit. After pushing, run `npm install` once at the repo root
(picks up the three @capacitor deps) before running the web test suite locally.
