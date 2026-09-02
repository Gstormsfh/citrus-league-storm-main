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
  plugins: [react()],
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
      { find: /^@\/hooks\/usePreloadedPlayers$/, replacement: path.resolve(__dirname, 'stubs/usePreloadedPlayers.ts') },
      { find: '@', replacement: path.resolve(__dirname, '..', 'src') },
    ],
  },
  server: { host: '127.0.0.1', port: 5600 },
});
