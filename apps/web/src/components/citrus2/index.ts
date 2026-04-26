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

// Page chrome
export { DarkLayout } from './DarkLayout';
export { HockeyNav } from './HockeyNav';
export { HockeyFooter } from './HockeyFooter';

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
