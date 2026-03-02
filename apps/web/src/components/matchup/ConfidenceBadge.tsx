/**
 * ConfidenceBadge Component
 * Displays a visual indicator of projection confidence based on MC uncertainty analysis.
 * When a confidence_label from the MC engine is available, uses it directly.
 * Otherwise falls back to score-based thresholds.
 */

interface ConfidenceBadgeProps {
  score: number; // 0.0 to 1.0
  label?: string; // "High" | "Medium" | "Low" from MC engine
}

export const ConfidenceBadge = ({ score, label }: ConfidenceBadgeProps) => {
  // Use MC-derived label if available, otherwise compute from score
  const resolvedLabel = label || (
    score >= 0.60 ? 'High' :
    score >= 0.35 ? 'Medium' :
    'Low'
  );

  const config =
    resolvedLabel === 'High' ? { color: 'bg-green-500', textColor: 'text-white' } :
    resolvedLabel === 'Medium' || resolvedLabel === 'Solid' ? { color: 'bg-blue-500', textColor: 'text-white' } :
    { color: 'bg-orange-500', textColor: 'text-white' };

  return (
    <div className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${config.color} ${config.textColor}`}>
      {resolvedLabel}
    </div>
  );
};
