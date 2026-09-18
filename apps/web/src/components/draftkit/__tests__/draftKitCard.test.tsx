// Draft Kit UI contract.
//
// The card is the thing being sold, so the tests are about the two claims it
// makes: that a percentile is stated against a named cohort, and that the
// locked card contains no paid numbers at all. A locked card that merely
// hides its numbers with a class would pass a "does it look right" test and
// fail the only test that matters, so these assert on the rendered text.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DraftKitPlayerCard } from '../DraftKitPlayerCard';
import { RosterChangeList } from '../RosterChangeList';
import { BlurbSlot } from '../BlurbSlot';
import { formatMetricValue, ordinal, type DraftKitCard } from '../types';
import { DRAFT_KIT_TIERS, priceLabel } from '../tiers';

const SKATER: DraftKitCard = {
  playerId: 8478402,
  name: 'A Skater',
  team: 'EDM',
  position: 'C',
  cohort: 'F',
  jersey: 97,
  headshotUrl: null,
  rosterStatus: null,
  sampleGames: 82,
  cohortRank: 1,
  tier: 1,
  projectedFantasyPoints: 948.6,
  projectedFantasyPpg: 11.71,
  projectedGames: 81,
  valuePercentile: 100,
  previousTeam: null,
  metrics: [
    {
      key: 'gar60',
      label: 'Total impact',
      source: 'player_gar_components.total_gar_per_60',
      value: 1.569,
      percentile: 99,
      format: 'rate2',
    },
    {
      key: 'evd',
      label: 'Even strength defence',
      source: 'player_gar_components.evd_gar_per_60',
      value: 0.007,
      percentile: 44,
      format: 'rate2',
    },
  ],
};

const GOALIE: DraftKitCard = {
  ...SKATER,
  playerId: 8476945,
  name: 'A Goalie',
  team: 'WPG',
  position: 'G',
  cohort: 'G',
  jersey: 37,
  cohortRank: 2,
  metrics: [
    {
      key: 'gsax',
      label: 'Goals saved above expected',
      source: 'goalie_xg_season.gsax',
      value: 14.2,
      percentile: 96,
      format: 'count1',
    },
  ],
};

describe('formatMetricValue', () => {
  it('renders each declared format in its own units', () => {
    expect(formatMetricValue(1.569, 'rate2')).toBe('1.57');
    expect(formatMetricValue(1.5694, 'rate3')).toBe('1.569');
    expect(formatMetricValue(14.24, 'count1')).toBe('14.2');
  });

  it('normalises save percentage whichever way the pipeline wrote it', () => {
    expect(formatMetricValue(0.921, 'pct3')).toBe('.921');
    expect(formatMetricValue(921, 'pct3')).toBe('.921');
  });

  it('says "No sample" rather than rendering a zero it does not have', () => {
    expect(formatMetricValue(null, 'rate2')).toBe('No sample');
  });
});

describe('ordinal', () => {
  it('handles the teens, which are the ones that go wrong', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
  });
});

