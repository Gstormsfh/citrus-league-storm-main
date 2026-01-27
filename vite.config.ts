import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import type { Plugin } from "vite";

// Plugin to remove crossorigin attribute and ensure React loads first
function removeCrossorigin(): Plugin {
  return {
    name: "remove-crossorigin",
    transformIndexHtml(html) {
      let result = html
        .replace(/\s+crossorigin/g, "")
        .replace(/crossorigin\s+/g, "")
        .replace(/crossorigin/g, "");
      
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
    mode === 'development' &&
    componentTagger(),
    removeCrossorigin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
