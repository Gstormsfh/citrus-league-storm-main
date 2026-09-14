/**
 * Screenshots in, a confirmed history out. Two steps, deliberately:
 *
 *   read     the commissioner's images go to the vision reader; the reading
 *            is stored on a job (raw payload, never the images) and handed
 *            back for review. Nothing about the league changes.
 *   confirm  the commissioner sends the reading back, edited, with the
 *            season each page is about and the platform; it is assembled
 *            into ImportedSeason and written through the same writer, record
 *            book and claim flow as an API import.
 *
 * A misread name therefore never becomes a champion: it is on a screen with
 * an edit box first. The reading is re-validated on the way back in.
 */
import { logger } from '@citrus/shared';
import { AppError } from '../../lib/errors';
import type { ImportPlatform } from '../../import/types';
import { assembleSeasons } from '../../import/screenshot/assemble';
import { ScreenshotReadError, ScreenshotReader, type ReadHints, type ScreenshotImage } from '../../import/screenshot/reader';
import type { ExtractedPage } from '../../import/screenshot/schema';
import type { ImportJobRow, LeagueImportService, SeasonWriteResult } from './LeagueImportService';

export const SCREENSHOT_PLATFORMS: ImportPlatform[] = ['yahoo', 'espn', 'fantrax', 'cbs', 'sleeper', 'manual'];

export interface ScreenshotReadOptions {
  leagueId: string;
  requestedBy: string;
  images: ScreenshotImage[];
  platform: ImportPlatform;
  leagueName?: string | null;
  season?: number | null;
}

export interface ScreenshotReadOutcome {
  job: ImportJobRow;
  pages: ExtractedPage[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface ScreenshotConfirmOptions {
  leagueId: string;
  jobId: string;
  requestedBy: string;
  pages: ExtractedPage[];
  platform: ImportPlatform;
  leagueName?: string | null;
  finished?: Record<number, boolean>;
  rostersAsKeepers?: boolean;
  /** START year of the season being played now; the assembler's "finished" default. */
  currentSeason: number;
}

export function leagueSlug(name: string | null | undefined): string {
  const slug = (name ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `screenshots:${slug}`.slice(0, 80) : 'screenshots';
}

export class ScreenshotImportService {
  constructor(private readonly imports: LeagueImportService, private readonly reader: ScreenshotReader) {}

  isConfigured(): boolean {
    return this.reader.isConfigured();
  }

  async read(opts: ScreenshotReadOptions): Promise<ScreenshotReadOutcome> {
    if (!this.reader.isConfigured()) throw new AppError('Screenshot import is not available yet.', 503, 'SERVICE_UNAVAILABLE');
    const job = await this.imports.createJob(opts.leagueId, opts.platform, leagueSlug(opts.leagueName), opts.requestedBy, 'screenshot');
    await this.imports.updateJob(job.id, { status: 'discovering', started_at: new Date().toISOString() });
    const hints: ReadHints = { platform: opts.platform === 'manual' ? null : opts.platform, leagueName: opts.leagueName ?? null, season: opts.season ?? null };
    try {
      const result = await this.reader.read(opts.images, hints);
      await this.imports.storeRawPayload(job.id, opts.leagueId, opts.platform, 'vision:record_league_pages', null, {
        model: result.model, usage: result.usage, images: opts.images.length, reading: result.raw,
      });
      const kinds: Record<string, number> = {};
      for (const p of result.extraction.pages) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      const seasons = Array.from(new Set(result.extraction.pages.map((p) => p.season).filter((s): s is number => s != null))).sort((a, b) => a - b);
      // Back to queued: the write waits for the commissioner's confirmation.
      await this.imports.updateJob(job.id, { status: 'queued', seasons_discovered: seasons, progress: { reading: { images: opts.images.length, kinds, usage: result.usage } } });
      return { job: (await this.imports.getJob(job.id))!, pages: result.extraction.pages, usage: result.usage };
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      await this.imports.updateJob(job.id, { status: 'failed', error: { code: 'READ_FAILED', message }, finished_at: new Date().toISOString() });
      if (e instanceof ScreenshotReadError) throw new AppError(e.message, e.status, e.status === 429 ? 'RATE_LIMITED' : e.status === 503 ? 'SERVICE_UNAVAILABLE' : e.status < 500 ? 'BAD_REQUEST' : 'BAD_GATEWAY');
      logger.error('[import] screenshot read failed', { jobId: job.id, message });
      throw AppError.badGateway('The reader could not read those screenshots. Try again in a moment.');
    }
  }

  /** Validates the job and starts the write; the job is polled like any other import. */
  async confirm(opts: ScreenshotConfirmOptions): Promise<ImportJobRow> {
    const job = await this.imports.getJob(opts.jobId);
    if (!job || job.league_id !== opts.leagueId) throw new AppError('That reading does not belong to this league.', 404, 'NOT_FOUND');
    if (job.method !== 'screenshot') throw AppError.badRequest('That job is not a screenshot reading.');
    if (job.status !== 'queued') throw AppError.conflict(job.status === 'done' || job.status === 'partial' ? 'That reading has already been imported.' : 'That reading is not waiting for confirmation.');
    const assembled = assembleSeasons(opts.pages, {
      platform: opts.platform, currentSeason: opts.currentSeason, externalLeagueId: job.external_league_id,
      leagueName: opts.leagueName ?? null, finished: opts.finished, rostersAsKeepers: opts.rostersAsKeepers,
    });
    const blocking = assembled.unplaced.filter((u) => u.reason !== 'Not a league page.');
    if (blocking.length) throw AppError.badRequest(`Image ${blocking[0].index + 1}: ${blocking[0].reason}`);
    if (!assembled.seasons.length) throw AppError.badRequest('Nothing to import: no page carried a season of history.');
    await this.imports.updateJob(job.id, { status: 'importing', seasons_discovered: assembled.seasons.map((s) => s.season), started_at: job.started_at ?? new Date().toISOString() });
    void this.runWrite(job, opts, assembled.seasons);
    return (await this.imports.getJob(job.id))!;
  }

  /** The write, in job order; exported for tests that await it. */
  async runWrite(job: ImportJobRow, opts: ScreenshotConfirmOptions, seasons: ReturnType<typeof assembleSeasons>['seasons']): Promise<ImportJobRow> {
    const results: SeasonWriteResult[] = [];
    const imported: number[] = [];
    try {
      const locked = await this.imports.isHistoryLocked(opts.leagueId);
      for (const season of seasons) {
        const r = await this.imports.writeSeason(opts.leagueId, job.id, season, { importerUserId: opts.requestedBy, importerExternalId: null, locked });
        results.push(r);
        imported.push(season.season);
        await this.imports.updateJob(job.id, { seasons_imported: imported, progress: { seasons: results } });
      }
      await this.imports.updateJob(job.id, { status: 'computing' });
      await this.imports.recomputeTrophies(opts.leagueId, job.id);
      await this.imports.markFounded(opts.leagueId, imported, opts.platform);
      await this.imports.updateJob(job.id, { status: 'done', seasons_imported: imported, progress: { seasons: results }, finished_at: new Date().toISOString() });
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      logger.error('[import] screenshot write failed', { jobId: job.id, message });
      await this.imports.updateJob(job.id, { status: 'failed', seasons_imported: imported, progress: { seasons: results }, error: { code: 'IMPORT_FAILED', message }, finished_at: new Date().toISOString() });
    }
    return (await this.imports.getJob(job.id))!;
  }
}
