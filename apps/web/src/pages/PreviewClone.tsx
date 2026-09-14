import { lazy, Suspense } from 'react';

// This design-canon route is web-only. Its module can remain a development
// route without causing the public storefront (and its product captures) to
// be emitted into Capacitor's bundle.
const WebHomepage = import.meta.env.VITE_NATIVE === '1'
  ? null
  : lazy(async () => {
      const module = await import('@/components/citrus2/Homepage');
      return { default: module.Homepage };
    });

/**
 * Design canon for the new dark Citrus 2.0 homepage. Same composition that
 * `pages/Index.tsx` uses in production — kept at /preview-clone so design
 * iterations can ship here first without touching prod traffic.
 */
export default function PreviewClone() {
  if (!WebHomepage) return null;
  return (
    <Suspense fallback={null}>
      <WebHomepage />
    </Suspense>
  );
}
