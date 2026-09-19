import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppError } from '../lib/errors';
import type { ConnectedKit } from './PublishedDraftDeskService';
export type { ConnectedKit } from './PublishedDraftDeskService';

const root = fileURLToPath(new URL('../../../scripts/draft-guide/', import.meta.url));
export type PdfDownloadFormat = 'pdf' | 'tracker' | 'cheatsheet' | 'csv' | 'desk';
export const DOWNLOADS = {
  pdf: ['Citrus-Draft-Kit-2026-27.pdf', 'application/pdf'],
  tracker: ['Citrus-Draft-Checklist-2026-27.pdf', 'application/pdf'],
  cheatsheet: ['Citrus-Draft-Cheat-Sheet-2026-27.pdf', 'application/pdf'],
  csv: ['Citrus-Draft-Rankings-2026-27.csv', 'text/csv;charset=utf-8'],
  desk: ['Citrus-Draft-Desk-2026-27.html', 'text/html;charset=utf-8'],
} as const;
let running = 0;
let fullGuideRunning = false;

/** Preseason runtime snapshots may refresh rates while keeping the full horizon.
 * The private Python worker independently verifies exact canonical source bytes.
 * Do not accept a reduced/in-season board as a full-season paid guide.
 */
export function isFullPreseasonEdition(data: any): boolean {
  if (!data?.canonicalRevision) return false;
  const edition = data.edition;
  if (!edition) return true;
  if (edition.kind !== 'effective_runtime' || edition.horizon !== 'remaining_season'
      || !edition.asOf || edition.runtimeRevision !== data.canonicalRevision
      || !data.schedule || !Array.isArray(data.players)) return false;
  const covered = new Set<string>();
  for (const player of data.players) {
    if (player.forecastStatus !== 'projected') continue;
    const remaining = player.canonicalRemaining;
    const full = data.schedule[player.team];
    const knownZero = remaining?.actual_gp === 0;
    const unusedPrior = remaining?.actual_gp === null
      && remaining?.method === 'organization_prior_remaining'
      && remaining?.participation_semantics === 'not_used_by_prior';
    if (typeof full !== 'number' || !Number.isFinite(full) || full <= 0
        || remaining?.team_games !== full || remaining?.as_of !== edition.asOf
        || (!knownZero && !unusedPrior) || player.games !== player.canonicalExposure?.used) return false;
    covered.add(player.team);
  }
  return covered.size > 0 && covered.size === Object.keys(data.schedule).length;
}

