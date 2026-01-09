
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Player = {
  id: number;
  name: string;
  position: string;
  number: number;
  starter: boolean;
  stats: Record<string, string | number>;
  team: string;
  height: string;
  weight: string;
  age: number;
  experience: string;
  image: string;
};

type PlayerCardProps = {
  player: Player;
  onClick?: () => void;
  draggable?: boolean;
  className?: string;
};

export const PlayerCard = ({ player, onClick, draggable = true, className }: PlayerCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: player.id });

  const style = draggable ? {
    transform: CSS.Transform.toString(transform),
    transition,
  } : undefined;

  const getAbbreviation = (position: string) => {
    switch (position) {
      case 'Centre': return 'C';
      case 'Right Wing': return 'RW';
      case 'Left Wing': return 'LW';
      case 'Defence': return 'D';
      case 'Goalie': return 'G';
      default: return position;
    }
  };

  const isGoalie = player.position === 'Goalie';

  const dragProps = draggable ? {
    ...attributes,
    ...listeners,
  } : {};

  return (
    <Card
      ref={draggable ? setNodeRef : undefined}
      style={style}
      {...dragProps}
      className={cn(`overflow-hidden cursor-pointer border-4 rounded-varsity shadow-patch hover:shadow-[0_8px_0_rgba(27,48,34,0.3)] corduroy-texture ${
        player.starter 
          ? "border-citrus-sage hover:border-citrus-orange" 
          : "border-citrus-forest/30"
      } transition-all hover:-translate-y-1`, className)}
      onClick={onClick}
    >
      <div className="aspect-square relative">
        <img 
          src={player.image} 
          alt={player.name} 
          className="object-cover w-full h-full"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-citrus-forest/90 via-citrus-forest/40 to-transparent flex flex-col justify-end p-3">
          <Badge 
            className={`absolute top-2 right-2 font-varsity font-black text-xs border-2 shadow-patch ${
              player.starter 
                ? "bg-citrus-sage border-citrus-forest text-citrus-cream" 
                : "bg-citrus-cream/80 border-citrus-sage text-citrus-forest"
            }`}
          >
            {getAbbreviation(player.position)}
          </Badge>
          <h3 className="text-citrus-cream font-varsity font-bold uppercase tracking-tight">{player.name}</h3>
          <div className="flex justify-between items-center">
            <span className="text-citrus-cream/90 text-xs font-display">{player.team}</span>
            <span className="text-citrus-cream/90 text-xs font-mono">#{player.number}</span>
          </div>
        </div>
      </div>
      <div className="p-3 bg-gradient-to-br from-citrus-cream to-citrus-sage/10 border-t-4 border-citrus-sage/40">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center p-2 bg-citrus-cream/60 rounded-lg border-2 border-citrus-sage/30">
            <div className="text-citrus-charcoal font-display font-semibold">{isGoalie ? "W" : "G"}</div>
            <div className="font-varsity font-black text-lg text-citrus-forest">{isGoalie ? player.stats.wins : player.stats.goals}</div>
          </div>
          <div className="text-center p-2 bg-citrus-cream/60 rounded-lg border-2 border-citrus-sage/30">
            <div className="text-citrus-charcoal font-display font-semibold">{isGoalie ? "GAA" : "A"}</div>
            <div className="font-varsity font-black text-lg text-citrus-forest">{isGoalie ? (player.stats.gaa?.toFixed(2) ?? '0.00') : player.stats.assists}</div>
          </div>
          <div className="text-center p-2 bg-citrus-cream/60 rounded-lg border-2 border-citrus-sage/30">
            <div className="text-citrus-charcoal font-display font-semibold">{isGoalie ? "SV%" : "PTS"}</div>
            <div className="font-varsity font-black text-lg text-citrus-forest">{isGoalie ? (player.stats.savePct ? (player.stats.savePct * 100).toFixed(3) : '0.000') + '%' : player.stats.points}</div>
          </div>
        </div>
      </div>
    </Card>
  );
};
