/**
 * PRESS BOX LEAGUE SETTINGS HARNESS — artboard 1a's ninth frame.
 *
 * The commissioner's waivers tab, mounted in the real components with the
 * artboard's own values so the header, the section chips, the row ladder, the
 * toggle, the callout and the pinned save bar can be measured against 1a.
 *
 * Every figure is the mock's.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/pressboxFonts';
import '../src/index.css';
import {
  PB_TYPE,
  PressBoxCallout,
  PressBoxChips,
  PressBoxSaveBar,
  PressBoxSettingGroup,
  PressBoxSettingRow,
  PressBoxSettingsHeader,
} from '../src/components/pressbox';

const SECTIONS = [
  { key: 'general', label: 'GENERAL' },
  { key: 'roster', label: 'ROSTER' },
  { key: 'scoring', label: 'SCORING' },
  { key: 'waivers', label: 'WAIVERS' },
  { key: 'trades', label: 'TRADES' },
  { key: 'playoffs', label: 'PLAYOFFS' },
];

function Harness() {
  const [section, setSection] = useState('waivers');
  const [gameLock, setGameLock] = useState(true);
  const [tradesDuringGames, setTradesDuringGames] = useState(true);

  return (
    <div
      style={{ width: 393, minHeight: 852, marginInline: 'auto', transform: 'translateZ(0)', paddingBottom: 88 }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <PressBoxSettingsHeader
        title="League settings"
        eyebrow="COMMISSIONER · FINALSZ"
        status="SAVED"
        onBack={() => undefined}
      />

      <PressBoxChips
        chips={SECTIONS}
        activeKey={section}
        onSelect={setSection}
        label="Settings section"
        outlined
        className="mt-1 mx-3.5 overflow-hidden"
      />

      <div className={`${PB_TYPE} px-3.5 pt-3.5 flex flex-col gap-4`}>
        <PressBoxSettingGroup label="PROCESSING">
          <PressBoxSettingRow label="Waiver type" help="Claimant drops to the back of the line" value="Rolling priority" onPress={() => undefined} />
          <PressBoxSettingRow label="Initial order" value="Reverse draft" onPress={() => undefined} />
          <PressBoxSettingRow label="Process time" help="Daily, Mountain Time" value="2:00 AM" onPress={() => undefined} />
          <PressBoxSettingRow label="Waiver period" help="How long dropped players sit on waivers" value="48 hours" onPress={() => undefined} last />
        </PressBoxSettingGroup>

        <PressBoxSettingGroup label="LIMITS">
          <PressBoxSettingRow label="Max adds per week" value="Unlimited" onPress={() => undefined} />
          <PressBoxSettingRow label="Max adds per season" value="60" onPress={() => undefined} />
          <PressBoxSettingRow label="Game lock" help="Players lock at puck drop" checked={gameLock} onToggle={setGameLock} last />
        </PressBoxSettingGroup>

        <PressBoxSettingGroup label="TRADES DURING GAMES">
          <PressBoxSettingRow label="Allow trades during games" help="Locked players can still be dealt" checked={tradesDuringGames} onToggle={setTradesDuringGames} />
          <PressBoxSettingRow label="Trade review" help="4 of 12 votes to veto" value="League vote · 24h" onPress={() => undefined} last />
        </PressBoxSettingGroup>

        <PressBoxCallout>
          Changes notify all 12 managers and take effect at the next waiver run (Fri 2:00 AM MT).
        </PressBoxCallout>
      </div>

      <PressBoxSaveBar
        saveLabel="SAVE &amp; NOTIFY LEAGUE"
        className="absolute left-3.5 right-3.5 bottom-[22px]"
        onDiscard={() => undefined}
        onSave={() => undefined}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/league/1/settings']}>
    <Harness />
  </MemoryRouter>,
);
