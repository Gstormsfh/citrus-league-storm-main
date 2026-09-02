import { MASCOTS, type MascotId } from '@/constants/mascots';

/**
 * Round mascot portrait. Pulls image + alt text from the central mascots library
 * so character DNA stays consistent everywhere they appear.
 */
export function MascotAvatar({
  id,
  size = 'md',
  ring = true,
  className = '',
}: {
  id: MascotId;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  ring?: boolean;
  className?: string;
}) {
  const mascot = MASCOTS[id];
  const dim =
    size === 'xl'
      ? 'w-32 h-32'
      : size === 'lg'
      ? 'w-20 h-20'
      : size === 'md'
      ? 'w-12 h-12'
      : size === 'sm'
      ? 'w-9 h-9'
      : 'w-7 h-7';
  const ringClass = ring ? 'ring-2 ring-pastel-orange/40' : '';
  return (
    <img
      src={mascot.image}
      alt={`${mascot.name}, ${mascot.position}`}
      className={`${dim} rounded-full object-cover ${ringClass} ${className}`}
      loading="lazy"
    />
  );
}

/**
 * Square mascot portrait inside a rounded card frame — for the squad lineup grid.
 * Bigger frame, no clipping into a circle.
 */
export function MascotPortrait({
  id,
  className = '',
}: {
  id: MascotId;
  className?: string;
}) {
  const mascot = MASCOTS[id];
  return (
    <div className={`aspect-square rounded-xl overflow-hidden bg-pastel-sage-soft/40 ${className}`}>
      <img
        src={mascot.image}
        alt={`${mascot.name}, ${mascot.position}`}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
}
