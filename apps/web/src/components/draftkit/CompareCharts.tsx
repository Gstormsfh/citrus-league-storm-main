import { useEffect, useRef } from 'react';
import '@citrus/shared/draftCompare/charts.js';
import type { ComparePlayer, CompareStat } from './PlayerCompare';

export interface ChartPlayer extends ComparePlayer { colorSlot: number }
type ChartApi = {
  COLORS: string[];
  render: (root: HTMLElement, options: {players: ChartPlayer[]; stats: CompareStat[]; impact: boolean}) => void;
};
export const comparisonCharts = (globalThis as typeof globalThis & {CitrusCompareCharts: ChartApi}).CitrusCompareCharts;
export default function CompareCharts({players,stats,impact}:{players:ChartPlayer[];stats:CompareStat[];impact:boolean}) {
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(root.current)comparisonCharts.render(root.current,{players,stats,impact});},[players,stats,impact]);
  return <div ref={root} className="cc-charts" aria-label="Player comparison maps" />;
}
