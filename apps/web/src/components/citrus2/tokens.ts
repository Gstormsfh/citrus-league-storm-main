/**
 * Citrus 2.0 design tokens — values used across the citrus2 component family.
 *
 * Most styling lives in Tailwind classes. This file holds the few raw values
 * that need to be reused programmatically (background colors for inline styles,
 * accent palette for prop-driven theming, etc.).
 */

export const C2 = {
  /** Page surface (deep forest) */
  bg: '#0F1F15',
  /** Tile / card surface (slightly lighter) */
  surface: '#1A2A20',
  /** Surface for hover / active state */
  surfaceHigh: '#243429',
  /** Vibrant primary — CTAs and live indicators */
  orange: '#FF6B1A',
  /** Softer orange for eyebrow text and accents */
  orangeSoft: '#FF9F66',
  /** Deep orange for hover states */
  orangeDeep: '#C04A0E',
  /** Sage green secondary accent */
  sage: '#84A57D',
  /** Soft sage for chips/text */
  sageSoft: '#C8DCC4',
  /** Warm cream for primary text */
  cream: '#FFF8F0',
  /** Butter accent (4th color in mascot palette) */
  butter: '#F4E5B8',
  /** Peach accent (5th color in mascot palette) */
  peach: '#FFE0CC',
} as const;

/** Accent name → tailwind class bundles for prop-driven cards */
export type AccentName = 'orange' | 'sage' | 'butter' | 'peach';

export const ACCENT_CLASSES: Record<
  AccentName,
  { bg: string; ring: string; text: string; chip: string }
> = {
  orange: {
    bg: 'bg-pastel-orange/15',
    ring: 'ring-pastel-orange/40',
    text: 'text-pastel-orange-soft',
    chip: 'bg-pastel-orange/15 text-pastel-orange-soft ring-pastel-orange/30',
  },
  sage: {
    bg: 'bg-pastel-sage/20',
    ring: 'ring-pastel-sage/40',
    text: 'text-pastel-sage-soft',
    chip: 'bg-pastel-sage/15 text-pastel-sage-soft ring-pastel-sage/30',
  },
  butter: {
    bg: 'bg-[#F4E5B8]/15',
    ring: 'ring-[#F4E5B8]/40',
    text: 'text-[#F4E5B8]',
    chip: 'bg-[#F4E5B8]/10 text-[#F4E5B8] ring-[#F4E5B8]/30',
  },
  peach: {
    bg: 'bg-pastel-peach/20',
    ring: 'ring-pastel-peach/40',
    text: 'text-pastel-peach-deep',
    chip: 'bg-pastel-peach/15 text-pastel-peach-deep ring-pastel-peach/30',
  },
};
