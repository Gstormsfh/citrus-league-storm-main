/**
 * The import job's state, in words. Pure, beside the component that draws it.
 */
import type { ImportJob } from '@/api/imports';

const SETTLED: ReadonlySet<ImportJob['status']> = new Set(['done', 'partial', 'failed', 'needs_credentials']);

export function isSettled(status: ImportJob['status']): boolean {
  return SETTLED.has(status);
}

export function progressLine(job: ImportJob): string {
  const total = job.seasons_discovered.length;
  const done = job.seasons_imported.length;
  switch (job.status) {
    case 'queued': return 'Queued';
    case 'discovering': return 'Finding every season';
    case 'importing': return total ? `Importing season ${Math.min(done + 1, total)} of ${total}` : 'Importing';
    case 'matching': return 'Matching players';
    case 'computing': return 'Building the record book';
    case 'done': return `${done} ${done === 1 ? 'season' : 'seasons'} imported`;
    case 'partial': return job.error?.code === 'THROTTLED'
      ? `${done} of ${total} seasons imported. The source asked us to slow down; the rest will follow.`
      : `${done} of ${total} seasons imported. ${job.seasons_needing_credentials.length} behind a login.`;
    case 'needs_credentials': return 'Sign in to bring these seasons over';
    case 'failed': return 'The import stopped';
    default: return job.status;
  }
}
