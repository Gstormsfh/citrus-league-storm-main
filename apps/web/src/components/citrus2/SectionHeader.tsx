/**
 * Standard section heading pattern: small-caps eyebrow, big title, optional sub.
 * Used to introduce every section on a citrus2 page.
 */
export function SectionHeader({
  eyebrow,
  title,
  sub,
  align = 'left',
}: {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: string;
  align?: 'left' | 'center';
}) {
  const alignClass = align === 'center' ? 'text-center' : '';
  return (
    <div className={`mb-10 ${alignClass}`}>
      {eyebrow && (
        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
          {eyebrow}
        </div>
      )}
      <h2 className="font-sans font-black text-[2.25rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream leading-tight">
        {title}
      </h2>
      {sub && (
        <p
          className={`text-[15px] text-white/55 leading-relaxed mt-4 ${
            align === 'center' ? 'max-w-xl mx-auto' : 'max-w-2xl'
          }`}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