export class DraftKitExportService {
  constructor(private python = process.env.DRAFT_KIT_PYTHON || '',
    private dataPath = process.env.DRAFT_KIT_DATA_PATH || `${root}review-inputs/guide-data.json`,
    private sourceRoot = process.env.DRAFT_KIT_SOURCE_ROOT || '',
    private editorialRoot = process.env.DRAFT_KIT_EDITORIAL_ROOT || '') {}
  async configuration() {
    if (process.env.DRAFT_KIT_PDF_READY !== 'true' || !this.python)
      throw AppError.serviceUnavailable('Personalized downloads are not available yet.');
    await access(this.python, constants.X_OK);
    const data = JSON.parse(await readFile(this.dataPath, 'utf8'));
    if (!isFullPreseasonEdition(data))
      throw AppError.serviceUnavailable('A reviewed full-season edition is required.');
    // Never serialize the source player universe to an unentitled caller.
    const downloadOrigin = process.env.DRAFT_KIT_DOWNLOAD_ORIGIN || undefined;
    if (downloadOrigin && !['https://citrus-api-gb5jc2sd5q-nn.a.run.app', 'https://citrus-api-3azzwszd2q-uc.a.run.app'].includes(downloadOrigin))
      throw AppError.serviceUnavailable('Download routing needs review.');
    return { weights: data.weights, projectionDate: data.source.asOf.slice(0,10), revision: data.canonicalRevision, ...(downloadOrigin ? {downloadOrigin} : {}) };
  }
  async download(format: PdfDownloadFormat, league: string, weights: unknown): Promise<Buffer> {
    if (!Object.prototype.hasOwnProperty.call(DOWNLOADS, format)) throw AppError.badRequest('Unknown download format.');
    return this.generate(format, league, weights);
  }
  /** Dated offline-edition export. Live room delivery now uses PublishedDraftDeskService.
   * Retained for existing offline tooling; never substitute this snapshot for live ROS.
   */
  async connected(league: string, weights: unknown): Promise<ConnectedKit> {
    const bytes = await this.generate('connected', league, weights);
    try {
      const kit = JSON.parse(bytes.toString());
      if (kit.version !== 1 || !/^[a-f0-9]{64}$/.test(kit.fingerprint) ||
          !Array.isArray(kit.players) || !kit.players.length || kit.players.length > 300) throw Error();
      return kit;
    } catch { throw AppError.serviceUnavailable('Your draft kit could not be verified. Please retry.'); }
  }
  private async generate(format: PdfDownloadFormat | 'connected', league: string, weights: unknown): Promise<Buffer> {
    await this.configuration();
    // Full guides share the reviewed portrait cache. Do not let two renderers
    // update its manifest concurrently within one API instance.
    if (running >= 2 || (format === 'pdf' && fullGuideRunning))
      throw new AppError('Downloads are busy. Please retry in a moment.',429,'RATE_LIMITED');
    const request = JSON.stringify({ format, league, weights });
    if (Buffer.byteLength(request) > 32768) throw AppError.badRequest('Scoring settings are too large.');
    running++;
    if (format === 'pdf') fullGuideRunning = true;
    try {
      return await new Promise<Buffer>((resolve,reject) => {
        // Executable and data paths are server configuration, never request input. No shell.
        const args=[`${root}export_worker.py`,this.dataPath];
        if(this.sourceRoot)args.push('--source-root',this.sourceRoot);
        if(this.editorialRoot)args.push('--editorial-root',this.editorialRoot);
        const child=spawn(this.python,args,{stdio:['pipe','pipe','pipe']});
        const chunks: Buffer[]=[];let size=0,done=false;
        const finish=(error?:Error,value?:Buffer) => {
          if(done)return;done=true;clearTimeout(timer);
          if(error){child.kill('SIGTERM');reject(error);}else resolve(value!);
        };
        const timer=setTimeout(()=>finish(AppError.serviceUnavailable('Your download took too long. Please retry.')),180_000);
        child.stdout.on('data',(chunk:Buffer)=>{
          size+=chunk.length;
          if(size>24*1024*1024)finish(AppError.serviceUnavailable('This edition exceeds the download size limit.'));
          else chunks.push(chunk);
        });
        // Drain stderr without exposing internal paths or customer inputs in logs.
        child.stderr.resume();
        child.on('error',()=>finish(AppError.serviceUnavailable('The download worker could not start.')));
        child.stdin.on('error',()=>finish(AppError.serviceUnavailable('The download worker stopped.')));
        child.on('close',(code)=>{
          const bytes=Buffer.concat(chunks);
          if(code!==0 || bytes.length===0)return finish(code===2
            ?AppError.badRequest('Could not build this edition. Check your scoring settings or try again.')
            :AppError.serviceUnavailable('The download could not be generated. Please retry.'));
          if(format==='desk' && !bytes.subarray(0,40).toString().toLowerCase().startsWith('<!doctype html>'))
            return finish(AppError.serviceUnavailable('The draft desk failed its file check.'));
          if(format!=='csv' && format!=='desk' && format!=='connected' && bytes.subarray(0,5).toString()!=='%PDF-')
            return finish(AppError.serviceUnavailable('The download failed its file check.'));
          finish(undefined,bytes);
        });
        child.stdin.end(request);
      });
    } finally { running--; if (format === 'pdf') fullGuideRunning = false; }
  }
}
