import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MatchupPlayer } from "./types";
import { ScoringCalculator, ScoringSettings } from "@/utils/scoringUtils";

interface TeamCardProps {
  title: string;
  starters: MatchupPlayer[];
  bench: MatchupPlayer[];
  gradientClass: string;
  slotAssignments?: Record<string, string>;
  onPlayerClick?: (player: MatchupPlayer) => void;
  scoringSettings?: ScoringSettings;
}

export const TeamCard = ({ title, starters, bench, gradientClass, slotAssignments = {}, onPlayerClick, scoringSettings }: TeamCardProps) => {
  
  // Create scoring calculator with league-specific settings
  const scorer = new ScoringCalculator(scoringSettings);
  
  // Helper to calculate daily points using league scoring settings
  const getDailyPoints = (stats: { goals?: number; assists?: number; sog?: number; blk?: number }) => {
    if (!stats) return 0;
    // Use scorer for consistent calculation with league settings
    return scorer.calculatePoints(stats, false).toFixed(1);
  };

  // Helper to split player name into first and last name (always 2 lines)
  const splitPlayerName = (name: string): { firstName: string; lastName: string } => {
    if (!name) return { firstName: '', lastName: '' };
    const trimmed = name.trim();
    const lastSpaceIndex = trimmed.lastIndexOf(' ');
    
    if (lastSpaceIndex === -1) {
      // No space found - single name, show on first line
      return { firstName: trimmed, lastName: '' };
    }
    
    // Split at last space: everything before = first name, last word = last name
    return {
      firstName: trimmed.substring(0, lastSpaceIndex),
      lastName: trimmed.substring(lastSpaceIndex + 1)
    };
  };

  // Helper to normalize position for grouping
  const normalizePosition = (position: string): string => {
    const pos = position?.toUpperCase() || '';
    if (pos.includes('C') && !pos.includes('LW') && !pos.includes('RW')) return 'C';
    if (pos.includes('LW') || pos === 'L' || pos === 'LEFT' || pos === 'LEFTWING') return 'LW';
    if (pos.includes('RW') || pos === 'R' || pos === 'RIGHT' || pos === 'RIGHTWING') return 'RW';
    if (pos.includes('D')) return 'D';
    if (pos.includes('G')) return 'G';
    return 'UTIL';
  };

  // Helper to format position for display (ensures L->LW, R->RW, UTIL->Util)
  const formatPositionForDisplay = (position: string): string => {
    const pos = position?.toUpperCase() || '';
    if (pos === 'UTIL' || pos === 'UTILITY') return 'Util';
    if (pos === 'L' || pos === 'LEFT' || pos === 'LEFTWING') return 'LW';
    if (pos === 'R' || pos === 'RIGHT' || pos === 'RIGHTWING') return 'RW';
    if (pos.includes('LW')) return 'LW';
    if (pos.includes('RW')) return 'RW';
    if (pos.includes('C') && !pos.includes('LW') && !pos.includes('RW')) return 'C';
    if (pos.includes('D')) return 'D';
    if (pos.includes('G')) return 'G';
    return position; // Return original if no match
  };

  // Position color mapping matching RosterDepthChart
  // Desktop: subtle colors, mobile: more prominent
  const getPositionStyles = (position: string, isBench: boolean = false, isMobile: boolean = false) => {
    if (isBench) return { bg: '', border: '', text: '' };
    
    const pos = normalizePosition(position);
    const styles: Record<string, { bg: string; border: string; text: string }> = {
      'C': {
        bg: 'md:bg-fantasy-primary/3 bg-fantasy-primary/10',
        border: 'md:border-l-[1px] border-l-4 md:border-fantasy-primary/40 border-fantasy-primary',
        text: 'text-fantasy-primary'
      },
      'LW': {
        bg: 'md:bg-fantasy-secondary/3 bg-fantasy-secondary/10',
        border: 'md:border-l-[1px] border-l-4 md:border-fantasy-secondary/40 border-fantasy-secondary',
        text: 'text-fantasy-secondary'
      },
      'RW': {
        bg: 'md:bg-fantasy-tertiary/3 bg-fantasy-tertiary/10',
        border: 'md:border-l-[1px] border-l-4 md:border-fantasy-tertiary/40 border-fantasy-tertiary',
        text: 'text-fantasy-tertiary'
      },
      'D': {
        bg: 'md:bg-[#A8D85C]/15 bg-[#A8D85C]/20',
        border: 'md:border-l-[1px] border-l-4 md:border-[#A8D85C]/40 border-[#A8D85C]',
        text: 'text-[#A8D85C]'
      },
      'G': {
        bg: 'md:bg-[#FF6F80]/15 bg-[#FF6F80]/20',
        border: 'md:border-l-[1px] border-l-4 md:border-[#FF6F80]/40 border-[#FF6F80]',
        text: 'text-[#FF6F80]'
      },
      'UTIL': {
        bg: 'md:bg-[#FFB84D]/15 bg-[#FFB84D]/20',
        border: 'md:border-l-[1px] border-l-4 md:border-[#FFB84D]/40 border-[#FFB84D]',
        text: 'text-[#FFB84D]'
      }
    };
    
    return styles[pos] || { bg: '', border: '', text: '' };
  };

  // Standard starting lineup structure - ALWAYS show all slots, even if empty
  // 2C, 2RW, 2LW, 4D, 2G, 1UTIL
  const standardSlotOrder: Array<{ slot: string; position: string }> = [
    { slot: 'slot-C-1', position: 'C' },
    { slot: 'slot-C-2', position: 'C' },
    { slot: 'slot-RW-1', position: 'RW' },
    { slot: 'slot-RW-2', position: 'RW' },
    { slot: 'slot-LW-1', position: 'LW' },
    { slot: 'slot-LW-2', position: 'LW' },
    { slot: 'slot-D-1', position: 'D' },
    { slot: 'slot-D-2', position: 'D' },
    { slot: 'slot-D-3', position: 'D' },
    { slot: 'slot-D-4', position: 'D' },
    { slot: 'slot-G-1', position: 'G' },
    { slot: 'slot-G-2', position: 'G' },
    { slot: 'slot-UTIL', position: 'UTIL' }
  ];

  // Create a map of slot -> player for quick lookup
  const slotToPlayerMap = new Map<string, MatchupPlayer>();
  starters.forEach(player => {
    const slot = slotAssignments[String(player.id)];
    if (slot) {
      slotToPlayerMap.set(slot, player);
    }
  });
      
  // Build organized starters array with empty slots and position group markers
  // This ensures both teams always show the same structure
  const organizedStarters: Array<{ player: MatchupPlayer | null; slot: string; position: string; isGroupStart?: boolean }> = 
    standardSlotOrder.map(({ slot, position }, index) => {
      // Determine if this is the start of a new position group
      const prevPosition = index > 0 ? standardSlotOrder[index - 1].position : null;
      const isGroupStart = prevPosition !== position;
      
      return {
        player: slotToPlayerMap.get(slot) || null,
        slot,
        position,
        isGroupStart
      };
    });

  const finalBench = bench;

  const renderMobilePlayerRow = (player: MatchupPlayer, isBench: boolean = false, overridePosition?: string) => {
    // Use override position if provided (for UTIL slot), otherwise use player's position
    const displayPos = overridePosition || player.position;
    const posStyles = getPositionStyles(displayPos, isBench, true);
    return (
      <div 
        className={`p-3 border-b border-border/40 ${player.isToday ? 'bg-primary/5' : ''} ${isBench ? 'opacity-80' : ''} ${posStyles.bg} ${posStyles.border} cursor-pointer hover:bg-muted/50 transition-colors`}
        onClick={() => onPlayerClick?.(player)}
      >
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground overflow-hidden border border-border/50 shadow-sm">
              {player.team}
            </div>
            <div>
              <div className="font-semibold text-sm flex items-start gap-1.5 leading-tight mb-1 text-foreground/90">
                <div className="flex-1 min-w-0">
                  {(() => {
                    const { firstName, lastName } = splitPlayerName(player.name);
                    return (
                      <>
                        <div className="line-clamp-1 leading-tight">{firstName}</div>
                        <div className="line-clamp-1 leading-tight">{lastName || '\u00A0'}</div>
                      </>
                    );
                  })()}
                </div>
                {player.isToday && (
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold text-primary ring-1 ring-inset ring-primary/20 whitespace-nowrap flex-shrink-0 mt-0.5">
                    TODAY
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground leading-none mt-0.5 flex items-center gap-1">
                <span className={`font-medium ${posStyles.text ? posStyles.text + ' font-bold' : ''}`}>{formatPositionForDisplay(displayPos)}</span>
                <span>•</span>
                {player.gameInfo ? (
                  <span className={`${player.status === 'In Game' ? 'text-primary font-medium' : ''}`}>
                    {player.gameInfo.opponent} {player.gameInfo.score ? `(${player.gameInfo.score})` : ''} {player.gameInfo.time ? `• ${player.gameInfo.time}` : ''}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-base leading-none ${posStyles.text ? posStyles.text + ' font-bold' : 'font-bold'}`}>{player.points}</div>
            {player.isToday && (
              <div className="text-[10px] text-primary font-medium mt-0.5">+{getDailyPoints(player.stats)}</div>
            )}
          </div>
        </div>
        
        {/* Mobile Stats Grid */}
        <div className="grid grid-cols-4 gap-1 bg-muted/30 rounded p-1.5 text-[10px] text-center">
         <div>
            <span className="text-muted-foreground block text-[9px] uppercase">G</span>
            <span className={`font-bold ${player.stats?.goals > 0 ? 'text-foreground' : 'text-muted-foreground/50'}`}>{player.stats?.goals || 0}</span>
         </div>
         <div>
            <span className="text-muted-foreground block text-[9px] uppercase">A</span>
            <span className={`font-bold ${player.stats?.assists > 0 ? 'text-foreground' : 'text-muted-foreground/50'}`}>{player.stats?.assists || 0}</span>
         </div>
         <div>
            <span className="text-muted-foreground block text-[9px] uppercase">SOG</span>
            <span className="text-muted-foreground/70">{player.stats?.sog || 0}</span>
         </div>
         <div>
            <span className="text-muted-foreground block text-[9px] uppercase">BLK</span>
            <span className="text-muted-foreground/70">{player.stats?.blk || 0}</span>
         </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="card-citrus matchup-team-card p-0 border-none shadow-md" style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
      <CardHeader className={`${gradientClass} py-4 border-b bg-[#E8EED9]/50 backdrop-blur-sm flex-shrink-0`}>
        <CardTitle className="text-lg font-bold tracking-tight">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex flex-col w-full">
        {/* STARTERS */}
        <div className="bg-muted/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b">
          Starting Lineup
        </div>
        
        {/* Mobile View */}
        <div className="md:hidden">
           {organizedStarters.map(({ player, position, slot }, index) => {
             // For UTIL slot, use player's actual position for color, but display "Util"
             const isUtilSlot = slot === 'slot-UTIL';
             const colorPosition = isUtilSlot && player ? player.position : position;
             const displayPosition = isUtilSlot ? 'Util' : (player ? formatPositionForDisplay(player.position) : formatPositionForDisplay(position));
             
             if (player) {
               // For UTIL slot, pass the slot position instead of player position to renderMobilePlayerRow
               // We'll handle the display in the render function
               return <div key={player.id}>{renderMobilePlayerRow(player, false, isUtilSlot ? 'Util' : undefined)}</div>;
             } else {
               // Empty slot
               const posStyles = getPositionStyles(colorPosition, false, true);
               return (
                 <div 
                   key={`empty-${index}`}
                   className={`p-3 border-b border-border/40 ${posStyles.bg} ${posStyles.border} opacity-50`}
                 >
                   <div className="flex justify-between items-center">
                     <div className="flex items-center gap-3">
                       <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center text-[10px] font-bold text-muted-foreground/50 border border-border/30">
                         —
                       </div>
                       <div>
                         <div className="font-medium text-sm text-muted-foreground/60">
                           Empty {displayPosition} Slot
                         </div>
                         <div className="text-[11px] text-muted-foreground/40">
                           No player assigned
                         </div>
                       </div>
                     </div>
                     <div className="text-right">
                       <div className="text-base font-medium text-muted-foreground/30">—</div>
                     </div>
                   </div>
                 </div>
               );
             }
           })}
        </div>

        {/* Desktop View */}
        <div className="hidden md:block table-container" style={{ width: '100%', overflow: 'visible' }}>
          <Table className="w-full" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '60px' }} />
              <col />
              <col style={{ width: '50px' }} />
              <col style={{ width: '50px' }} />
              <col style={{ width: '60px' }} />
              <col style={{ width: '60px' }} />
              <col style={{ width: '70px' }} />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border/30">
                  <TableHead className="w-[60px] text-xs font-semibold text-muted-foreground h-7 px-3 whitespace-nowrap">Pos</TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground h-7 px-3 min-w-0">Player</TableHead>
                  <TableHead className="w-[50px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">G</TableHead>
                  <TableHead className="w-[50px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">A</TableHead>
                  <TableHead className="w-[60px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">SOG</TableHead>
                  <TableHead className="w-[60px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">BLK</TableHead>
                  <TableHead className="w-[70px] text-right text-xs font-semibold text-muted-foreground h-7 px-3 whitespace-nowrap">Pts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizedStarters.map(({ player, position, slot, isGroupStart }, index) => {
                // For UTIL slot, use player's actual position for color, but display "Util"
                const isUtilSlot = slot === 'slot-UTIL';
                const colorPosition = isUtilSlot && player ? player.position : position;
                const posStyles = getPositionStyles(colorPosition, false, false);
                const displayPosition = isUtilSlot ? 'Util' : (player ? formatPositionForDisplay(player.position) : formatPositionForDisplay(position));
                
                // Add spacer row before new position groups (except the first one) - minimal on desktop
                const spacerRow = isGroupStart && index > 0 ? (
                  <TableRow key={`spacer-${index}`} className="border-0">
                    <TableCell colSpan={7} className="h-1 p-0 border-0 bg-transparent"></TableCell>
                  </TableRow>
                ) : null;
                
                if (player) {
                  // Player exists in this slot
                  return (
                    <>
                      {spacerRow}
                      <TableRow 
                        key={player.id} 
                        className={`hover:bg-muted/10 border-b border-border/20 ${player.isToday ? 'bg-primary/5' : ''} ${posStyles.bg} ${posStyles.border} cursor-pointer transition-colors`}
                        style={{ minHeight: '60px' }}
                        onClick={() => onPlayerClick?.(player)}
                      >
                      <TableCell className={`w-[60px] font-medium text-xs border-r border-border/20 py-2 px-3 align-middle ${posStyles.text ? posStyles.text + ' font-semibold' : 'text-muted-foreground'}`}>{displayPosition}</TableCell>
                      <TableCell className="py-2 px-3 align-top min-w-0">
                        <div className="flex items-start gap-2.5">
                          {/* Team Logo - Fixed position */}
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground overflow-hidden border border-border/50 shadow-sm flex-shrink-0">
                            {player.team}
                          </div>
                          
                          {/* Name and Game Info Container */}
                          <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                            {/* Name Section - Fixed height */}
                            <div className="flex-1 min-w-0 relative">
                              {(() => {
                                const { firstName, lastName } = splitPlayerName(player.name);
                                return (
                                  <div className="font-semibold text-sm text-foreground/90 hover:text-primary transition-colors h-[28.8px]">
                                    <div className="leading-[1.2] h-[14.4px] overflow-hidden text-ellipsis whitespace-nowrap">{firstName}</div>
                                    <div className="leading-[1.2] h-[14.4px] overflow-hidden text-ellipsis whitespace-nowrap">{lastName || '\u00A0'}</div>
                                  </div>
                                );
                              })()}
                              {/* TODAY Badge - Absolute positioned */}
                              {player.isToday && (
                                <span className="absolute top-0 right-0 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary ring-1 ring-inset ring-primary/20 whitespace-nowrap">
                                  TODAY
                                </span>
                              )}
                            </div>
                            
                            {/* Game Info Section - Fixed width, right-aligned */}
                            <div className="text-[11px] text-muted-foreground text-right flex-shrink-0">
                              {player.gameInfo ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="font-medium text-foreground/80 whitespace-nowrap leading-[1.2] h-[14.4px]">{player.gameInfo.opponent}</span>
                                  {player.gameInfo.time && (
                                    <span className="text-[10px] whitespace-nowrap leading-[1.2] h-[12px]">{player.gameInfo.time}</span>
                                  )}
                                  {player.gameInfo.score && (
                                    <span className="text-[10px] font-semibold text-primary whitespace-nowrap leading-[1.2] h-[12px]">{player.gameInfo.score}</span>
                                  )}
                                  {player.gameInfo.period && (
                                    <span className="text-[10px] text-primary font-medium whitespace-nowrap leading-[1.2] h-[12px]">{player.gameInfo.period}</span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="whitespace-nowrap leading-[1.2] h-[14.4px]">{player.team}</span>
                                  <span className="text-[10px] whitespace-nowrap leading-[1.2] h-[12px]">{player.gamesRemaining} Gms Left</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      
                      {/* Stats Columns */}
                      <TableCell className="w-[50px] text-center py-2 px-2 align-middle">
                        <span className={`text-xs font-medium ${player.stats?.goals > 0 ? 'font-bold text-foreground' : 'text-muted-foreground/30'}`}>
                          {player.stats?.goals || 0}
                        </span>
                      </TableCell>
                      <TableCell className="w-[50px] text-center py-2 px-2 align-middle">
                        <span className={`text-xs font-medium ${player.stats?.assists > 0 ? 'font-bold text-foreground' : 'text-muted-foreground/30'}`}>
                          {player.stats?.assists || 0}
                        </span>
                      </TableCell>
                      <TableCell className="w-[60px] text-center py-2 px-2 align-middle">
                        <span className="text-xs font-medium text-muted-foreground/70">
                          {player.stats?.sog || 0}
                        </span>
                      </TableCell>
                      <TableCell className="w-[60px] text-center py-2 px-2 align-middle">
                        <span className="text-xs font-medium text-muted-foreground/70">
                          {player.stats?.blk || 0}
                        </span>
                      </TableCell>

                      <TableCell className="text-right font-bold w-[70px] border-l border-border/20 bg-muted/5 py-2 px-3 align-middle">
                        <div className="flex flex-col items-end justify-center leading-tight">
                          <span className="text-sm">{player.points}</span>
                          {player.isToday && (
                            <span className="text-[10px] text-primary font-medium">+{getDailyPoints(player.stats)}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    </>
                  );
                } else {
                  // Empty slot - match structure of filled slots for consistent sizing
                  // For UTIL slot, always display "Util"
                  const displayPosition = slot === 'slot-UTIL' ? 'Util' : formatPositionForDisplay(position);
                  return (
                    <>
                      {spacerRow}
                      <TableRow 
                        key={`empty-${slot}-${index}`}
                        className={`border-b border-border/20 ${posStyles.bg} ${posStyles.border} opacity-50`}
                        style={{ minHeight: '60px' }}
                      >
                      <TableCell className={`w-[60px] font-medium text-xs border-r border-border/20 py-2 px-3 align-middle ${posStyles.text ? posStyles.text + ' font-semibold' : 'text-muted-foreground'}`}>
                        {displayPosition}
                      </TableCell>
                      <TableCell className="py-2 px-3 align-top min-w-0">
                        <div className="flex items-start gap-2.5">
                          {/* Team Logo - Fixed position */}
                          <div className="w-7 h-7 rounded-full bg-muted/50 flex items-center justify-center text-[10px] font-bold text-muted-foreground/50 border border-border/30 flex-shrink-0">
                            —
                          </div>
                          
                          {/* Name Section - Fixed height */}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-muted-foreground/60 h-[28.8px]">
                              <div className="line-clamp-1 leading-[1.2] h-[14.4px]">Empty Slot</div>
                              <div className="line-clamp-1 text-[11px] text-muted-foreground/40 leading-[1.2] h-[14.4px]">
                                No player assigned
                              </div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      
                      {/* Stats Columns - Empty */}
                      <TableCell className="w-[50px] text-center py-2 px-2 align-middle">
                        <span className="text-xs text-muted-foreground/20">—</span>
                      </TableCell>
                      <TableCell className="w-[50px] text-center py-2 px-2 align-middle">
                        <span className="text-xs text-muted-foreground/20">—</span>
                      </TableCell>
                      <TableCell className="w-[60px] text-center py-2 px-2 align-middle">
                        <span className="text-xs text-muted-foreground/20">—</span>
                      </TableCell>
                      <TableCell className="w-[60px] text-center py-2 px-2 align-middle">
                        <span className="text-xs text-muted-foreground/20">—</span>
                      </TableCell>

                      <TableCell className="text-right font-medium w-[70px] border-l border-border/20 bg-muted/5 py-2 px-3 align-middle">
                        <div className="flex flex-col items-end justify-center leading-tight">
                          <span className="text-sm text-muted-foreground/30">—</span>
                        </div>
                      </TableCell>
                </TableRow>
                </>
              );
                }
              })}
            </TableBody>
          </Table>
        </div>
        
        {/* BENCH SECTION */}
        {finalBench.length > 0 && (
          <>
            <div className="bg-muted/20 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-y mt-4">
              Bench
            </div>
            
            {/* Mobile View Bench */}
            <div className="md:hidden">
              {finalBench.map(p => renderMobilePlayerRow(p, true))}
            </div>

            {/* Desktop View Bench */}
            <div className="hidden md:block table-container w-full" style={{ width: '100%', overflow: 'visible' }}>
              <Table className="w-full" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '60px' }} />
                  <col />
                  <col style={{ width: '50px' }} />
                  <col style={{ width: '50px' }} />
                  <col style={{ width: '60px' }} />
                  <col style={{ width: '60px' }} />
                  <col style={{ width: '70px' }} />
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border/30">
                    <TableHead className="w-[60px] text-xs font-semibold text-muted-foreground h-7 px-3 whitespace-nowrap">Pos</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground h-7 px-3 min-w-0">Player</TableHead>
                    <TableHead className="w-[50px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">G</TableHead>
                    <TableHead className="w-[50px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">A</TableHead>
                    <TableHead className="w-[60px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">SOG</TableHead>
                    <TableHead className="w-[60px] text-center text-[10px] font-bold text-muted-foreground h-7 px-2 whitespace-nowrap">BLK</TableHead>
                    <TableHead className="w-[70px] text-right text-xs font-semibold text-muted-foreground h-7 px-3 whitespace-nowrap">Pts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finalBench.map(player => (
                <TableRow 
                  key={player.id} 
                  className={`hover:bg-muted/10 opacity-70 hover:opacity-100 transition-opacity border-b border-border/20 ${player.isToday ? 'bg-primary/5' : ''} cursor-pointer`}
                  style={{ minHeight: '60px' }}
                  onClick={() => onPlayerClick?.(player)}
                >
                  <TableCell className="w-[60px] font-medium text-muted-foreground text-xs border-r border-border/20 py-2 px-3">BN</TableCell>
                  <TableCell className="py-2 px-3 align-top min-w-0">
                    <div className="flex items-start gap-2.5">
                      {/* Team Logo - Fixed position */}
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground overflow-hidden border border-border/50 shadow-sm flex-shrink-0">
                        {player.team}
                      </div>
                      
                      {/* Name and Game Info Container */}
                      <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                        {/* Name Section - Fixed height */}
                        <div className="flex-1 min-w-0 relative">
                          {(() => {
                            const { firstName, lastName } = splitPlayerName(player.name);
                            return (
                              <div className="font-medium text-sm text-foreground/90 hover:text-primary transition-colors h-[28.8px]">
                                <div className="line-clamp-1 leading-[1.2] h-[14.4px]">{firstName}</div>
                                <div className="line-clamp-1 leading-[1.2] h-[14.4px]">{lastName || '\u00A0'}</div>
                              </div>
                            );
                          })()}
                          {/* TODAY Badge - Absolute positioned */}
                          {player.isToday && (
                            <span className="absolute top-0 right-0 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground ring-1 ring-inset ring-border whitespace-nowrap">
                              TODAY
                            </span>
                          )}
                        </div>
                        
                        {/* Game Info Section - Fixed width, right-aligned */}
                        <div className="text-[11px] text-muted-foreground text-right flex-shrink-0">
                          {player.gameInfo ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-medium text-foreground/80 whitespace-nowrap leading-[1.2] h-[14.4px]">{player.gameInfo.opponent}</span>
                              {player.gameInfo.time && (
                                <span className="text-[10px] whitespace-nowrap leading-[1.2] h-[12px]">{player.gameInfo.time}</span>
                              )}
                              {player.gameInfo.score && (
                                <span className="text-[10px] font-semibold text-primary whitespace-nowrap leading-[1.2] h-[12px]">{player.gameInfo.score}</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="whitespace-nowrap leading-[1.2] h-[14.4px]">{player.team}</span>
                              <span className="text-[10px] whitespace-nowrap leading-[1.2] h-[12px]">{player.gamesRemaining} Gms Left</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                      
                      {/* Stats Columns */}
                      <TableCell className="w-[50px] text-center py-2 px-2">
                        <span className={`text-xs font-medium ${player.stats?.goals > 0 ? 'font-bold text-foreground' : 'text-muted-foreground/30'}`}>
                          {player.stats?.goals || 0}
                        </span>
                      </TableCell>
                      <TableCell className="w-[50px] text-center py-2 px-2">
                        <span className={`text-xs font-medium ${player.stats?.assists > 0 ? 'font-bold text-foreground' : 'text-muted-foreground/30'}`}>
                          {player.stats?.assists || 0}
                        </span>
                      </TableCell>
                      <TableCell className="w-[60px] text-center py-2 px-2">
                        <span className="text-xs font-medium text-muted-foreground/70">
                          {player.stats?.sog || 0}
                        </span>
                      </TableCell>
                      <TableCell className="w-[60px] text-center py-2 px-2">
                        <span className="text-xs font-medium text-muted-foreground/70">
                          {player.stats?.blk || 0}
                        </span>
                      </TableCell>

                      <TableCell className="text-right font-medium text-muted-foreground w-[70px] border-l border-border/20 bg-muted/5 py-2 px-3">
                        <div className="flex flex-col items-end justify-center leading-tight">
                          <span className="text-sm">{player.points}</span>
                          {player.isToday && (
                            <span className="text-[10px] text-muted-foreground">+{getDailyPoints(player.stats)}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
