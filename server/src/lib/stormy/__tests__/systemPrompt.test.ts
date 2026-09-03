// Stormy prompt conformance (2026-09-03 voice rewrite 2: the "Boss" tic).
//
// The founder's complaint, verbatim: "Stormy still isn't good enough. He
// says 'Boss' EVERY message; and he needs to be more organic like an
// assistant GM would, backed with stats."
//
// The 2026-09-02 prompt capped the address form at one message in three
// and then opened every one of its own exemplars with it. A model weights
// the examples over the cap, so the cap lost. This file is the regression
// test for that: it reads the exported exemplars and the rendered prompt
// and pins the shape of both, so the next edit cannot reintroduce the tic
// by example while the rule still says otherwise.
//
// What it pins:
//
//   * the word "boss" appears in the rendered prompt at most four times,
//     and the rule that caps it is stated in the positive (open with the
//     take) as well as the negative (never a first sentence);
//   * no exemplar opens with a vocative or a greeting, every exemplar
//     answer carries a digit, and none runs past four sentences;
//   * no exemplar carries an em dash, a banned phrase, an accuracy claim
//     or the moat overstatement, checked against the shared vocabulary
//     in packages/shared/src/constants/aiVoice.json rather than a copy;
//   * exemplars describe only shapes the context serialiser emits: no
//     game logs, no last-10 form, no line combinations, no GAR;
//   * every token StormyService.fetchLeagueContext writes is documented
//     in the prompt under "What Data You Have";
//   * the grounding contract (RULE 0) and the sourcing rule survive.
//
// `apps/web/src/__tests__/aiVoiceGuard.test.ts` scans this prompt too,
// from the other workspace, and pins the model figures and the anti-tell
// list. The two overlap on purpose: the web suite is where the vocabulary
// lives, this one is where the prompt lives, and either should fail on
// its own if the prompt regresses.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeScoringDefaults } from '@citrus/shared';
import { STORMY_SYSTEM_PROMPT, STORMY_EXEMPLARS, type StormyExemplar } from '../systemPrompt';

/** Numbered so a failure names the exemplar rather than its index. */
const NUMBERED: Array<[number, StormyExemplar]> = STORMY_EXEMPLARS.map(
  (e, i): [number, StormyExemplar] => [i + 1, e],
);

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(HERE, '../../../../..');
const SOURCE = readFileSync(resolve(HERE, '../systemPrompt.ts'), 'utf8');

const VOICE = JSON.parse(
  readFileSync(resolve(REPO, 'packages/shared/src/constants/aiVoice.json'), 'utf8'),
) as {
  bannedPhrases: Array<{ name: string; pattern: string }>;
  accuracyClaims: Array<{ name: string; pattern: string }>;
  moatOverstatement: { name: string; pattern: string };
  emDash: { char: string };
};

const BANNED = [...VOICE.bannedPhrases, ...VOICE.accuracyClaims, VOICE.moatOverstatement].map(
  ({ name, pattern }) => ({ name, re: new RegExp(pattern, 'i') }),
);

/** The character itself lives in the JSON; the test never types it. */
const EM_DASH = VOICE.emDash.char;

/**
 * Any fixed form of address for the manager. "boss" is the one that
 * shipped; the rest are the obvious substitutes a rewrite might reach
 * for, banned in the same breath so the tic cannot change costume.
 */
const VOCATIVE = /\b(?:boss|sir|chief|captain|skipper|champ)\b/i;

/** Openers that are not the take. */
const GREETING = /^(?:well|alright|right|ok|okay|hey|hi|hello|so|great question)\b/i;

/**
 * Shapes the context never carries. The serialiser writes season totals,
 * this week's schedule and projections, and the verified-data block
 * writes season rows. An exemplar that reads as a game log teaches the
 * model to invent one.
 */
const NOT_IN_CONTEXT = /\b(?:last\s*10|L10|game\s+log|line\s+combination|GAR|Corsi|CF%|PDO|shooting\s+percentage|sh%|streak|slump)\b/i;

/**
 * Split on a terminator followed by whitespace or the end. "1.2 PPG" and
 * "NHL.com" do not split, which is the whole reason this is not a naive
 * split on full stops.
 */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
}

