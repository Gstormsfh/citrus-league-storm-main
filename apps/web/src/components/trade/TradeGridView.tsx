import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeftRight,
  CheckCircle2,
  Info,
  Scale,
  Send,
  TrendingDown,
  TrendingUp,
  UserMinus,
} from 'lucide-react';
import type { Player } from '@/services/PlayerService';
import type { LeagueTeam } from '@/services/LeagueService';

/* 2026-08-19 visual audit: light "glass" surface on a dark page — see
   the surface-correction note in the armchair-gm components. bg-white/50
   composites to mid-grey on #0F1F15, where neither light nor dark text
   reaches 4.5:1. Uses the dark tile family instead. */


interface TradeGridViewProps {
  myTeamRoster: Player[];
  opponentTeams: LeagueTeam[];
  selectedPartnerTeam: LeagueTeam | undefined;
  mySelectedPlayers: string[];
  theirSelectedPlayers: string[];
  onToggleMyPlayer: (id: string) => void;
  onToggleTheirPlayer: (id: string) => void;
  onSelectPartner: (teamId: string) => void;
  onPlayerClick: (player: Player) => void;
  getPositionColor: (position: string) => string;
  myTotalValue: number;
  theirTotalValue: number;
  isFair: boolean;
  valueDiff: number;
  tradeMessage: string;
  onTradeMessageChange: (msg: string) => void;
  onSubmit: () => void;
  myAssets: Player[];
  theirAssets: Player[];
}

const POSITION_ORDER: Record<string, number> = {
  C: 0, LW: 1, RW: 2, D: 3, G: 4,
};

const sortedRoster = (roster: Player[]): Player[] => {
  return [...roster].sort((a, b) => {
    const ap = (a.position || '').toUpperCase();
    const bp = (b.position || '').toUpperCase();
    const aOrder = POSITION_ORDER[ap] ?? 99;
    const bOrder = POSITION_ORDER[bp] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (b.points || 0) - (a.points || 0);
  });
};

