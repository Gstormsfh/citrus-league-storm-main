/**
 * Harness dev server — the real pages, real components and real Tailwind, with
 * auth and the league context replaced by stubs so a page can be rendered at a
 * phone viewport without signing in.
 *
 * NOT part of any build. `apps/web/vite.config.ts` is untouched.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '..'),
  envDir: path.resolve(__dirname, '..', '..', '..'),
  plugins: [
    react(),
    // The `@/api/client` alias below catches only that spelling. The api
    // modules next to it (`api/leagues.ts`, `api/players.ts`, ...) import
    // `./client` RELATIVELY, so until 2026-09-14 the draft room's league read
    // went through the real client to a server that is not there, and the
    // pool sat on "League scoring is unavailable" in every harness render.
    // Resolve that relative import to the stub as well.
    {
      name: 'harness-stub-relative-api-client',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer || !/^\.\/client(\.ts)?$/.test(source)) return null;
        if (path.dirname(importer) !== path.resolve(__dirname, '..', 'src', 'api')) return null;
        return path.resolve(__dirname, 'stubs/apiClient.ts');
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/contexts\/AuthContext$/, replacement: path.resolve(__dirname, 'stubs/AuthContext.tsx') },
      { find: /^@\/contexts\/LeagueContext$/, replacement: path.resolve(__dirname, 'stubs/LeagueContext.tsx') },
      // Draft-room harness: the WebSocket transport and every network read the
      // room makes, replaced by scripted fixtures. The state machine, the
      // derivation and every component under them are the real modules.
      { find: /^@\/lib\/draftClient\/runner$/, replacement: path.resolve(__dirname, 'stubs/draftRunner.ts') },
      { find: /^@\/lib\/draftClient\/fetchDraftOrderMatrix$/, replacement: path.resolve(__dirname, 'stubs/fetchDraftOrderMatrix.ts') },
      { find: /^@\/lib\/draftClient\/submitPick$/, replacement: path.resolve(__dirname, 'stubs/submitPick.ts') },
      { find: /^@\/api\/client$/, replacement: path.resolve(__dirname, 'stubs/apiClient.ts') },
      // The real client calls createClient() at MODULE SCOPE and throws when
      // VITE_SUPABASE_* are unset — which they are here, on purpose. Any page
      // whose chrome reaches it (Navbar → notificationStore →
      // NotificationService → this module) rendered a blank root with the
      // error only in the console. See stubs/supabaseClient.ts.
      {
        find: /^@\/integrations\/supabase\/client$/,
        replacement: path.resolve(__dirname, 'stubs/supabaseClient.ts'),
      },
      { find: /^@\/hooks\/usePreloadedPlayers$/, replacement: path.resolve(__dirname, 'stubs/usePreloadedPlayers.ts') },
      { find: '@', replacement: path.resolve(__dirname, '..', 'src') },
    ],
  },
  server: { host: '127.0.0.1', port: 5600 },
});
