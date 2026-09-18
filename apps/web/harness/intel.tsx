import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { Card, CardContent, CardHeader, CardTitle } from '../src/components/ui/card';
import { WeekStrip } from '../src/components/gm-office/WeekStrip';

// The week Garrett screenshotted on GM Office, 2026-09-18: preseason, two
// dark days, Saturday with 13 games. `?w=NNN` sets the card width; 200 and
// 240 are the sidebar widths on GM Office / Roster at lg / xl.
const days = [
  { dateStr: '2026-09-13', dayLabel: 'Sunday', totalGames: 0, rosterGames: 0 },
  { dateStr: '2026-09-14', dayLabel: 'Monday', totalGames: 0, rosterGames: 0 },
  { dateStr: '2026-09-15', dayLabel: 'Tuesday', totalGames: 5, rosterGames: 2 },
  { dateStr: '2026-09-16', dayLabel: 'Wednesday', totalGames: 3, rosterGames: 4 },
  { dateStr: '2026-09-17', dayLabel: 'Thursday', totalGames: 8, rosterGames: 6 },
  { dateStr: '2026-09-18', dayLabel: 'Friday', totalGames: 5, rosterGames: 8 },
  { dateStr: '2026-09-19', dayLabel: 'Saturday', totalGames: 13, rosterGames: 17 },
];
const widths = (new URLSearchParams(location.search).get('w') || '200,240,340').split(',').map(Number);
createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
    {widths.map((w) => (
      <div key={w} style={{ width: w }}>
        <Card className="border-border/50">
          <CardHeader className="pb-3"><CardTitle className="text-base font-semibold text-foreground">Team Intel · {w}px</CardTitle></CardHeader>
          <CardContent className="space-y-6 pt-0">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Games This Week</h3>
              <WeekStrip days={days} todayStr="2026-09-18" />
            </div>
          </CardContent>
        </Card>
      </div>
    ))}
  </div>,
);
