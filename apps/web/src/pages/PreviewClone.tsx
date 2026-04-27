import { Homepage } from '@/components/citrus2';

/**
 * Design canon for the new dark Citrus 2.0 homepage. Same composition that
 * `pages/Index.tsx` uses in production — kept at /preview-clone so design
 * iterations can ship here first without touching prod traffic.
 */
export default function PreviewClone() {
  return <Homepage />;
}
