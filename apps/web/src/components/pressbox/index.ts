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

export { PressBoxSegmented, type PressBoxSegmentedProps, type PressBoxSegment } from './Segmented';
export { PressBoxTabs, type PressBoxTabsProps, type PressBoxTab } from './Tabs';
export { PressBoxChips, type PressBoxChipsProps, type PressBoxChip } from './Chips';
export { PressBoxActionGrid, type PressBoxActionGridProps, type PressBoxActionCell } from './ActionGrid';
export { PressBoxSectionHead, type PressBoxSectionHeadProps } from './SectionHead';
export { PressBoxTile, type PressBoxTileProps } from './Tile';
export { PressBoxAppHeader, type PressBoxAppHeaderProps } from './AppHeader';

/** League settings (artboard 1a). A commissioner screen, audited more than edited. */
export {
  PressBoxSettingsHeader,
  PressBoxSettingGroup,
  PressBoxSettingRow,
  PressBoxTextRow,
  PressBoxToggle,
  PressBoxCallout,
  PressBoxSaveBar,
  PressBoxOptionSheet,
  PressBoxNumberSheet,
  type PressBoxSettingsHeaderProps,
  type PressBoxSettingRowProps,
  type PressBoxTextRowProps,
  type PressBoxSaveBarProps,
  type PressBoxPickerOption,
  type PressBoxOptionSheetProps,
  type PressBoxNumberSheetProps,
} from './Settings';
export { PressBoxSheet, type PressBoxSheetProps } from './Sheet';

/** The player card (artboard 1a). One screen, six pieces. */
export {
  PressBoxPlayerCardHero,
  pressBoxPlayerCardGround,
  PressBoxStatTiles,
  PressBoxGameLog,
  PressBoxUpcomingCards,
  PressBoxNoteCard,
  type PressBoxPlayerCardHeroProps,
  type PressBoxPlayerVital,
  type PressBoxStatTile,
  type PressBoxGameLogProps,
  type PressBoxGameLogRow,
  type PressBoxUpcomingGame,
  type PressBoxNoteCardProps,
} from './PlayerCard';
export { PressBoxScoreTicker, type PressBoxScoreTickerProps, type PressBoxTickerGame } from './ScoreTicker';
export {
  PressBoxLeagueCard,
  type PressBoxLeagueCardProps,
  type PressBoxLeagueCardScore,
} from './LeagueCard';
export {
  PressBoxTonightCards,
  type PressBoxTonightCardsProps,
  type PressBoxTonightPlayer,
} from './TonightCard';
export {
  PressBoxLeagueMatchupCard,
  type PressBoxLeagueMatchupCardProps,
  type PressBoxLeagueMatchupSide,
} from './LeagueMatchupCard';

/** The draft room (PR16). Artboards 4a (the pool) and 4b (the board). */
export { PressBoxDraftHeader, PB_DRAFT_EXIT, type PressBoxDraftHeaderProps } from './DraftHeader';
export { PressBoxDraftSearchRow, PB_SORT_TRIGGER, type PressBoxDraftSearchRowProps } from './DraftSearchRow';
// The draft pool ROW is `components/draft/DraftPoolRow` — the shared v1/v2
// row, restyled to artboard 4a on 2026-09-04 with every control it had. It
// lives there, not here, because it is wired to the draft transport and is
// verified in `harness/draft.html` against the real engine path.
export { PressBoxDraftPickBar, type PressBoxDraftPickBarProps } from './DraftPickBar';
export { PressBoxStandingsTable, type PressBoxStandingsTableProps, type PressBoxStandingsRow } from './StandingsTable';
export { PressBoxPlayerRow, type PressBoxPlayerRowProps, type PressBoxPlayerRowPlayer, type PressBoxPlayerAction, formatAdds } from './PlayerRow';
export { PressBoxMatchupRow, type PressBoxMatchupRowProps, type PressBoxMatchupPlayer } from './MatchupRow';
export {
  PressBoxScoreBlock,
  type PressBoxScoreBlockProps,
  type PressBoxScoreSide,
  type PressBoxScoreDay,
} from './ScoreBlock';

/** The Press Box row ladder and chip. See rowScale.ts for why they fork. */
export {
  PB_TYPE,
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
