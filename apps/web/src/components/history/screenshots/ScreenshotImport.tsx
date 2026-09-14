/**
 * Bring a league over from screenshots: any platform, no login of any kind.
 *
 * Pick the pages from the camera roll or a folder (standings, playoffs,
 * draft results, transactions, keepers, traded picks, settings), tap Read,
 * check what was read, tap Import. The images are scaled down in the
 * browser, sent once, and never stored; the reading is what is kept.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { importApi, type ImportJob, type ImportPlatform, type ScreenshotPage, type ScreenshotReadOutcome, type ScreenshotStatus } from '@/api/imports';
import { Chip, HistoryButton, inputClass } from '../ui';
import { prepareImages, type PreparedImage } from './imagePrep';
import { ScreenshotReview } from './ScreenshotReview';
import { tidyPages } from './reviewHelpers';
import { PAGE_GUIDE } from './pageGuide';

const dataOf = <T,>(res: unknown): T | null => ((res as { data?: T })?.data ?? null);

const PLATFORM_OPTIONS: Array<{ value: ImportPlatform; label: string }> = [
  { value: 'yahoo', label: 'Yahoo' }, { value: 'espn', label: 'ESPN' }, { value: 'fantrax', label: 'Fantrax' }, { value: 'cbs', label: 'CBS' }, { value: 'sleeper', label: 'Sleeper' }, { value: 'manual', label: 'Somewhere else' },
];

export interface ScreenshotImportProps {
  leagueId: string | null;
  leagueName: string | null;
  onJob: (job: ImportJob) => void;
}

export function ScreenshotImport({ leagueId, leagueName, onJob }: ScreenshotImportProps) {
  const status = useQuery({ queryKey: ['screenshot-status'], staleTime: 5 * 60_000, queryFn: async () => dataOf<ScreenshotStatus>(await importApi.screenshotStatus()) });
  const [platform, setPlatform] = useState<ImportPlatform>('yahoo');
  const [sourceName, setSourceName] = useState('');
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ScreenshotReadOutcome | null>(null);
  const [pages, setPages] = useState<ScreenshotPage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const maxImages = status.data?.maxImages ?? 12;

  useEffect(() => { if (leagueName && !sourceName) setSourceName(leagueName); }, [leagueName, sourceName]);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    setPreparing(true);
    try {
      const prepared = await prepareImages(Array.from(list).slice(0, maxImages - images.length));
      setImages((cur) => [...cur, ...prepared].slice(0, maxImages));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const read = async () => {
    if (!leagueId || !images.length) return;
    setError(null);
    setReading(true);
    try {
      const out = dataOf<ScreenshotReadOutcome>(await importApi.readScreenshots(leagueId, {
        platform, leagueName: sourceName.trim() || null, season: null,
        images: images.map((i) => ({ data: i.data, mediaType: i.mediaType })),
      }));
      if (!out) throw new Error('The reader sent nothing back. Try again.');
      setOutcome(out);
      setPages(out.pages);
    } catch (e) {
      setError((e as Error).message || 'The screenshots could not be read. Try again in a moment.');
    } finally {
      setReading(false);
    }
  };

  const confirm = async ({ finished, rostersAsKeepers }: { finished: Record<string, boolean>; rostersAsKeepers: boolean }) => {
    if (!leagueId || !outcome) return;
    setConfirming(true);
    try {
      const job = dataOf<ImportJob>(await importApi.confirmScreenshots(leagueId, outcome.job.id, { platform, leagueName: sourceName.trim() || null, pages: tidyPages(pages), finished, rostersAsKeepers }));
      if (job) onJob(job);
    } finally {
      setConfirming(false);
    }
  };

  const reset = () => { setOutcome(null); setPages([]); setImages([]); setError(null); };

  if (status.data && !status.data.configured) {
    return <p className="mt-1 font-barlow text-[13px] leading-[1.45] text-white/60" data-testid="screenshots-unavailable">Screenshot import is on its way.</p>;
  }

  if (outcome) {
    return (
      <div className="mt-2">
        <ScreenshotReview pages={pages} previews={images.map((i) => i.previewUrl)} platform={platform} onChange={setPages} onConfirm={confirm} onBack={reset} busy={confirming} />
      </div>
    );
  }

  return (
    <div className="mt-1" data-testid="screenshot-import">
      <p className="font-condensed font-bold text-[16px] text-pressbox-text">Screenshots. Any platform. No login.</p>
      <p className="mt-0.5 font-barlow text-[12px] text-white/50">
        Start with the one page that lists every past champion. Add the rest as you like. Up to {maxImages} at a time; more seasons in another go.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">Platform</span>
          <select aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value as ImportPlatform)} className={inputClass}>
            {PLATFORM_OPTIONS.map((o) => <option key={o.value} value={o.value} className="text-black">{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">League name on the other platform</span>
          <input aria-label="League name on the other platform" value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="League name there" className={inputClass} />
        </label>
      </div>
      <div className="mt-2 rounded-[10px] bg-white/[0.03] px-3 py-2" data-testid="page-guide">
        <p className="font-plex font-semibold text-[9px] uppercase tracking-[0.12em] text-white/55">What to screenshot{platform === 'manual' ? '' : `, in ${PLATFORM_OPTIONS.find((o) => o.value === platform)?.label}'s words`}</p>
        <ul className="mt-1 space-y-1">
          {PAGE_GUIDE[platform].map((row) => (
            <li key={row.kind} className="font-barlow text-[12px] leading-[1.4] text-white/70">
              <span className={row.essential ? 'font-semibold text-pressbox-text' : 'text-pressbox-text/90'}>{row.label}</span>
              {row.essential && <span className="ml-1.5 font-plex text-[9px] uppercase tracking-[0.1em] text-pressbox-orange-soft">Start here</span>}
              {row.perSeason && <span className="ml-1.5 font-plex text-[9px] uppercase tracking-[0.1em] text-white/55">One per season</span>}
              <span className="block text-white/55">{row.path}. Gives: {row.gives}.</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-2">
        <input ref={fileRef} id="screenshot-files" type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void addFiles(e.target.files)} aria-label="Screenshots" />
        <label htmlFor="screenshot-files" className="focus-citrus inline-flex h-10 cursor-pointer items-center rounded-[10px] border border-white/15 px-4 font-condensed font-bold text-[14px] uppercase tracking-[0.06em] text-pressbox-text">
          {images.length ? 'Add more screenshots' : 'Choose screenshots'}
        </label>
        {preparing && <span className="ml-2 font-barlow text-[12px] text-white/55">Preparing…</span>}
      </div>
      {images.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" data-testid="screenshot-thumbs">
          {images.map((img, i) => (
            <li key={i} className="relative">
              <img src={img.previewUrl} alt={img.name} className="h-20 w-14 rounded-[6px] object-cover object-top ring-1 ring-white/10" />
              <button type="button" aria-label={`Remove ${img.name}`} onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-pressbox-surface font-plex text-[12px] text-white/70 ring-1 ring-white/20">×</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 font-barlow text-[13px] text-pressbox-grapefruit-text">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <HistoryButton busy={reading} disabled={!leagueId || !images.length || reading} onClick={() => void read()}>
          {reading ? 'Reading' : !leagueId ? 'Choose a Citrus league first' : images.length === 0 ? 'Read my screenshots' : `Read ${images.length} ${images.length === 1 ? 'screenshot' : 'screenshots'}`}
        </HistoryButton>
        {images.length > 0 && <Chip>{images.length} of {maxImages}</Chip>}
      </div>
      {reading && <p className="mt-1.5 font-barlow text-[12px] text-white/55">Reading takes up to a minute for a dozen pages.</p>}
    </div>
  );
}
