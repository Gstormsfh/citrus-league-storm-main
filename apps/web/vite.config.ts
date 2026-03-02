import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import type { Plugin } from "vite";

// Plugin to remove crossorigin attribute and ensure React loads first
function removeCrossorigin(): Plugin {
  return {
    name: "remove-crossorigin",
    transformIndexHtml(html) {
      // Only strip bare crossorigin attributes (added by Vite to module/preload tags).
      // Preserve crossorigin="anonymous" required by third-party scripts like AdSense.
      let result = html
        .replace(/\s+crossorigin(?!=)/g, "");
      
      // Reorder modulepreload links to ensure React loads first
      const reactPreload = result.match(/<link rel="modulepreload" href="[^"]*vendor-react[^"]*">/);
      const otherPreloads = result.match(/<link rel="modulepreload" href="[^"]*vendor[^"]*">/g) || [];
      
      if (reactPreload && otherPreloads.length > 1) {
        // Remove all vendor preloads
        otherPreloads.forEach(preload => {
          result = result.replace(preload, '');
        });
        
        // Add React first, then others
        const scriptTag = result.match(/<script type="module"[^>]*>/);
        if (scriptTag) {
          const beforeScript = result.substring(0, result.indexOf(scriptTag[0]));
          const afterScript = result.substring(result.indexOf(scriptTag[0]));
          result = beforeScript + reactPreload[0] + '\n    ' + 
                   otherPreloads.filter(p => !p.includes('vendor-react')).join('\n    ') + 
                   '\n    ' + afterScript;
        }
      }
      
      return result;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "0.0.0.0",
    port: 8080,
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
          // Don't split React - keep it in main bundle to ensure it loads first
          // This prevents vendor bundles from trying to use React before it's available
          if (id.includes('node_modules')) {
            // Supabase (important for auth)
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            // All other node_modules in one chunk (React stays in main bundle)
            return 'vendor';
          }
        },
      },
    },
    // Don't add crossorigin attribute - can cause CORS issues
    assetsInlineLimit: 4096,
  },
}));
