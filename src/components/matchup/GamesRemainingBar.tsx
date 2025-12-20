interface GRBarProps {
  played: number;
  remaining: number;
  isLocked: boolean;
  showLabel?: boolean; // Default true
  size?: 'sm' | 'md' | 'lg'; // Default 'md'
}

export const GamesRemainingBar = ({ 
  played, 
  remaining, 
  isLocked, 
  showLabel = true,
  size = 'md'
}: GRBarProps) => {
  const total = played + remaining;
  const sizeClasses = {
    sm: { pip: 'h-1.5 w-3', text: 'text-xs' },
    md: { pip: 'h-2 w-4', text: 'text-xs' },
    lg: { pip: 'h-3 w-5', text: 'text-sm' }
  };
  
  if (total === 0) {
    return showLabel ? (
      <span className={`${sizeClasses[size].text} text-gray-400`}>No games</span>
    ) : null;
  }
  
  return (
    <div className="flex gap-1 items-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`${sizeClasses[size].pip} rounded-sm ${
            i < played 
              ? 'bg-gray-400' // Game finished
              : i === played && isLocked 
                ? 'bg-orange-500 animate-pulse' // Live/Locked game
                : 'bg-green-500' // Future game
          }`}
        />
      ))}
      {showLabel && (
        <span className={`${sizeClasses[size].text} ml-2 font-bold text-gray-500`}>
          {remaining} GR
        </span>
      )}
    </div>
  );
};
