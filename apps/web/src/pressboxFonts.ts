/**
 * THE PRESS BOX FACES, BUNDLED (PR18, 2026-09-05).
 *
 * Barlow Condensed 700/800, Barlow 400-700 and IBM Plex Mono 500/600 ship
 * with the app as hashed assets -- latin subsets, woff2 -- so the boot
 * splash, the header and every row draw in the right face on the first
 * frame, on a plane, with no round trip to Google. The marketing site's
 * other faces still come from the non-blocking Google link in index.html.
 *
 * One module, imported by main.tsx before index.css and by every harness
 * page, so the harness draws the same faces the app does.
 */
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
