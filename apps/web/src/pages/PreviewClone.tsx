// Imported from the module, not from the citrus2 barrel. Homepage.tsx itself
// imports its siblings through the barrel, so barrel -> Homepage -> barrel is a
// cycle, and this page is lazy-loaded into its own chunk: Rollup warned that
// re-exporting Homepage through the cyclic barrel across chunks can break
// execution order (CYCLIC_CROSS_CHUNK_REEXPORT) and asked for a direct import.
import { Homepage } from '@/components/citrus2/Homepage';

/**
 * Design canon for the new dark Citrus 2.0 homepage. Same composition that
 * `pages/Index.tsx` uses in production — kept at /preview-clone so design
 * iterations can ship here first without touching prod traffic.
 */
export default function PreviewClone() {
  return <Homepage />;
}