describe('DraftKitPlayerCard', () => {
  it('states the cohort the percentiles were taken against', () => {
    render(<DraftKitPlayerCard card={SKATER} cohortSize={442} metricsSeason={2025} />);
    expect(screen.getByText(/Percentiles vs 442 forwards/i)).toBeInTheDocument();
  });

  it('names the source column for every metric it renders', () => {
    render(<DraftKitPlayerCard card={SKATER} cohortSize={442} metricsSeason={2025} />);
    expect(screen.getByText('player_gar_components.total_gar_per_60')).toBeInTheDocument();
    expect(screen.getByText('player_gar_components.evd_gar_per_60')).toBeInTheDocument();
  });

  it('gives a goalie the goalie cohort line and the goalie heading', () => {
    render(<DraftKitPlayerCard card={GOALIE} cohortSize={92} metricsSeason={2025} />);
    expect(screen.getByText(/Percentiles vs 92 goalies/i)).toBeInTheDocument();
    expect(screen.getByText('Goaltending')).toBeInTheDocument();
  });

  it('renders no paid number when locked', () => {
    render(<DraftKitPlayerCard card={SKATER} cohortSize={442} metricsSeason={2025} locked />);
    // Identity survives.
    expect(screen.getByText('A Skater')).toBeInTheDocument();
    // The paid numbers do not appear anywhere in the rendered text.
    const card = screen.getByTestId('draft-kit-player-card');
    expect(card.textContent).not.toContain('949');
    expect(card.textContent).not.toContain('11.71');
    expect(card.textContent).not.toContain('1.57');
    expect(card.textContent).not.toContain('player_gar_components');
  });

  it('flags a player who changed club', () => {
    render(
      <DraftKitPlayerCard
        card={{ ...SKATER, previousTeam: 'OTT', team: 'FLA' }}
        cohortSize={442}
        metricsSeason={2025}
      />,
    );
    expect(screen.getByText(/New: OTT to FLA/)).toBeInTheDocument();
  });
});

describe('RosterChangeList', () => {
  const CHANGES = [
    {
      playerId: 1,
      name: 'A Winger',
      position: 'LW',
      cohort: 'F' as const,
      fromTeam: 'OTT',
      toTeam: 'FLA',
      projectedFantasyPoints: 578.5,
      cohortRank: 12,
    },
  ];

  it('lists a move as from-team to to-team without claiming how it happened', () => {
    render(<RosterChangeList changes={CHANGES} totalChanges={134} />);
    expect(screen.getByText(/LW · OTT to FLA/)).toBeInTheDocument();
    const list = screen.getByTestId('roster-changes');
    expect(list.textContent).not.toMatch(/trade|signed|waiver/i);
  });

  it('withholds the list when locked but still says how many there are', () => {
    render(<RosterChangeList changes={[]} totalChanges={134} locked />);
    expect(screen.getByTestId('roster-changes-locked')).toBeInTheDocument();
    expect(screen.getByText(/134 players are on a new club/)).toBeInTheDocument();
  });
});

describe('BlurbSlot', () => {
  it('renders an empty state rather than inventing copy', () => {
    render(<BlurbSlot blurbs={[]} />);
    expect(screen.getByText('No written analysis published yet.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('blurb')).toHaveLength(0);
  });

  it('always shows the byline, and the source as a link when one exists', () => {
    render(
      <BlurbSlot
        blurbs={[
          {
            id: 'x',
            playerId: 1,
            season: 2026,
            kind: 'player',
            title: 'T',
            body: 'B',
            authorName: 'Author Name',
            authorRole: 'Role',
            sourceName: 'Source Name',
            sourceUrl: 'https://example.com/piece',
            publishedAt: '2026-09-01T12:00:00Z',
          },
        ]}
      />,
    );
    expect(screen.getByText('Author Name')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Source Name' });
    expect(link).toHaveAttribute('href', 'https://example.com/piece');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('pricing model', () => {
  it('carries one tier per entitlement value the schema allows', () => {
    expect(DRAFT_KIT_TIERS.map((t) => t.id)).toEqual(['free', 'kit', 'suite']);
  });

  it('prices the free tier as free and the paid tiers in whole dollars', () => {
    const [free, kit, suite] = DRAFT_KIT_TIERS;
    expect(priceLabel(free)).toBe('Free');
    expect(priceLabel(kit)).toMatch(/^\$\d+$/);
    expect(priceLabel(suite)).toMatch(/^\$\d+$/);
    expect((suite.priceUsd as number) > (kit.priceUsd as number)).toBe(true);
  });

  it('keeps em dashes out of every user-facing string', () => {
    for (const t of DRAFT_KIT_TIERS) {
      const text = [t.name, t.cadence, t.tagline, ...t.includes].join(' ');
      expect(text).not.toContain('—');
    }
  });
});
