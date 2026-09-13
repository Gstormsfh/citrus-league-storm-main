import type { CitrusNote } from '@/hooks/useCitrusPlayerNotes';

export function OutlookSources({ note }: { note: CitrusNote }) {
  const sources = (note.news_sources ?? []).filter(source => {
    try { const u = new URL(source.url); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }
    catch { return false; }
  });
  if (!sources.length) return null;
  return <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
    {sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {source.source} · {source.published_at.slice(0, 10)}
    </a>)}
  </div>;
}