const PlayerCell = ({
  player,
  isSelected,
  selectionTone,
  onSelect,
  onOpenCard,
  getPositionColor,
}: {
  player: Player;
  isSelected: boolean;
  selectionTone: 'send' | 'receive';
  onSelect: () => void;
  onOpenCard: () => void;
  getPositionColor: (position: string) => string;
}) => {
  const colorClasses = getPositionColor(player.position);
  const ringClasses = isSelected
    ? selectionTone === 'send'
      ? 'ring-2 ring-red-500 shadow-md'
      : 'ring-2 ring-green-500 shadow-md'
    : '';

  return (
    <div
      className={`relative rounded-md border ${colorClasses} ${ringClasses} p-2 transition-all cursor-pointer overflow-hidden`}
      onClick={onOpenCard}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <Badge variant="outline" className="h-4 px-1 text-[9px] font-semibold bg-pastel-surface-tile border-black/10">
          {(player.position || '').toUpperCase()}
        </Badge>
        {isSelected && (
          <CheckCircle2
            className={`h-3.5 w-3.5 ${selectionTone === 'send' ? 'text-red-500' : 'text-green-600'}`}
          />
        )}
      </div>
      <div className="text-[11px] font-semibold leading-tight line-clamp-2 min-h-[28px]">
        {player.full_name}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">
        {player.team} • {player.points || 0} pts
      </div>
      <div className="flex items-center gap-1 mt-1.5">
        <Button
          size="sm"
          variant={isSelected ? 'default' : 'outline'}
          className={`h-6 px-1.5 text-[10px] flex-1 ${
            isSelected
              ? selectionTone === 'send'
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-pastel-surface-tile'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          {isSelected ? (
            <UserMinus className="h-3 w-3" />
          ) : selectionTone === 'send' ? (
            <>
              <TrendingDown className="h-3 w-3 mr-0.5" /> Send
            </>
          ) : (
            <>
              <TrendingUp className="h-3 w-3 mr-0.5" /> Get
            </>
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 bg-white/5 hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            onOpenCard();
          }}
          aria-label="Player details"
        >
          <Info className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};

const TeamRosterGrid = ({
  title,
  badgeLabel,
  badgeClass,
  roster,
  selectedPlayers,
  selectionTone,
  onSelectPlayer,
  onPlayerClick,
  getPositionColor,
  isPartnerSelector,
  isCurrentPartner,
  onClickAsPartner,
}: {
  title: string;
  badgeLabel: string;
  badgeClass: string;
  roster: Player[];
  selectedPlayers: string[];
  selectionTone: 'send' | 'receive';
  onSelectPlayer: (id: string) => void;
  onPlayerClick: (player: Player) => void;
  getPositionColor: (position: string) => string;
  isPartnerSelector?: boolean;
  isCurrentPartner?: boolean;
  onClickAsPartner?: () => void;
}) => {
  const sorted = useMemo(() => sortedRoster(roster), [roster]);

  return (
    <Card
      className={`flex flex-col border ${
        isCurrentPartner ? 'border-green-500/60 shadow-md' : 'border-border'
      }`}
    >
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2 truncate">
            <Badge className={`${badgeClass} text-[10px] px-1.5 py-0`}>{badgeLabel}</Badge>
            <span className="truncate">{title}</span>
          </CardTitle>
          {isPartnerSelector && !isCurrentPartner && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              onClick={onClickAsPartner}
            >
              Trade with
            </Button>
          )}
          {isCurrentPartner && (
            <Badge variant="outline" className="text-[10px] border-green-500/60 text-green-700 bg-green-50">
              Active partner
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        {sorted.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-4 text-center">
            No players on roster
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
            {sorted.map((player) => (
              <PlayerCell
                key={player.id}
                player={player}
                isSelected={selectedPlayers.includes(player.id)}
                selectionTone={selectionTone}
                onSelect={() => onSelectPlayer(player.id)}
                onOpenCard={() => onPlayerClick(player)}
                getPositionColor={getPositionColor}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const TradeGridView = ({
  myTeamRoster,
  opponentTeams,
  selectedPartnerTeam,
  mySelectedPlayers,
  theirSelectedPlayers,
  onToggleMyPlayer,
  onToggleTheirPlayer,
  onSelectPartner,
  onPlayerClick,
  getPositionColor,
  myTotalValue,
  theirTotalValue,
  isFair,
  valueDiff,
  tradeMessage,
  onTradeMessageChange,
  onSubmit,
  myAssets,
  theirAssets,
}: TradeGridViewProps) => {
  const canSubmit =
    myAssets.length > 0 && theirAssets.length > 0 && !!selectedPartnerTeam;

  return (
    <div className="flex flex-col gap-4">
      {/* Sticky Trade Proposal Bar */}
      <Card className="border-primary/30 shadow-md sticky top-2 z-20 bg-background/95 backdrop-blur">
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" /> Trade Proposal
            </CardTitle>
            <div className="flex items-center gap-2">
              {selectedPartnerTeam && (
                <Badge variant={isFair ? 'secondary' : 'outline'} className="text-[10px]">
                  {Math.abs(valueDiff) < 10 ? 'Balanced' : `Δ ${valueDiff > 0 ? '+' : ''}${valueDiff}`}
                </Badge>
              )}
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-500 text-white"
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                <Send className="h-4 w-4 mr-2" /> Submit Trade Offer
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* You Receive */}
            <div className="rounded-md border bg-green-500/5 border-green-500/20 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-green-700 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> You Receive
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">Val: {theirTotalValue}</span>
              </div>
              {theirAssets.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic py-1">
                  Tap "Get" on opponent players below
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {theirAssets.map((p) => (
                    <Badge
                      key={p.id}
                      variant="outline"
                      className="bg-white text-[10px] py-0.5 cursor-pointer hover:bg-red-50"
                      onClick={() => onToggleTheirPlayer(p.id)}
                    >
                      {(p.position || '').toUpperCase()} {p.full_name}
                      <UserMinus className="h-2.5 w-2.5 ml-1" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {/* You Send */}
            <div className="rounded-md border bg-red-500/5 border-red-500/20 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-red-600 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> You Send
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">Val: {myTotalValue}</span>
              </div>
              {myAssets.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic py-1">
                  Tap "Send" on your players below
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {myAssets.map((p) => (
                    <Badge
                      key={p.id}
                      variant="outline"
                      className="bg-white text-[10px] py-0.5 cursor-pointer hover:bg-red-50"
                      onClick={() => onToggleMyPlayer(p.id)}
                    >
                      {(p.position || '').toUpperCase()} {p.full_name}
                      <UserMinus className="h-2.5 w-2.5 ml-1" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Input
            placeholder="Add an optional message..."
            className="mt-2 h-8 text-xs"
            value={tradeMessage}
            onChange={(e) => onTradeMessageChange(e.target.value)}
          />
          {!selectedPartnerTeam && (
            <p className="text-[10px] text-muted-foreground italic mt-2 flex items-center gap-1">
              <ArrowLeftRight className="h-3 w-3" />
              Pick a player from any opponent team below to set your trading partner.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Position Legend */}
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider">Positions:</span>
        {(['C', 'LW', 'RW', 'D', 'G'] as const).map((pos) => (
          <span key={pos} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-3 rounded border ${getPositionColor(pos)}`} />
            {pos}
          </span>
        ))}
      </div>

      {/* Roster Grid for All Teams */}
      <ScrollArea className="max-h-[calc(100vh-360px)] min-h-[400px] pr-2">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* My team first */}
          <TeamRosterGrid
            title="My Team"
            badgeLabel="YOU"
            badgeClass="bg-primary text-primary-foreground"
            roster={myTeamRoster}
            selectedPlayers={mySelectedPlayers}
            selectionTone="send"
            onSelectPlayer={onToggleMyPlayer}
            onPlayerClick={onPlayerClick}
            getPositionColor={getPositionColor}
          />
          {/* All opponents */}
          {opponentTeams.map((team) => {
            const isCurrentPartner =
              selectedPartnerTeam && String(selectedPartnerTeam.id) === String(team.id);
            return (
              <TeamRosterGrid
                key={team.id}
                title={team.name}
                badgeLabel={team.logo}
                badgeClass="bg-secondary text-secondary-foreground"
                roster={team.roster}
                selectedPlayers={isCurrentPartner ? theirSelectedPlayers : []}
                selectionTone="receive"
                onSelectPlayer={(id) => {
                  if (!isCurrentPartner) {
                    onSelectPartner(String(team.id));
                    // Defer selection until after partner switch propagates.
                    // The user will tap again to select the player.
                    return;
                  }
                  onToggleTheirPlayer(id);
                }}
                onPlayerClick={onPlayerClick}
                getPositionColor={getPositionColor}
                isPartnerSelector
                isCurrentPartner={!!isCurrentPartner}
                onClickAsPartner={() => onSelectPartner(String(team.id))}
              />
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
