/**
 * PRESS BOX DRAFT HARNESS — artboard 4a, in the real components.
 *
 * The draft room the app ships is 4,978 lines behind a live socket; this
 * mounts the Press Box primitives with the artboard's own five players and
 * its clock so the header, the tab strip, the filter chips, the pool row and
 * the pick bar can be measured against 4a line for line before any of it goes
 * near the real page.
 *
 * Every figure is the mock's.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';
import {
  PB_TYPE,
  PressBoxChips,
  PressBoxDraftHeader,
  PressBoxDraftPickBar,
  PressBoxDraftPoolRow,
  PressBoxDraftSearchRow,
  PressBoxTabs,
  type PressBoxDraftPoolPlayer,
} from '../src/components/pressbox';

declare global { interface Window { __log: string[] } }
window.__log = [];
const log = (s: string) => { window.__log.push(s); };

const TABS = [
  { key: 'players', label: 'Players' },
  { key: 'queue', label: 'Queue · 6' },
  { key: 'board', label: 'Board' },
  { key: 'myteam', label: 'My team' },
];

const CHIPS = [
  { key: 'all', label: 'ALL' },
  { key: 'c', label: 'C' },
  { key: 'lw', label: 'LW' },
  { key: 'rw', label: 'RW' },
  { key: 'd', label: 'D' },
  { key: 'g', label: 'G' },
  { key: 'starred', label: '★ 6', trailing: true },
];

const POOL: PressBoxDraftPoolPlayer[] = [
  { id: '1', rank: 25, name: 'Cale Makar', metaLead: 'D', metaRest: 'COL · 90 PTS · 26:10 · BYE 9', projection: 612, tierLine: 'TIER 2 · D1', tierUrgent: true, adp: 22.4 },
  { id: '2', rank: 26, name: 'Brayden Point', metaLead: 'C', metaRest: 'TBL · 46 G 82 P · PP1 · BYE 4', projection: 598, tierLine: 'TIER 2 · C6', adp: 27.1 },
  { id: '3', rank: 27, name: 'Igor Shesterkin', metaLead: 'G', metaRest: 'NYR · 36 W · .917 · 62 GP', projection: 571, tierLine: 'TIER 1 · G2', adp: 24.9, queuePosition: 2 },
  { id: '4', rank: 28, name: 'Kirill Kaprizov', metaLead: 'LW', metaRest: 'MIN · 41 G 96 P · 41 PPP', projection: 566, tierLine: 'TIER 2 · LW3', adp: 19.8 },
  { id: '5', rank: 29, name: 'Lane Hutson', metaLead: 'D', metaRest: 'MTL · 66 PTS · 24:01 · BYE 9', projection: 540, tierLine: 'TIER 3 · D4', adp: 38.0 },
];

function Harness() {
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('all');
  const [tab, setTab] = useState('players');
  return (
    <div
      style={{ width: 393, minHeight: 852, marginInline: 'auto', transform: 'translateZ(0)', paddingBottom: 100 }}
      className="relative bg-pressbox-surface"
      data-phone-frame="393x852"
    >
      <PressBoxDraftHeader
        leagueName="Finalsz"
        progressLine="ROUND 3 · PICK 7 · 30 / 216"
        connected={11}
        total={12}
        onBack={() => log('back')}
      >
        <PressBoxTabs tabs={TABS} activeKey={tab} onSelect={setTab} label="Draft view" fill />
      </PressBoxDraftHeader>

      <div className={`${PB_TYPE} px-3.5 pt-2.5`}>
        <PressBoxDraftSearchRow
          value={search}
          onValueChange={setSearch}
          sortLabel="PROJ"
          onSortPress={() => log('sort')}
        />

        <PressBoxChips chips={CHIPS} activeKey={chip} onSelect={setChip} label="Position filter" className="mt-2" />

        <div className="mt-3 flex items-center gap-2.5 px-0.5">
          <img src="/mascots/mascot-stormy.webp" alt="" className="w-[22px] h-[22px] rounded-full object-cover flex-none" />
          <p className="flex-1 min-w-0 font-barlow text-[12px] text-pressbox-text/70 truncate">
            Need 2 D by round 6 · 4 of the top-8 D go before your next pick
          </p>
        </div>

        <div
          aria-hidden="true"
          className="grid grid-cols-[22px_1fr_54px_40px] gap-2.5 pt-3 pb-1.5 px-0.5 font-plex font-medium text-[9px] uppercase tracking-[0.08em] text-pressbox-text/40"
        >
          <span>RK</span>
          <span>Player</span>
          <span className="text-right">Proj</span>
          <span className="text-right">ADP</span>
        </div>

        {POOL.map((p, i) => (
          <PressBoxDraftPoolRow key={p.id} player={p} target={i === 0} onPress={() => log(`pick:${p.name}`)} />
        ))}
      </div>

      <PressBoxDraftPickBar
        progress={0.8}
        eyebrow="Your pick · 3.07"
        clock="1:12"
        actionLabel="Draft Makar"
        actionDetail="QUEUE #1 · D · 612"
        onAction={() => log('draft')}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/draft']}>
    <Harness />
  </MemoryRouter>,
);
