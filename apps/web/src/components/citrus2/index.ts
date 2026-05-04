/**
 * Citrus 2.0 design system — barrel export.
 *
 * Import everything from this single entry:
 *   import { DarkLayout, HockeyNav, RotatingHero, ... } from '@/components/citrus2';
 *
 * See STYLEGUIDE.md in this folder for usage patterns and migration playbook.
 */

// Tokens
export { C2, ACCENT_CLASSES } from './tokens';
export type { AccentName } from './tokens';

// Primitives
export { TeamChip, TeamColorBar } from './TeamChip';
export { MascotAvatar, MascotPortrait } from './MascotAvatar';
export { LivePulse, Eyebrow } from './LivePulse';

// Player dashboards primitives (Web Summit launch — May 11)
export { PlayerMonogram } from './PlayerMonogram';
export type { PlayerMonogramSize } from './PlayerMonogram';
export { PercentileBullet } from './PercentileBullet';
export type { PercentileCategory, PercentileSize } from './PercentileBullet';
export { StaleDataBadge } from './StaleDataBadge';
export type { StaleDataBadgeVariant } from './StaleDataBadge';

// Brand mark
export { CitrusLogo, CitrusWordmark } from './CitrusLogo';

// Glow wrapper for premium hover states + mascot peek-out for brand layering
export { GlowCard } from './GlowCard';
export { MascotPeek } from './MascotPeek';

// Canonical surface + action primitives — replaces shadcn Card/Button on
// migrated pages so layout, spacing, and rhythm stay consistent.
export {
  CitrusCard,
  CitrusCardEyebrow,
  CitrusCardTitle,
  CitrusCardDescription,
} from './CitrusCard';
export type { CitrusCardProps } from './CitrusCard';

export { CitrusButton } from './CitrusButton';
export type {
  CitrusButtonProps,
  CitrusLinkButtonProps,
  CitrusAnchorButtonProps,
} from './CitrusButton';

// Hero mascot scenes — full environmental compositions, NOT corner peeks.
// Use these as the primary visual on Auth, empty states, error pages.
export {
  StormyWelcomeScene,
  PineappleStandbyScene,
  LemonOnTheBoardsScene,
} from './MascotScene';

// On-brand loading state
export { StormyLoading } from './StormyLoading';

// Custom hockey iconography (replaces generic lucide icons in cards)
export {
  PuckIcon,
  StickIcon,
  CrossedSticksIcon,
  NetIcon,
  CupIcon,
  FaceoffIcon,
  MaskIcon,
  ScoreboardIcon,
  SlateIcon,
  XGModelIcon,
  ShiftIcon,
  RangeIcon,
  BracketIcon,
  SurvivorIcon,
  PickemIcon,
  DraftIcon,
} from './HockeyIcons';

// Page chrome
export { DarkLayout } from './DarkLayout';
export { HockeyNav } from './HockeyNav';
export type { NavLink } from './HockeyNav';
export { HockeyFooter } from './HockeyFooter';
export type { FooterLink, FooterColumn } from './HockeyFooter';

// Sections
export { SectionHeader } from './SectionHeader';
export { CtaBanner } from './CtaBanner';
export { Faq } from './Faq';
export type { FaqEntry } from './Faq';

// Cards
export { GameModeCard } from './GameModeCard';
export { OnboardingCard } from './OnboardingCard';
export { FeatureCard } from './FeatureCard';
export { MascotCard } from './MascotCard';

// Live tiles (also reusable in product pages)
export { LiveGameTile } from './LiveGameTile';
export type { LiveGameData } from './LiveGameTile';
export { StandingsTile } from './StandingsTile';
export type { StandingsTeam } from './StandingsTile';
export { StormyChatTile } from './StormyChatTile';
export type { StormyExchange } from './StormyChatTile';
export { StormyHeroTile } from './StormyHeroTile';
export { PickemTile } from './PickemTile';
export type { PickemGame } from './PickemTile';
export { SurvivorTile } from './SurvivorTile';
export type { SurvivorPick } from './SurvivorTile';
export { BracketTile } from './BracketTile';
export type { BracketSeries } from './BracketTile';

// Hero
export { HeroCardStack } from './HeroCardStack';
export { RotatingHero } from './RotatingHero';
export type { HeroSlide } from './RotatingHero';

// Top-level compositions
export { Homepage } from './Homepage';
