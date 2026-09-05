import { describe, it, expect } from 'vitest';
import {
  buildNameIndex,
  firstSentence,
  matchPlayers,
  parseEspn,
  parseFeed,
  parseNhl,
  stripHtml,
  summarize,
  teamOf,
} from '../services/NewsRoomService';

const NAMES = [
  { playerId: 8478402, fullName: 'Connor McDavid', teamAbbrev: 'EDM' },
  { playerId: 8480800, fullName: 'Quinn Hughes', teamAbbrev: 'MIN' },
  { playerId: 8481559, fullName: 'Jack Hughes', teamAbbrev: 'NJD' },
  { playerId: 8480796, fullName: 'Martin Fehérváry', teamAbbrev: 'WSH' },
  { playerId: 8471214, fullName: 'Alex Ovechkin', teamAbbrev: 'WSH' },
];

describe('NewsRoomService parsers', () => {
  it('strips HTML and entities, and takes the first sentence', () => {
    expect(stripHtml('<p>Ovechkin &amp; the Caps &#8212; <b>again</b></p>')).toBe('Ovechkin & the Caps — again');
    expect(firstSentence('McDavid skated Tuesday — a full practice. He is expected to play Thursday.')).toBe(
      'McDavid skated Tuesday, a full practice.',
    );
    expect(firstSentence('x'.repeat(300)).length).toBeLessThanOrEqual(240);
  });

  it('reads RSS 2.0 items', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title><![CDATA[Quinn Hughes named Wild captain]]></title>
      <link>https://example.com/hughes-captain</link>
      <description><![CDATA[<p>The Wild named Quinn Hughes captain on Tuesday. He replaces...</p>]]></description>
      <pubDate>Tue, 02 Sep 2026 14:00:00 GMT</pubDate>
      <dc:creator>Michael Russo</dc:creator>
      <guid>abc-1</guid>
    </item><item><title>No link here</title></item></channel></rss>`;
    const items = parseFeed(xml, 'test');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: 'test',
      externalId: 'abc-1',
      url: 'https://example.com/hughes-captain',
      title: 'Quinn Hughes named Wild captain',
      snippet: 'The Wild named Quinn Hughes captain on Tuesday.',
      author: 'Michael Russo',
      publishedAt: '2026-09-02T14:00:00.000Z',
    });
  });

  it('reads Atom entries', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>Ovechkin returns to Capitals camp</title>
      <link rel="alternate" href="https://example.com/ovi-camp"/>
      <summary>Alex Ovechkin reported to camp. More below.</summary>
      <updated>2026-09-03T09:00:00Z</updated>
    </entry></feed>`;
    const items = parseFeed(xml, 'atom');
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://example.com/ovi-camp');
    expect(items[0].snippet).toBe('Alex Ovechkin reported to camp.');
  });

  it('reads the NHL.com content API and keeps its player tags', () => {
    const items = parseNhl(
      {
        items: [
          {
            _entityId: 'e1',
            headline: 'McDavid skates with Oilers',
            summary: 'Connor McDavid was on the ice Monday.',
            slug: 'mcdavid-skates',
            contentDate: '2026-09-01T12:00:00Z',
            thumbnail: { templateUrl: 'https://img/{formatInstructions}/x.jpg' },
            tags: [{ externalSourceName: 'player', extraData: { playerId: '8478402' } }, { slug: 'oilers' }],
            contributor: [{ name: 'Derek Van Diest' }],
          },
          { headline: 'no slug' },
        ],
      },
      'nhl',
    );
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://www.nhl.com/news/mcdavid-skates');
    expect(items[0].taggedPlayerIds).toEqual([8478402]);
    expect(items[0].imageUrl).toBe('https://img/t_ratio16_9-size40/f_auto/x.jpg');
    expect(items[0].author).toBe('Derek Van Diest');
  });

  it('reads ESPN and drops paywalled items', () => {
    const items = parseEspn(
      {
        articles: [
          { id: 1, headline: 'Free story', description: 'Body.', links: { web: { href: 'https://espn.com/a' } }, published: '2026-09-01T00:00:00Z' },
          { id: 2, headline: 'Insider story', premium: true, links: { web: { href: 'https://espn.com/b' } } },
        ],
      },
      'espn',
    );
    expect(items.map((i) => i.url)).toEqual(['https://espn.com/a']);
  });
});

describe('NewsRoomService name matching', () => {
  const index = buildNameIndex(NAMES);

  it('matches full names only, never a surname alone', () => {
    expect(matchPlayers('Quinn Hughes named captain as Hughes brothers reunite', index)).toEqual([8480800]);
    expect(matchPlayers('Hughes scores twice', index)).toEqual([]);
  });

  it('is blind to case and diacritics and word position', () => {
    expect(matchPlayers('CONNOR MCDAVID: the interview', index)).toEqual([8478402]);
    expect(matchPlayers('Martin Fehervary signs extension', index)).toEqual([8480796]);
    expect(matchPlayers('...and Alex Ovechkin.', index)).toEqual([8471214]);
  });

  it('does not match inside a longer name', () => {
    expect(matchPlayers('Jack Hughesworth', index)).toEqual([]);
  });

  it('names the team when every matched player shares one', () => {
    expect(teamOf([8480796, 8471214], index)).toBe('WSH');
    expect(teamOf([8480800, 8481559], index)).toBeNull();
    expect(teamOf([], index)).toBeNull();
  });
});

describe('summarize', () => {
  const items = [
    { sourceId: 't', externalId: null, url: 'https://x/1', title: 'Ovechkin returns', snippet: 'Alex Ovechkin reported to camp.', author: null, imageUrl: null, publishedAt: '2026-09-03T09:00:00Z', taggedPlayerIds: [] },
    { sourceId: 't', externalId: null, url: 'https://x/2', title: 'Hughes captain', snippet: 'Quinn Hughes was named captain.', author: null, imageUrl: null, publishedAt: '2026-09-03T09:00:00Z', taggedPlayerIds: [] },
  ];

  it('falls back to the snippet with no key', async () => {
    const out = await summarize(items, fetch, undefined);
    expect(out.get('https://x/1')).toBe('Alex Ovechkin reported to camp.');
  });

  it('uses the model lines when they come back, scrubbed of em dashes', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ content: [{ text: '1. Ovechkin is back at Capitals camp — healthy.\n2. Quinn Hughes is the Wild captain.' }] }), { status: 200 })) as unknown as typeof fetch;
    const out = await summarize(items, fakeFetch, 'key');
    expect(out.get('https://x/1')).toBe('Ovechkin is back at Capitals camp, healthy.');
    expect(out.get('https://x/2')).toBe('Quinn Hughes is the Wild captain.');
  });

  it('keeps the snippets when the model fails', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const out = await summarize(items, fakeFetch, 'key');
    expect(out.get('https://x/2')).toBe('Quinn Hughes was named captain.');
  });
});
