/**
 * Reads league page screenshots with the same Claude model Stormy uses.
 *
 * The model answers only through a tool call whose input schema is the
 * page schema, so the reply is data, never prose; zod re-validates it. The
 * reader knows nothing about Citrus tables: it turns images into
 * ExtractedPage[] and the assembler turns those into ImportedSeason.
 *
 * No image is stored anywhere. The images live in the request, go to the
 * model, and are gone; what is kept is the model's reading, on the job as
 * a raw payload, so a wrong read can be re-examined without asking the
 * commissioner for the screenshots again.
 */
import { CLAUDE_MODEL } from '../../services/StormyAssistantService';
import { extractionSchema, JSON_SCHEMA, type Extraction } from './schema';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const MAX_IMAGES_PER_READ = 12;
/** Base64 length; ~1.9 MB of image. The client downscales to 1600px first. */
export const MAX_IMAGE_BASE64_LENGTH = 2_600_000;
const MAX_OUTPUT_TOKENS = 16_000;
const TIMEOUT_MS = 150_000;

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export interface ScreenshotImage { data: string; mediaType: ImageMediaType }

export interface ReadHints {
  /** What the commissioner said the pages are from; the model still judges each page. */
  platform?: string | null;
  leagueName?: string | null;
  /** START year the commissioner said the pages are about, when they are all one season. */
  season?: number | null;
}

export interface ReadResult {
  extraction: Extraction;
  /** The model's tool input before validation, for the raw payload record. */
  raw: unknown;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export class ScreenshotReadError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ScreenshotReadError';
    this.status = status;
  }
}

export const SYSTEM_PROMPT = `You read screenshots of fantasy hockey league pages and record exactly what they show, as data, through the record_league_pages tool.

Rules:
- One entry per image, in order, index 0 first. Decide the platform from the page's design and wording (Yahoo, ESPN, Fantrax, CBS, Sleeper) and the kind of page from its content.
- Copy names exactly as printed: team names with their emoji and punctuation, manager names as shown, player names without the NHL team or position suffix. Never invent a row that is not on the page and never drop a row that is.
- Numbers are numbers. Remove thousands separators. A record printed "14-6-2" is wins 14, losses 6, ties 2. A category record such as "132-69-9" (more than 40 in total) goes in categoryRecord verbatim as well as wins/losses/ties.
- Seasons are the START year of the NHL season: "2023-24" is 2023. ESPN labels a season by its END year, so an ESPN page that says "2024" is season 2023. Yahoo, Fantrax and CBS label by the start year or the range. When the page shows no season at all, set season to null; do not guess.
- Platform page names: Yahoo "League History", ESPN "League History", Fantrax "History" or "Past Seasons", CBS "History" and Sleeper "Trophy Room" are kind champions. Yahoo "Draft Results", ESPN "Draft Recap", Fantrax "Draft Results" and Sleeper "Draft Board" are kind draft. A Fantrax or Sleeper "Draft Picks" page of future picks by owner is kind pick_ownership. "Keeper Tools" or "Keepers" pages are kind keepers.
- A league history page (past champions by year, several seasons on one page) is kind champions: one entry per season with that season's champion and, where printed, the runner-up. Leave the page's own season null; each row carries its own year.
- A list of the league's own awards (trophies the league hands out itself, by season and winner, on a platform page, a spreadsheet, or a chat message) is kind awards. Copy the award names exactly as the league writes them.
- A standings page after the playoffs lists final standings; mark isChampion only where the page marks a champion (a trophy, "Champion", 1st in final standings under a playoffs heading). Mark madePlayoffs only where the page marks it.
- For a draft page, record every pick visible with its round and overall number; a keeper marker (K, a star, "Keeper") sets isKeeper.
- For transactions, record one entry per asset that moved. A trade of two players for a pick is three entries with the same date and the same two teams; teamName is the team that received the asset. A traded draft pick is recorded with pickSeason and pickRound and no playerName.
- For a page of future draft picks, record only picks owned by a team other than the one they originally belonged to.
- confidence is low when text is cut off, blurred, or a column could not be told apart; say what in notes. Notes are for the commissioner: short and specific.`;

function hintText(hints: ReadHints, count: number): string {
  const parts = [`${count} image${count === 1 ? '' : 's'} follow.`];
  if (hints.platform && hints.platform !== 'unknown') parts.push(`The commissioner says they are from ${hints.platform}.`);
  if (hints.leagueName) parts.push(`The league is called "${hints.leagueName}".`);
  if (hints.season != null) parts.push(`The commissioner says every page is about the ${hints.season}-${String(hints.season + 1).slice(2)} season; use that where a page shows no season.`);
  return parts.join(' ');
}

export class ScreenshotReader {
  constructor(
    private readonly apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly model: string = process.env.IMPORT_VISION_MODEL || CLAUDE_MODEL,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async read(images: ScreenshotImage[], hints: ReadHints = {}): Promise<ReadResult> {
    if (!this.apiKey) throw new ScreenshotReadError('Screenshot import is not available yet.', 503);
    if (images.length === 0) throw new ScreenshotReadError('Add at least one screenshot.', 400);
    if (images.length > MAX_IMAGES_PER_READ) throw new ScreenshotReadError(`Up to ${MAX_IMAGES_PER_READ} screenshots per read.`, 400);
    for (const img of images) {
      if (img.data.length > MAX_IMAGE_BASE64_LENGTH) throw new ScreenshotReadError('One of the screenshots is too large. Screenshots are resized before upload; try again from the app.', 400);
    }

    const content: unknown[] = [{ type: 'text', text: hintText(hints, images.length) }];
    images.forEach((img, i) => {
      content.push({ type: 'text', text: `Image ${i} of ${images.length - 1} (index ${i}):` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    });

    let upstream: Response;
    try {
      upstream = await this.fetchImpl(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT,
          tools: [{ name: 'record_league_pages', description: 'Record what each screenshot shows.', input_schema: JSON_SCHEMA }],
          tool_choice: { type: 'tool', name: 'record_league_pages' },
          messages: [{ role: 'user', content }],
        }),
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
      });
    } catch (e) {
      throw new ScreenshotReadError(`The reader did not answer: ${(e as Error).message}`, 502);
    }

    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      throw new ScreenshotReadError(status === 429 ? 'The reader is busy right now. Try again in a minute.' : `The reader answered ${upstream.status}. Try again in a moment.`, status);
    }

    const body = (await upstream.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const tool = (body.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'record_league_pages');
    if (!tool) throw new ScreenshotReadError('The reader returned no reading. Try again with clearer screenshots.', 502);
    if (body.stop_reason === 'max_tokens') throw new ScreenshotReadError('The pages held more than one read can carry. Send fewer screenshots at a time.', 422);

    const parsed = extractionSchema.safeParse(tool.input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ScreenshotReadError(`The reading did not fit the page shape (${first?.path.join('.') || 'root'}: ${first?.message || 'invalid'}). Try again.`, 502);
    }
    return {
      extraction: parsed.data,
      raw: tool.input,
      usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
      model: this.model,
    };
  }
}