function countWord(text: string, word: RegExp): number {
  return (text.match(new RegExp(word.source, 'gi')) ?? []).length;
}

describe("Stormy's prompt: the address form", () => {
  it('is capped at once per conversation and never opens an answer, in as many words', () => {
    expect(STORMY_SYSTEM_PROMPT).toMatch(/once-per-conversation|once per conversation/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Never in the first sentence of an answer/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/if any earlier answer in the transcript already used one, yours is spent/);
    // The positive instruction: what goes first instead.
    expect(STORMY_SYSTEM_PROMPT).toMatch(/^Open with the take\./m);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/The first sentence of every answer is the call/);
  });

  it('no longer licenses a vocative opener, and names the old cap only to reject it', () => {
    expect(STORMY_SYSTEM_PROMPT).not.toMatch(/Open the way an assistant opens/);
    expect(STORMY_SYSTEM_PROMPT).not.toMatch(/"Alright boss,"|"Right, boss\."/);
    // "one message in three" is pinned by the web guard, so it stays in
    // the prompt; it may appear only inside the sentence that calls it
    // the mistake it was.
    const mentions = STORMY_SYSTEM_PROMPT.match(/one message in three/g) ?? [];
    expect(mentions).toHaveLength(1);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/on one message in three and it turned into every message/);
  });

  it('says "boss" at most four times in the rendered prompt', () => {
    // Four on 2026-09-03: the identity line ("He is your boss"), the
    // definition of the address form, the rejected "Well boss," cap, and
    // one mid-sentence use late in an exemplar that shows where the word
    // belongs. Down is fine. Up needs an argument in this file.
    expect(countWord(STORMY_SYSTEM_PROMPT, /\bboss\b/)).toBeLessThanOrEqual(4);
  });

  it('uses the address form at most once across every exemplar, never in a first sentence', () => {
    let uses = 0;
    for (const e of STORMY_EXEMPLARS) {
      const [first] = sentences(e.answer);
      expect(first, `exemplar opens with a vocative: "${first}"`).not.toMatch(VOCATIVE);
      expect(e.answer, `exemplar opens with a greeting: "${first}"`).not.toMatch(GREETING);
      uses += countWord(e.answer, VOCATIVE);
    }
    expect(uses).toBeLessThanOrEqual(1);
  });
});

