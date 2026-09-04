/** Press Box shared chrome. Build once, mount on every league page. */
export { LeagueHeader, type LeagueHeaderProps } from './LeagueHeader';
export { PressBoxBottomNav } from './PressBoxBottomNav';
export { ChatBar, type ChatBarProps } from './ChatBar';
export { LeagueMenu, type LeagueMenuProps } from './LeagueMenu';
export { defaultLeagueTiles, type LeagueMenuTile } from './leagueMenuTiles';
export {
  HEADER_H,
  HEADER_ROW1_H,
  HEADER_SUBTAB_H,
  CHATBAR_H,
  BOTTOMNAV_H,
  BOTTOM_CHROME_H,
  SCANLINE,
} from './chromeMetrics';

/** Roster surface (PR4). Presentational: every figure arrives as a prop. */
export { PressBoxRosterRow, type PressBoxRosterRowProps, type PressBoxRosterRowPlayer } from './RosterRow';
export { PressBoxTeamCard, type PressBoxTeamCardProps, type PressBoxTeamAction } from './PressBoxTeamCard';
export {
  PressBoxRosterList,
  type PressBoxRosterListProps,
  type PressBoxRosterSlotRow,
} from './RosterList';

export { PressBoxMatchupRow, type PressBoxMatchupRowProps, type PressBoxMatchupPlayer } from './MatchupRow';
export {
  PressBoxScoreBlock,
  type PressBoxScoreBlockProps,
  type PressBoxScoreSide,
  type PressBoxScoreDay,
} from './ScoreBlock';

/** The Press Box row ladder and chip. See rowScale.ts for why they fork. */
export {
  PB_ROW_NAME,
  PB_ROW_HEADLINE,
  PB_ROW_HEADLINE_LABEL,
  PB_ROW_META,
  PB_ROW_MICRO,
} from './rowScale';
export {
  positionChipKey,
  pressBoxPositionChipClasses,
  PB_POSITION_CHIP_BASE,
  PB_NEUTRAL_CHIP,
} from './positionChip';
