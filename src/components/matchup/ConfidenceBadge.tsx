/**
 * ConfidenceBadge Component
 * Displays a visual indicator of projection confidence based on sample size and data quality
 */

interface ConfidenceBadgeProps {
  score: number; // 0.0 to 1.0
}

export const ConfidenceBadge = ({ score }: ConfidenceBadgeProps) => {
  // Logic: 0.8+ is High, 0.5-0.8 is Medium, <0.5 is Low/Experimental
  const config = 
    score >= 0.8 ? { color: 'bg-green-500', label: 'High' } :
    score >= 0.5 ? { color: 'bg-blue-500', label: 'Solid' } :
    { color: 'bg-orange-500', label: 'Speculative' };

  return (
    <div className={`text-[10px] px-1.5 py-0.5 rounded-full text-white font-bold ${config.color}`}>
      {config.label}
    </div>
  );
};
