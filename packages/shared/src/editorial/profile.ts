import type { PlayerWriteup, WriteupExtras, WriteupPlayer } from '../playerWriteup';
import type { EditorialNewsEvidence } from './news';
import { dataSeasonLabel } from '../seasonContext';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const fmt = (n: number, dp = 1) => String(Number(n.toFixed(dp)));
const save = (n: number) => n.toFixed(3).replace(/^0/, '');
type ProfileExtras = WriteupExtras & {
  selectedNews?: readonly EditorialNewsEvidence[];
  selectedAvailability?: { status: string; authority: 'verified' | 'imported_scenario'; asOf: string };
};

/** A conclusion chosen from accepted evidence, not an extra generic news paragraph. */
function currentDecision(extras: ProfileExtras | undefined, anchor: string, ppHeavy: boolean, goalie: boolean): string | null {
  const news = extras?.selectedNews ?? [];
  const health = news.find(e => ['practice', 'out', 'uncertain', 'cleared'].includes(e.kind));
  const availability = extras?.selectedAvailability;
  const canonicalNewer = availability && (!health || Date.parse(availability.asOf) > Date.parse(health.publishedAt));
  let kind: string | undefined = health?.kind;
  if (canonicalNewer) {
    if (availability.authority === 'imported_scenario') {
      if (!health && ['out', 'ir', 'ltir', 'suspended', 'day_to_day'].includes(availability.status)) {
        return `If the imported availability scenario still applies, access to games comes before the ${anchor}. Confirm a current status before using a lineup spot.`;
      }
    } else if (['out', 'ir', 'ltir', 'suspended'].includes(availability.status)) kind = 'out';
    else if (availability.status === 'day_to_day') kind = 'uncertain';
    else if (availability.status === 'active') kind = 'active';
  }
  if (kind === 'active') return `An active listing makes the ${anchor} relevant to the lineup discussion. Confirm ${goalie ? 'the start' : 'the game roster and minutes'}; an active designation is not medical clearance or a full-workload guarantee.`;
  if (kind === 'out') return `The ${anchor} remains a reason to retain interest, but the dated absence makes access to games the immediate constraint. A newer clearance is needed before counting on a lineup contribution.`;
  if (kind === 'uncertain') return `The ${anchor} only matters to the next lineup if he is available. Keep an alternative ready until game status is resolved; this evidence supplies no return date.`;
  if (kind === 'practice') return `The next decision is whether he can take a game workload that supports the ${anchor}. Practice alone settles neither game clearance nor ${goalie ? 'a confirmed start' : 'the minutes he will receive'}.`;
  if (kind === 'cleared') return `With the availability update, the question shifts to ${goalie ? 'a confirmed start and the crease split' : 'a confirmed lineup place and the workload he resumes'}. That is the bridge back to the ${anchor}; clearance alone does not establish full usage.`;
  if (news.some(e => e.kind === 'power-play')) return ppHeavy
    ? 'First-unit practice is especially consequential for this scoring mix. If that assignment carries into games, it preserves a major source of his offence; sustained power-play time is the condition to watch.'
    : 'The first-unit practice report puts power-play usage ahead of the old scoring split as the next thing to watch. Establish that the assignment carries into games before treating it as additional offence.';
  if (news.some(e => e.kind === 'starter') && goalie) return `The named start makes workload concrete for that dated game. Weigh the ${anchor} against the categories still needed before adding the appearance.`;
  if (news.some(e => e.kind === 'transaction')) return `After the transaction, the useful comparison is whether the new deployment can sustain the ${anchor}. Wait for line and power-play usage before assuming the move adds offence.`;
  return null;
}

