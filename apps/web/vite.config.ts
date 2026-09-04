import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import type { Plugin } from "vite";

// Plugin to remove crossorigin attribute from module/preload tags
function removeCrossorigin(): Plugin {
  return {
    name: "remove-crossorigin",
    transformIndexHtml(html) {
      // Only strip bare crossorigin attributes (added by Vite to module/preload tags).
      // Preserve crossorigin="anonymous" required by third-party scripts like AdSense.
      return html.replace(/\s+crossorigin(?!=)/g, "");
    },
  };
}

// https://vitejs.dev/config/
/**
 * SWEEP (2026-08-15) — AdSense must not ship inside the iOS shell.
 * Google prohibits AdSense in native apps (AdMob is the sanctioned
 * product) and an ad loader in a wrapped app invites App Review
 * scrutiny under 4.2. Web builds are untouched: the strip only runs
 * when scripts/build-native.mjs sets VITE_NATIVE=1, and that script
 * also ASSERTS the tag is gone from dist afterwards.
 */
const stripAdsForNative = () => ({
  name: 'citrus-strip-ads-native',
  transformIndexHtml(html: string) {
    if (process.env.VITE_NATIVE !== '1') return html;
    return html.replace(/\s*<!-- Google AdSense -->[\s\S]*?<\/script>/, '');
  },
});

export default defineConfig(({ mode }) => ({
  base: "/",
  // Load .env from monorepo root (where .env.example lives)
  envDir: path.resolve(__dirname, '../../'),
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    stripAdsForNative(),
    react(),
    removeCrossorigin(),
    VitePWA({
      // No service worker inside the iOS shell. Capacitor serves dist straight
      // from the .ipa, so there is nothing to cache for offline use, and a
      // worker's precache is a stale-asset risk across builds: it stores one
      // build's hashed assets and can keep serving them after an App Store
      // update has replaced the files underneath. scripts/build-native.mjs
      // sets VITE_NATIVE=1 and asserts that dist carries no sw.js /
      // registerSW.js afterwards. Web builds are untouched.
      disable: process.env.VITE_NATIVE === '1',
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "favicon.ico", "apple-touch-icon.png", "loading-citrus.png"],
      manifest: false, // Use existing public/manifest.json
      workbox: {
        // Precache the app shell (JS, CSS, HTML)
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        // Don't precache source maps or huge files
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3MB
        // Runtime caching for API calls and external resources
        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Google Fonts files (woff2)
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Supabase API calls - network first (data must be fresh)
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 5 },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@citrus/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    // Disable source maps in production (like Sleeper) - makes code harder to inspect
    // This means you won't see readable file names like "Navbar.tsx" in production
    sourcemap: false,
    // Minification is enabled by default (esbuild) - this obfuscates variable names
    // File names are already hashed (e.g., "bundle-ad5307820ecbf2d14bca028f8b00890f.js")
    rollupOptions: {
      output: {
        // Obfuscate chunk file names with hashes (already default, but explicit)
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Supabase — separate chunk (auth-critical, loaded early)
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            // Recharts / D3 (charting) — heavy, lazy-loaded pages only
            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-charts';
            }
            // Firebase — separate chunk (analytics/hosting, not needed on every page)
            if (id.includes('firebase') || id.includes('@firebase')) {
              return 'vendor-firebase';
            }
            // Sentry — loaded lazily by initSentry(). Without its own chunk it
            // rides in the eager `vendor` bundle and the lazy import buys nothing
            // (+164 kB gzip on first paint for code that only runs on an error).
            if (id.includes('@sentry')) {
              return 'vendor-sentry';
            }
            // Radix UI — separate chunk (UI primitives, loaded with first interaction)
            if (id.includes('@radix-ui')) {
              return 'vendor-radix';
            }
            // All other vendor code (React, Router, TanStack, etc.) in one chunk
            return 'vendor';
          }
        },
      },
    },
    // Don't add crossorigin attribute - can cause CORS issues
    assetsInlineLimit: 4096,
  },
}));
