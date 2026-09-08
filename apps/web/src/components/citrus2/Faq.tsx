import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface FaqEntry {
  q: string;
  a: string;
}

function FaqItem({ q, a }: FaqEntry) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/10">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left group"
        aria-expanded={open}
      >
        <span className="font-condensed font-bold uppercase tracking-[0.04em] text-[19px] text-pressbox-text group-hover:text-pressbox-orange-soft transition-colors">
          {q}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-white/55 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <p className="pb-5 font-barlow font-normal text-[16px] text-pressbox-text/75 leading-relaxed max-w-2xl">{a}</p>
      )}
    </div>
  );
}

/**
 * FAQ accordion. Pass an array of `{ q, a }` entries.
 */
export function Faq({ entries }: { entries: FaqEntry[] }) {
  return (
    <div className="border-t border-white/10">
      {entries.map((f) => (
        <FaqItem key={f.q} q={f.q} a={f.a} />
      ))}
    </div>
  );
}