/** Select an interaction in the evidence; do not rotate synonyms by player ID. */
export function profileWriteup(player: WriteupPlayer, extras?: ProfileExtras): PlayerWriteup {
  const s = player.stats ?? {};
  const gpKnown = finite(s.gamesPlayed);
  const gp = gpKnown ? s.gamesPlayed as number : 0;
  const goalie = /^(g|goalie|goaltender)$/i.test(player.position);
  const defence = /^(d|defence|defense|defenceman|defenseman)$/i.test(player.position);
  const label = dataSeasonLabel(player.statsSeason);
  const period = label ?? 'the available stat record';
  const name = player.name?.trim() || 'This player';
  const points = finite(s.points) ? s.points : finite(s.goals) && finite(s.assists) ? s.goals + s.assists : null;
  const sv = finite(s.savePct) && s.savePct > 0 ? (s.savePct > 1 ? s.savePct / 100 : s.savePct) : null;
  const enough = gp >= 8 && (goalie ? sv !== null && sv <= 1 : points !== null);
  const categories = extras?.scoringCategories;
  const counts = (...keys: string[]) => categories == null || keys.some(key => categories.includes(key));
  const tags: PlayerWriteup['tags'] = [{ label: label ? `${label} actuals` : 'Season unspecified', tone: 'neutral' }];
  const result: PlayerWriteup = {
    headline: gpKnown && gp >= 8 ? 'Incomplete rate data' : 'Limited sample', summary: '', analysis: '', tags,
    hasEnoughData: enough, cardNote: `${label ?? 'Recorded stats'} · ${gpKnown ? `${gp} GP` : 'GP unavailable'}`, cardTone: 'neutral',
  };
  if (!enough) {
    result.summary = !gpKnown ? `${name}'s available stat record does not include a usable appearance count.`
      : gp === 0 ? `${name} had no NHL appearances recorded in ${period}.`
      : gp < 8 ? `${name} had ${gp} ${goalie ? 'appearances' : 'games'} recorded in ${period}${!goalie && points !== null ? ` with ${points} points` : ''}, too small a sample to establish a scoring rate.`
      : `${name} had ${gp} ${goalie ? 'appearances' : 'games'} recorded in ${period}, with incomplete ${goalie ? 'save-percentage' : 'scoring'} data.`;
    result.analysis = currentDecision(extras, goalie ? 'goaltending contribution' : 'scoring contribution', false, goalie)
      ?? (gp < 8 && gpKnown ? 'A larger NHL sample is needed before using these results as a dependable rate.' : 'The missing rate data prevents a supported comparison with other roster options.');
    tags.push({ label: result.headline, tone: 'neutral' });
    return result;
  }

  let summary = '';
  let conclusion = '';
  let anchor = '';
  let ppHeavy = false;
  if (goalie) {
    const normalized = sv as number;
    const winRate = finite(s.wins) ? s.wins / gp : null;
    const weakRatios = normalized < 0.905;
    const highWinsWeakRatios = winRate !== null && winRate >= 0.5 && weakRatios;
    const ratios = counts('save_pct', 'savePct', 'save_percentage', 'sv_pct', 'gaa', 'goals_against_average');
    const volume = counts('wins', 'saves', 'shutouts');
    result.headline = highWinsWeakRatios ? 'Wins with ratio risk' : normalized >= 0.915 ? 'Save-rate strength' : normalized < 0.9 ? 'Ratio recovery needed' : 'Workload-sensitive goalie';
    summary = `${name} made ${gp} appearances in ${period}${finite(s.wins) ? `, winning ${s.wins}` : ''}, with a ${save(normalized)} save percentage${finite(s.gaa) ? ` and ${fmt(s.gaa, 2)} goals-against average` : ''}.`;
    anchor = weakRatios ? 'wins opportunity and save-percentage risk' : 'save-rate contribution';
    if (categories && !ratios && !volume && !counts('goals_against')) conclusion = 'This scoring setup does not reward the supplied goalie categories, so these results do not establish a direct scoring contribution.';
    else if (categories && !ratios) conclusion = counts('goals_against')
      ? 'Goals allowed carry a scoring cost here, so a busier night is not automatically more valuable. Price the confirmed workload alongside that cost, using the save rate as performance context.'
      : `This setup rewards ${categories.filter(c => ['wins', 'saves', 'shutouts'].includes(c)).join(', ')}. ${winRate !== null && winRate < .5 && counts('wins') ? 'Fewer than half of the recorded appearances produced a win, so past workload alone is a weak case for chasing that category.' : 'The next confirmed start matters more to direct scoring than a change in the save-percentage ranking.'}`;
    else if (categories && !counts('save_pct', 'savePct', 'save_percentage', 'sv_pct')) conclusion = `This setup scores goals-against average, so use the recorded GAA as the ratio benchmark. ${volume ? 'Additional starts can add counting stats, with their effect on that average evaluated separately.' : 'Extra appearances are useful only if they improve the ratio outlook; neither wins nor save percentage scores directly here.'}`;
    else if (categories && !volume) conclusion = `${weakRatios ? 'Adding appearances at that save rate would expose the roster to more ratio damage.' : 'The save rate is the direct contribution to this setup.'} Wins do not add direct scoring value here; choose the next start for its ratio outlook, not to fill a volume target.`;
    else if (highWinsWeakRatios) conclusion = 'The win return and the save rate supported different roster needs. A wins chase can justify exposure that a save-percentage lead cannot; decide which category the next start needs to serve.';
    else if (weakRatios) conclusion = 'More appearances offer another chance at wins and saves, but repeating that save rate would work against a ratio roster. A rebound in performance and a larger workload are separate assumptions.';
    else if (normalized >= .915) conclusion = 'The save rate supported ratio value across an established sample. Turning that strength into more counting stats still depends on the next crease allocation; recorded appearances do not establish his current share of starts.';
    else conclusion = 'The recorded save rate leaves the next start as a workload decision. Choose additional exposure for the category needed, with team wins and individual save performance evaluated separately.';
    if (typeof s.goalsSavedAboveExpected === 'number' && Number.isFinite(s.goalsSavedAboveExpected) && Math.abs(s.goalsSavedAboveExpected) >= 5) {
      const x = s.goalsSavedAboveExpected;
      summary += ` Citrus GSAx measured ${fmt(Math.abs(x))} goals ${x >= 0 ? 'saved above' : 'allowed beyond'} expected.`;
      if ((x >= 5 && weakRatios) || (x <= -5 && normalized >= .915)) conclusion = `Citrus's shot-quality adjustment and the raw save rate point in different directions. The chance mix matters to that disagreement; neither measure establishes the future crease split.`;
    }
    result.cardTone = normalized >= .915 ? 'positive' : normalized < .9 ? 'caution' : 'neutral';
    result.cardNote = `${label ?? 'Recorded stats'} · ${save(normalized)} SV%`;
  } else {
    const p = points as number;
    const ppg = p / gp;
    const shots = finite(s.shots) ? s.shots / gp : null;
    const hits = finite(s.hits) ? s.hits / gp : null;
    const blocks = finite(s.blockedShots) ? s.blockedShots / gp : null;
    const peripheralRate = (hits ?? 0) + (blocks ?? 0);
    const rewardedPeripheralRate = (counts('hits') ? hits ?? 0 : 0) + (counts('blocks') ? blocks ?? 0 : 0);
    const pp = finite(s.powerPlayPoints) && s.powerPlayPoints <= p ? s.powerPlayPoints : null;
    const assistShare = finite(s.assists) && p > 0 && s.assists <= p ? s.assists / p : null;
    const shootingPct = finite(s.goals) && finite(s.shots) && s.shots >= 50 && s.goals <= s.shots ? s.goals / s.shots * 100 : null;
    const toiMatch = /^(\d+):([0-5]\d)$/.exec(s.toi ?? '');
    const toi = toiMatch ? Number(toiMatch[1]) + Number(toiMatch[2]) / 60 : null;
    ppHeavy = pp !== null && p > 0 && pp / p >= .4 && pp >= 5;

    if (peripheralRate >= 3.5 && (ppg < .6 || rewardedPeripheralRate >= 5)) {
      const physical = [hits !== null ? `${fmt(hits)} hits` : '', blocks !== null ? `${fmt(blocks)} blocks` : ''].filter(Boolean).join(' and ');
      result.headline = 'Peripheral specialist';
      summary = `${name} supplied ${physical} per game in ${period}, alongside ${fmt(ppg, 2)} points per game.`;
      anchor = 'physical-category contribution';
      const useful = rewardedPeripheralRate >= 3.5;
      conclusion = useful ? `${categories == null ? 'When hits and blocks count, this is' : 'The rewarded physical categories make this'} a way to fill a specific roster gap without needing a scoring night. The cost is limited offence if the same slot needs to supply points.`
        : 'Most of the physical production falls outside the rewarded categories in this setup. The point return leaves little offensive compensation for using the roster slot.';
      tags.push({ label: useful ? 'Peripheral value' : 'Scoring-format tradeoff', tone: useful ? 'positive' : 'neutral' });
    } else if (defence && ppg >= .6 && pp !== null && pp < p / 2) {
      result.headline = 'Scoring beyond the power play';
      summary = `${name} produced ${p} points in ${gp} games in ${period}; ${p - pp} came outside the power play.`;
      anchor = 'offence from a defence slot';
      conclusion = categories && !counts('goals', 'assists', 'points')
        ? `The majority of that offence does not earn a power-play bonus. In this setup, evaluate ${counts('shots') ? 'shots' : counts('blocks') ? 'blocks' : 'the rewarded categories'} directly before giving the full point total weight.`
        : 'Most of the offence came through other scoring situations, broadening the case for a defence slot in points formats. A power-play bonus adds value to only part of that production.';
    } else if (ppHeavy) {
      result.headline = 'Power-play exposure';
      summary = `${name} earned ${pp} of his ${p} points on the power play in ${period}.`;
      anchor = 'power-play scoring contribution';
      conclusion = counts('power_play_points', 'powerPlayPoints')
        ? `${categories == null ? 'Where power-play points earn extra value, that concentration makes' : 'The power-play category makes'} unit retention a central part of the valuation. Reduced special-teams time would require more scoring elsewhere to sustain the same overall return.`
        : 'Power-play points receive no separate reward here, but that opportunity still supplied a substantial part of the offence. Holding the overall pace with less special-teams time would require more production elsewhere.';
      tags.push({ label: 'PP-dependent', tone: 'caution' });
    } else if (assistShare !== null && assistShare >= .65 && shots !== null && shots >= 3.5 && p >= 10) {
      result.headline = 'Playmaking with shot volume';
      summary = `${name} paired ${s.assists} assists with ${fmt(shots)} shots per game in ${period}${toi !== null && toi >= 20 ? ` while averaging ${fmt(toi)} minutes` : ''}.`;
      anchor = 'assist and shot contribution';
      conclusion = !counts('assists', 'points')
        ? `The assist total is not directly rewarded here, so ${counts('shots') ? 'the shooting contribution carries more of the category case' : 'judge the goal return separately from the headline point production'}.`
        : counts('shots') ? `${categories == null ? 'If shots count, the' : 'The'} own-shot contribution covers a different roster need from the assist total; the playmaking does not leave this profile dependent on assists alone.`
          : 'With shots excluded, the assist return carries more of the direct scoring case. A change in shot volume would matter only through the goals it produces.';
      if (toi !== null && toi >= 20) conclusion += ' Carrying that pace forward assumes a comparable workload; more minutes would need fresh deployment evidence.';
    } else if (shootingPct !== null && shootingPct >= 18 && (s.goals ?? 0) >= 15) {
      result.headline = 'Finishing and playmaking';
      summary = `${name} scored ${s.goals} goals on ${fmt(shootingPct)}% shooting in ${period}, with ${fmt(shots as number)} shots per game${finite(s.assists) ? ` and ${s.assists} assists` : ''}.`;
      anchor = 'finishing and playmaking return';
      conclusion = !counts('assists', 'points')
        ? `Assists do not score here, so repeating the goal return is the relevant question. It requires comparable conversion or more shots${counts('shots') ? '; the shot category provides a separate contribution between goals' : ''}.`
        : !counts('goals', 'points')
          ? 'The assist contribution is directly rewarded here. Lower shooting conversion would not, by itself, erase that playmaking value; the goal total should not drive an assists-focused decision.'
          : 'Repeating the goal return at the same shot volume requires that conversion to hold. The assist contribution broadens the scoring case, while one season of high shooting efficiency alone does not establish an impending decline.';
    } else if (shots !== null && shots >= 3) {
      result.headline = 'Volume shooter';
      summary = `${name} generated ${fmt(shots)} shots per game in ${period}${shootingPct !== null ? ` and scored ${s.goals} goals, converting ${fmt(shootingPct)}% of his shots` : ''}.`;
      anchor = 'shot-volume contribution';
      conclusion = counts('shots')
        ? `${categories == null ? 'In leagues counting shots, that' : 'That'} volume still contributes when goals dry up. For the goal return, separate maintaining the workload from maintaining conversion; the scoring total depends on both.`
        : 'Shots are not rewarded directly in this setup. Their value runs through conversion, so repeating the goal total needs sustained volume as well as finishing.';
      tags.push({ label: 'Shot volume', tone: 'positive' });
    } else if (assistShare !== null && assistShare >= .65 && p >= 10) {
      result.headline = 'Assist-led production';
      summary = `${name} recorded ${s.assists} assists against ${finite(s.goals) ? `${s.goals} goals` : `${p} total points`} in ${period}${shots !== null ? `, with ${fmt(shots)} shots per game` : ''}.`;
      anchor = 'assist contribution';
      conclusion = !counts('assists', 'points') ? 'The largest component of the point total does not score directly here. That makes the overall points ranking a poor shortcut for the category need.'
        : `This fits an assists need${shots !== null && shots < 2 ? ', with little shot volume to cover a goals or shots deficit in the same roster slot' : '; evaluate the goal return separately if that is the category the roster lacks'}.`;
    } else {
      result.headline = defence ? 'Blue-line scoring balance' : toi !== null && toi < 14 && ppg < .5 ? 'Scoring with limited minutes' : 'Balanced scoring profile';
      summary = `${name} recorded ${p} points in ${gp} games in ${period}${toi !== null && toi < 14 && ppg < .5 ? ` while averaging ${fmt(toi)} minutes per game` : ''}.`;
      anchor = defence ? 'offence from a defence slot' : 'scoring contribution';
      conclusion = toi !== null && toi < 14 && ppg < .5
        ? 'At that workload, a larger point return needs more minutes or more scoring per minute. There is no supplied deployment change to support assuming either.'
        : finite(s.goals) && finite(s.assists)
          ? `${s.goals} goals and ${s.assists} assists show how that production was distributed. ${categories && !counts('goals', 'assists', 'points') ? 'The total does not establish value in this setup; use the rewarded categories directly.' : defence ? 'Use that offensive mix for the defence slot; scoring alone does not establish top-pair deployment.' : 'Choose it for the scoring category the roster needs, rather than assigning the full point total equal value in every format.'}`
          : 'The total supports a point-rate comparison, but the missing scoring split limits a goals-versus-assists decision.';
    }
    // A finishing gap is used only when it adds evidence to the argument.
    if (finite(s.xGoals) && s.xGoals >= 5 && finite(s.goals) && Math.abs(s.goals - s.xGoals) >= 5) {
      const gap = s.goals - s.xGoals;
      conclusion += ` Finishing ended ${fmt(Math.abs(gap))} goals ${gap > 0 ? 'above' : 'below'} the ${fmt(s.xGoals)} Citrus expected goals estimate. ${gap > 0 ? 'A repeat needs that finishing advantage or more chance creation.' : 'Better conversion is a path to more goals, not a guaranteed rebound.'}`;
    }
    result.cardNote = `${label ?? 'Recorded stats'} · ${fmt(ppg, 2)} P/GP`;
    result.cardTone = ppg >= (defence ? .6 : .8) ? 'positive' : 'neutral';
  }
  result.summary = summary;
  result.analysis = currentDecision(extras, anchor, ppHeavy, goalie) ?? conclusion;
  return result;
}
