import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../src/index.css';
import { SlotPickerMenu } from '../src/components/roster/SlotPickerMenu';
import type { HockeyPlayer } from '../src/components/roster/HockeyPlayerCard';

const mk = (id: string, name: string, position: string): HockeyPlayer =>
  ({ id, name, position, number: 9, starter: true, team: 'EDM', teamAbbreviation: 'EDM', stats: {} }) as HockeyPlayer;

const ROSTER = [
  mk('1', 'Connor McDavid', 'C'), mk('2', 'Leon Draisaitl', 'C'),
  mk('3', 'Cale Makar', 'D'), mk('4', 'Quinn Hughes', 'D'),
  mk('5', 'Igor Shesterkin', 'G'), mk('6', 'Artemi Panarin', 'LW'),
];
const ASSIGN: Record<string, string> = {
  '1': 'slot-C-1', '2': 'slot-C-2', '3': 'slot-D-1', '4': 'slot-D-2',
  '5': 'slot-G-1', '6': 'bench-grid',
};

function App() {
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-screen bg-[#0F1F15] text-pastel-cream p-4">
      <p className="font-jbmono text-[10px] uppercase tracking-[0.2em] text-white/55 mb-4">Slot picker @ 393</p>
      <SlotPickerMenu
        player={ROSTER[0]}
        eligibleSlots={new Set(['slot-C-1','slot-C-2','slot-UTIL','slot-D-1','bench-grid','ir-slot-1'])}
        slotAssignments={ASSIGN}
        allPlayers={ROSTER}
        open={open}
        onOpenChange={setOpen}
        onPick={(s) => console.log('picked', s)}
      >
        <button className="w-full text-left px-3 py-3 rounded-lg bg-[#16281D] ring-1 ring-white/10">
          <span className="font-display font-bold text-[13px]">Connor McDavid</span>
          <span className="block text-[11px] text-white/55">EDM · C1 — tap to move</span>
        </button>
      </SlotPickerMenu>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
