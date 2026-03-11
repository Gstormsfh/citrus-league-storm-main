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
    react(),
    removeCrossorigin(),
    VitePWA({
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