describe("Stormy's prompt: the exemplars", () => {
  it('exist, in the numbers the prompt promises', () => {
    // Four rendered under "THE VOICE, BY EXAMPLE" and one under "WHEN
    // YOU DO NOT KNOW". The prompt says "Four exchanges" in prose.
    expect(STORMY_EXEMPLARS.length).toBe(5);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Four exchanges in the target voice/);
  });

  it.each(NUMBERED)(
    'exemplar %i opens with the take, carries a number, and stays inside four sentences',
    (_n, e) => {
      expect(e.ask.trim().length).toBeGreaterThan(0);
      expect(e.answer, 'an assistant GM backs the call with a number').toMatch(/\d/);
      expect(sentences(e.answer).length).toBeLessThanOrEqual(4);
      // No bullets, no headers, no restating the question.
      expect(e.answer).not.toMatch(/^\s*[-*#]/m);
      expect(e.answer.toLowerCase().startsWith(e.ask.toLowerCase().slice(0, 12))).toBe(false);
    },
  );

  it.each(NUMBERED)(
    'exemplar %i carries no em dash, banned phrase, accuracy claim or moat overstatement',
    (_n, e) => {
      for (const text of [e.ask, e.answer, e.shows]) {
        expect(text.includes(EM_DASH), `em dash in "${text.slice(0, 60)}"`).toBe(false);
        for (const b of BANNED) {
          expect(b.re.test(text), `${b.name} in "${text.slice(0, 60)}"`).toBe(false);
        }
      }
    },
  );

  it('describes only shapes the context actually carries', () => {
    for (const e of STORMY_EXEMPLARS) {
      expect(e.answer, `"${e.answer.slice(0, 60)}" reads as a game log`).not.toMatch(NOT_IN_CONTEXT);
    }
    // Every answer names a Citrus or NHL.com source, or a context token,
    // the way section 4 requires.
    const SOURCED = /\b(?:Citrus|NHL\.com|xG|GSAx|ROS|projection|PPG)\b/;
    for (const e of STORMY_EXEMPLARS) {
      expect(e.answer, `unsourced exemplar: "${e.answer.slice(0, 60)}"`).toMatch(SOURCED);
    }
  });

  it('are rendered into the prompt in the He asks / You say shape', () => {
    for (const e of STORMY_EXEMPLARS) {
      expect(STORMY_SYSTEM_PROMPT).toContain(`He asks: "${e.ask}"`);
      expect(STORMY_SYSTEM_PROMPT).toContain(`You say: "${e.answer}"`);
    }
    expect((STORMY_SYSTEM_PROMPT.match(/You say: "/g) ?? []).length).toBe(STORMY_EXEMPLARS.length);
  });

  it('use placeholder names, not the real players the 2026-09-02 version used', () => {
    // Real names with invented numbers hand the model a stat line to leak
    // the day the lookup misses. These were the ones in the old exemplars.
    for (const real of ['Hughes', 'Rantanen', 'Wedgewood', 'Swayman', 'MacKinnon', 'McDavid', 'Marner']) {
      for (const e of STORMY_EXEMPLARS) {
        expect(e.answer, `${real} is a real player`).not.toContain(real);
      }
    }
  });
});

describe("Stormy's prompt: what it asks for", () => {
  it('asks for two to four sentences, paragraphs over bullets, and a comparison behind every number', () => {
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Two to four sentences/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Paragraphs, not bullets/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/A number with no comparison is a brochure/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Finish on the call/);
  });

  it('forbids recent-form talk the context cannot support', () => {
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Never describe recent form/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/not game logs/);
  });

  it('documents every token the context serialiser writes', () => {
    // These are the literal tokens apps/web/src/services/StormyService.ts
    // emits. If the serialiser adds one, document it here; if the prompt
    // stops explaining one, the model reads it as noise.
    for (const token of [
      'xG:21.4 G-xG:+8.6',
      'TOI/GP:18.4',
      'xG/60:1.42[Elite]',
      '3GP/wk[Mon,Wed,Sat]',
      'wkProj:8.4',
      'ROS:412.5pts 61GR',
      'GSAx:+8.2[primary shots:1204 xGA:92.4 GA:84]',
      'Projected this week',
      'Gap line',
    ]) {
      expect(STORMY_SYSTEM_PROMPT, `the prompt stopped documenting ${token}`).toContain(token);
    }
    // The tiers match data-pipeline/projections/build_player_season_stats.py.
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Elite is 1\.2 and up, Above Avg 0\.9, Average 0\.6, Below Avg 0\.3, Low under 0\.3/);
  });

  it('keeps the version number off routine citations', () => {
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Do not put a version number on a stat/);
    // The name is pinned by the web guard; it belongs to the paragraph
    // about the model itself and the brochure counter-example, nowhere
    // else. Two on 2026-09-03.
    expect((STORMY_SYSTEM_PROMPT.match(/Citrus xG v3/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it('still carries the grounding and sourcing contract', () => {
    expect(STORMY_SYSTEM_PROMPT).toMatch(/RULE 0/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/OUTRANKS EVERY OTHER RULE/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/VERIFIED\s*\n?\s*PLAYER DATA/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/NEVER use an em dash/);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Never claim projection accuracy/i);
    expect(STORMY_SYSTEM_PROMPT).toMatch(/Never overstate the pass-context coverage/i);
    for (const src of ['NHL.com', 'Citrus GSAx', 'Citrus ROS projection']) {
      expect(STORMY_SYSTEM_PROMPT).toContain(src);
    }
  });

  it('splices the shared scoring defaults in rather than restating them', () => {
    expect(STORMY_SYSTEM_PROMPT).toContain('## Default Fantasy Scoring');
    expect(STORMY_SYSTEM_PROMPT).toContain(describeScoringDefaults());
  });

  it('has no em dash anywhere in the source file, comments included', () => {
    // The web guard scans string literals only and lets comments through.
    // This file is the one place the character has no business being at
    // all, because the model sees the strings and the next editor copies
    // the comments.
    expect(SOURCE.includes(EM_DASH)).toBe(false);
    expect(STORMY_SYSTEM_PROMPT.includes(EM_DASH)).toBe(false);
  });
});
