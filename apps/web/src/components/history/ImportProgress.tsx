/**
 * One import job, watched until it settles. Polls the job every couple of
 * seconds while it runs; says which seasons landed, which need a sign-in,
 * and where the trophy room is.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { importApi, type ImportJob } from '@/api/imports';
import { seasonLabel } from './trophyLabels';
import { isSettled, progressLine } from './importProgress';
import { Chip, Eyebrow, Panel } from './ui';

export interface ImportProgressProps {
  leagueId: string;
  job: ImportJob;
  /** Rendered under a job parked on credentials (the ESPN sign-in panel). */
  credentialsSlot?: React.ReactNode;
  pollMs?: number;
}

export function ImportProgress({ leagueId, job: initial, credentialsSlot, pollMs = 2000 }: ImportProgressProps) {
  const [job, setJob] = useState(initial);
  useEffect(() => { setJob(initial); }, [initial]);
  useEffect(() => {
    if (isSettled(job.status)) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await importApi.getJob(leagueId, job.id);
        const next = (res as { data?: ImportJob }).data;
        if (!cancelled && next) setJob(next);
      } catch {
        // A missed poll is not a failed import; the next one will tell us.
      }
    };
    const handle = setInterval(() => { void tick(); }, pollMs);
    return () => { cancelled = true; clearInterval(handle); };
  }, [job.id, job.status, leagueId, pollMs]);

  const settled = isSettled(job.status);
  const total = job.seasons_discovered.length;
  const done = job.seasons_imported.length;
  const pct = total ? Math.round((done / total) * 100) : job.status === 'done' ? 100 : 0;
  const warnings = (job.progress.seasons ?? []).flatMap((s) => s.warnings.map((w) => `${seasonLabel(s.season)}: ${w}`));

  return (
    <Panel testId="import-progress" className={settled && job.status === 'done' ? 'ring-pressbox-sage/40' : undefined}>
      <Eyebrow>✦ {job.platform === 'espn' ? 'ESPN' : 'Yahoo'} import</Eyebrow>
      <p className="mt-1 font-condensed font-bold text-[18px] text-pressbox-text" role="status" aria-live="polite">{progressLine(job)}</p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
        <div className={`h-full rounded-full ${job.status === 'failed' ? 'bg-pressbox-grapefruit' : 'bg-pressbox-orange'} transition-[width]`} style={{ width: `${pct}%` }} />
      </div>
      {job.seasons_discovered.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Seasons">
          {job.seasons_discovered.map((s) => {
            const landed = job.seasons_imported.includes(s);
            const parked = job.seasons_needing_credentials.includes(s);
            return <Chip key={s} tone={landed ? 'sage' : parked ? 'grapefruit' : 'cream'}>{seasonLabel(s)}</Chip>;
          })}
        </div>
      )}
      {job.status === 'failed' && job.error?.message && (
        <p role="alert" className="mt-2 font-barlow text-[13px] text-pressbox-grapefruit-text">{job.error.message}</p>
      )}
      {(job.status === 'needs_credentials' || (job.status === 'partial' && job.seasons_needing_credentials.length > 0)) && credentialsSlot && (
        <div className="mt-3">{credentialsSlot}</div>
      )}
      {warnings.length > 0 && settled && (
        <details className="mt-3">
          <summary className="cursor-pointer font-barlow text-[12px] text-white/50">{warnings.length} {warnings.length === 1 ? 'note' : 'notes'} from the import</summary>
          <ul className="mt-1 space-y-0.5 font-barlow text-[12px] text-white/50">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
      {settled && done > 0 && (
        <Link to={`/league/${leagueId}/history`} className="mt-3 inline-flex h-10 items-center rounded-[10px] bg-pressbox-orange px-4 font-condensed font-bold text-[14px] uppercase tracking-[0.06em] text-pressbox-orange-ink">
          Open the trophy room
        </Link>
      )}
    </Panel>
  );
}
