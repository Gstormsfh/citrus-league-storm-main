/**
 * Small pulsing dot for "live" indicators. Default orange (matches the live-data
 * accent in citrus2), accepts a sage variant for subtle non-critical pulses.
 */
export function LivePulse({
  tone = 'orange',
  size = 'sm',
}: {
  tone?: 'orange' | 'sage';
  size?: 'xs' | 'sm';
}) {
  const dim = size === 'xs' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  const color = tone === 'orange' ? 'bg-pastel-orange' : 'bg-pastel-sage';
  return (
    <span className={`relative flex ${dim}`} aria-hidden="true">
      <span className={`absolute inline-flex w-full h-full ${color} rounded-full opacity-75 animate-ping`} />
      <span className={`relative inline-flex ${dim} ${color} rounded-full`} />
    </span>
  );
}

/**
 * Eyebrow chip — the small caps label that sits above section headlines.
 * Optional left-side LivePulse for "live now" / "drafts open" energy.
 */
export function Eyebrow({
  children,
  pulse = false,
  className = '',
}: {
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-pastel-orange/15 ring-1 ring-pastel-orange/30 ${className}`}
    >
      {pulse && <LivePulse size="xs" />}
      <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-orange-soft leading-none font-bold">
        {children}
      </span>
    </div>
  );
}
