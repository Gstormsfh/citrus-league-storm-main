interface CenterColumnProps {
  position: string;
  userPlayer?: { projectedPoints?: number; position?: string } | null;
  opponentPlayer?: { projectedPoints?: number; position?: string } | null;
}

// Get position color styles for center column - High-Contrast Citrus Palette
const getPositionStyles = (position: string): { bg: string; border: string; text: string } => {
  const pos = position?.toUpperCase() || '';
  if (pos.includes('C') && !pos.includes('LW') && !pos.includes('RW')) {
    // Center - Bright Lemon Peel (#F9E076)
    return { bg: 'rgba(249, 224, 118, 0.2)', border: 'rgba(249, 224, 118, 0.6)', text: '#F9E076' };
  }
  if (pos.includes('LW') || pos === 'L' || pos === 'LEFT' || pos === 'LEFTWING') {
    // Left Wing - Deep Lime Green (#459345)
    return { bg: 'rgba(69, 147, 69, 0.2)', border: 'rgba(69, 147, 69, 0.6)', text: '#459345' };
  }
  if (pos.includes('RW') || pos === 'R' || pos === 'RIGHT' || pos === 'RIGHTWING') {
    // Right Wing - Zesty Tangerine (#F9A436)
    return { bg: 'rgba(249, 164, 54, 0.2)', border: 'rgba(249, 164, 54, 0.6)', text: '#F9A436' };
  }
  if (pos.includes('D')) {
    // Defense - Yellow-Green (#A8D85C)
    return { bg: 'rgba(168, 216, 92, 0.2)', border: 'rgba(168, 216, 92, 0.6)', text: '#A8D85C' };
  }
  if (pos.includes('G')) {
    // Goalie - Contrast Grapefruit Pink (#FF6F80)
    return { bg: 'rgba(255, 111, 128, 0.2)', border: 'rgba(255, 111, 128, 0.6)', text: '#FF6F80' };
  }
  if (pos === 'UTIL' || pos === 'UTILITY') {
    // Utility - Citrus Apricot (#FFB84D) - distinct orange-yellow blend
    return { bg: 'rgba(255, 184, 77, 0.2)', border: 'rgba(255, 184, 77, 0.6)', text: '#FFB84D' };
  }
  return { bg: 'hsl(var(--muted) / 0.15)', border: 'hsl(var(--border) / 0.3)', text: 'hsl(var(--foreground))' };
};

export const CenterColumn = ({ position, userPlayer, opponentPlayer }: CenterColumnProps) => {
  // For UTIL slot, use player's actual position for color, but display "Util"
  const isUtilSlot = position?.toUpperCase() === 'UTIL' || position?.toUpperCase() === 'UTILITY';
  const colorPosition = isUtilSlot && userPlayer?.position 
    ? userPlayer.position 
    : (isUtilSlot && opponentPlayer?.position 
      ? opponentPlayer.position 
      : position);
  const displayPosition = isUtilSlot ? 'Util' : position;
  
  const positionStyles = getPositionStyles(colorPosition);
  
  return (
    <div 
      className="matchup-center-column"
      style={{
        background: positionStyles.bg,
        borderLeftColor: positionStyles.border,
        borderRightColor: positionStyles.border,
      }}
    >
      <span 
        className="position-label"
        style={{ color: positionStyles.text }}
      >
        {displayPosition}
      </span>
    </div>
  );
};

