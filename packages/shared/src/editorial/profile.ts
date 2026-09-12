import type { PlayerWriteup, WriteupExtras, WriteupPlayer } from '../playerWriteup';
import { dataSeasonLabel } from '../seasonContext';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const fmt = (n: number, dp = 1) => String(Number(n.toFixed(dp)));
const save = (n: number) => (n > 1 ? n / 100 : n).toFixed(3).replace(/^0/, '');

/** Selects an analytical angle from evidence, never from a player-name seed. */
export function profileWriteup(player: WriteupPlayer, extras?: WriteupExtras): PlayerWriteup {
  const s = player.stats ?? {};
  const gpKnown = finite(s.gamesPlayed);
  const gp = gpKnown ? s.gamesPlayed as number : 0;
  const goalie = /^(g|goalie|goaltender)$/i.test(player.position);
  const defence = /^(d|defence|defense|defenceman|defenseman)$/i.test(player.position);
  const label = dataSeasonLabel(player.statsSeason);
  const period = label ?? 'the available stat record';
  const current = label !== null && player.statsSeason === extras?.projectionSeason;
  const baseline = current ? '' : `The ${label ?? 'recorded'} rates are a historical baseline. `;
  const name = player.name?.trim() || 'This player';
  const points = finite(s.points) ? s.points : (finite(s.goals) && finite(s.assists) ? s.goals + s.assists : null);
  const sv = finite(s.savePct) && s.savePct > 0 ? (s.savePct > 1 ? s.savePct / 100 : s.savePct) : null;
  const enough = gp >= 8 && (goalie ? sv !== null && sv <= 1 : points !== null);
  const tags: PlayerWriteup['tags'] = [{ label: label ? `${label} actuals` : 'Season unspecified', tone: 'neutral' }];
  const result: PlayerWriteup = {
    headline: 'Limited sample', summary: '', analysis: '', tags, hasEnoughData: enough,
    cardNote: `${label ?? 'Recorded stats'} · ${gp} GP`, cardTone: 'neutral',
  };
  if (!enough) {
    result.summary = !gpKnown ? `${name}'s available stat record does not include a usable appearance count.` : gp === 0 ? `${name} had no NHL appearances recorded in ${period}.`
      : `${name} had ${gp} ${goalie ? 'appearances' : 'games'} recorded in ${period}${!goalie && points !== null ? ` with ${points} points` : ''}. Too small a sample or incomplete rate data to establish an NHL scoring profile.`;
    result.analysis = goalie ? 'Confirm the next start and the crease split; this sample cannot establish either a reliable save rate or a workload.'
      : 'Check the line assignment and power-play deployment before extrapolating these results. A short scoring burst cannot establish a sustainable rate.';
    tags.push({ label: 'Limited sample', tone: 'neutral' });
    return result;
  }
  const analysis: string[] = [];
  const summary: string[] = [];
  if (goalie) {
    const normalized = sv as number;
    const winRate = finite(s.wins) ? s.wins / gp : null;
    const highWinsWeakRatios = winRate !== null && winRate >= 0.5 && normalized < 0.905;
    result.headline = highWinsWeakRatios ? 'Wins with ratio risk' : normalized >= 0.915 ? 'Save-rate strength' : normalized < 0.9 ? 'Ratio recovery needed' : 'Workload-sensitive goalie';
    summary.push(`${name} made ${gp} appearances in ${period}, with a ${save(normalized)} save percentage${finite(s.gaa) ? ` and a ${fmt(s.gaa, 2)} goals-against average` : ''}.`);
    if (finite(s.wins) && finite(s.losses)) summary.push(`His record was ${s.wins}-${s.losses}${s.shutouts ? ` with ${s.shutouts} shutouts` : ''}.`);
    const goalieCategories = extras?.scoringCategories;
    const countsRatios = !goalieCategories || goalieCategories.some(c => ['save_pct', 'save_percentage', 'sv_pct', 'gaa', 'goals_against_average'].includes(c));
    const countsVolume = !goalieCategories || goalieCategories.some(c => ['wins', 'saves', 'shutouts'].includes(c));
    if (goalieCategories && !countsRatios) analysis.push(`This setup rewards ${goalieCategories.filter(c => ['wins', 'saves', 'shutouts', 'goals_against'].includes(c)).map(c => c.replace(/_/g, ' ')).join(', ') || 'no supplied goalie categories'}. The ${save(normalized)} save rate is performance context; confirm starts and evaluate the categories actually scored before valuing the workload.`);
    else if (goalieCategories && !countsVolume) analysis.push(`This setup emphasizes ratios rather than wins or saves volume. The ${save(normalized)} save rate describes the exposure each additional start brings; the ${finite(s.wins) ? s.wins : 'recorded'} wins do not add direct scoring value here.`);
    else if (highWinsWeakRatios) analysis.push(`The ${s.wins} wins and ${save(normalized)} save rate pull in opposite directions: winning decisions add volume value, while each additional start exposes a ratio roster to the weaker save rate.`);
    else if (normalized >= 0.915) analysis.push(`The ${save(normalized)} save rate is the attraction for ratio categories. Turning it into wins and saves volume still requires starts; a strong percentage alone cannot establish the crease split.`);
    else if (normalized < 0.9) analysis.push(`At ${save(normalized)}, adding starts can hurt save-percentage results even when it adds counting stats. A confirmed start is a decision to weigh against the roster's ratio position, not an automatic play.`);
    else analysis.push(`The ${save(normalized)} save rate leaves workload as a separate question. Wins depend on the team result as well as the goaltending, so confirm starts before treating past win totals as repeatable volume.`);
    if (typeof s.goalsSavedAboveExpected === 'number' && Number.isFinite(s.goalsSavedAboveExpected)) {
      const x = s.goalsSavedAboveExpected;
      summary.push(`Citrus GSAx credited him with ${fmt(Math.abs(x))} goals ${x >= 0 ? 'saved above' : 'allowed beyond'} expected.`);
      analysis.push(x >= 5 ? 'The positive shot-quality-adjusted result adds support beyond the raw save percentage; it still does not promise the same future workload.' : x <= -5 ? 'The negative shot-quality-adjusted result is another reason to separate a rebound forecast from the performance already recorded.' : 'The shot-quality-adjusted result supplies context for the raw save rate, without establishing future starts.');
    }
    analysis.push(`${baseline}Recorded appearances do not establish his current share of starts.`);
    result.cardTone = normalized >= 0.915 ? 'positive' : normalized < 0.9 ? 'caution' : 'neutral';
    result.cardNote = `${label ?? 'Recorded stats'} · ${save(normalized)} SV%`;
  } else {
    const p = points as number;
    const shots = finite(s.shots) ? s.shots / gp : null;
    const hits = finite(s.hits) ? s.hits / gp : null;
    const blocks = finite(s.blockedShots) ? s.blockedShots / gp : null;
    const peripherals = hits !== null || blocks !== null ? (hits ?? 0) + (blocks ?? 0) : null;
    const ppShare = finite(s.powerPlayPoints) && p > 0 && s.powerPlayPoints <= p ? s.powerPlayPoints / p : null;
    const assistShare = finite(s.assists) && p > 0 && s.assists <= p ? s.assists / p : null;
    const ppHeavy = ppShare !== null && ppShare >= 0.4 && (s.powerPlayPoints ?? 0) >= 5;
    const categories = extras?.scoringCategories;
    const rewardedPeripheralRate = ((categories == null || categories.includes('hits')) ? hits ?? 0 : 0) + ((categories == null || categories.includes('blocks')) ? blocks ?? 0 : 0);
    const peripheralValue = rewardedPeripheralRate >= 3.5;
    const peripheralLine = [hits !== null ? `${fmt(hits)} hits` : '', blocks !== null ? `${fmt(blocks)} blocks` : ''].filter(Boolean).join(' and ');
    let angle: string;
    if (peripherals !== null && peripherals >= 3.5 && (p / gp < 0.6 || peripheralValue && peripherals >= 5)) {
      result.headline = 'Peripheral specialist';
      angle = `${name}'s ${peripheralLine} per game supplied a different route to value than his ${fmt(p / gp, 2)} points per game.`;
      analysis.push(peripheralValue ? `Hits and blocks can contribute without a scoring play, which makes this profile useful when those categories count. The tradeoff is the ${fmt(p / gp, 2)}-point rate if the roster needs offence.` : 'Most of this physical workload falls outside the rewarded categories in this setup, so it does not compensate for the limited point production.');
      tags.push({ label: peripheralValue ? 'Peripheral value' : 'Scoring-format tradeoff', tone: peripheralValue ? 'positive' : 'neutral' });
    } else if (finite(s.goals) && p > 0 && s.goals / p >= 0.48 && s.goals / gp >= 0.4) {
      result.headline = 'Goal-led scoring';
      angle = `${name}'s ${s.goals} goals supplied ${Math.round(s.goals / p * 100)}% of his points in ${period}${shots !== null ? `, on ${fmt(shots)} shots per game` : ''}.`;
      analysis.push(`Goals drove more of this point total than assists. That matters when goals carry extra weight;${shots !== null && shots >= 3 ? ' the shot volume provides repeated scoring opportunities, but conversion still determines the goal return' : ' compare the goal return with the available shot volume before assuming the same finishing rate'}.`);
    } else if (ppHeavy && (shots === null || shots < 3.5 || (ppShare as number) >= 0.45)) {
      result.headline = 'Power-play exposure';
      angle = `${name} drew ${Math.round((ppShare as number) * 100)}% of his points from the power play in ${period}.`;
      analysis.push(`That scoring mix makes special-teams opportunity consequential: losing power-play time would remove one of the established scoring routes. The point share does not identify his unit or guarantee the next assignment.`);
      tags.push({ label: 'PP-dependent', tone: 'caution' });
    } else if (assistShare !== null && assistShare >= 0.65 && shots !== null && shots >= 3.5 && p >= 10) {
      result.headline = 'Dual scoring routes';
      angle = `${name} paired ${s.assists} assists with ${fmt(shots)} shots per game in ${period}, combining setup points with his own shooting volume.`;
      analysis.push(`Assists supplied ${Math.round(assistShare * 100)}% of the points, but the ${fmt(shots)}-shot rate adds a separate route to contribution when shots count. A change in teammates' finishing can affect the assists without removing his own attempts.`);
    } else if (assistShare !== null && assistShare >= 0.65 && p >= 10) {
      result.headline = defence ? 'Blue-line playmaking' : 'Assist-led production';
      angle = `${name}'s ${s.assists} assists accounted for ${Math.round(assistShare * 100)}% of his points in ${period}.`;
      analysis.push(`${defence ? 'From a defence slot, this profile' : 'This profile'} contributes most directly through assists. Those points require a teammate to finish the play. ${shots !== null && shots < 2 ? `With ${fmt(shots)} shots per game, his own shooting supplied less category coverage.` : 'Check the shooting contribution separately when the roster needs goals rather than treating all points as interchangeable.'}`);
    } else if (shots !== null && shots >= 3) {
      result.headline = 'Volume shooter';
      angle = `${name} generated ${fmt(shots)} shots per game in ${period}, making shot volume the foundation of this scoring profile.`;
      analysis.push(categories && !categories.includes('shots') ? `Shots are not rewarded directly in this setup. The ${fmt(shots)}-shot rate matters as scoring opportunity, with value still dependent on conversion.` : `The ${fmt(shots)}-shot rate offers a contribution in leagues counting shots even when goals dry up. Finishing can move independently of that volume; shot totals alone do not establish where the chances came from.`);
      tags.push({ label: 'Shot volume', tone: 'positive' });
    } else {
      result.headline = defence ? 'Blue-line scoring balance' : 'Balanced scoring profile';
      angle = `${name} recorded ${fmt(p / gp, 2)} points per game in ${period}${finite(s.goals) && finite(s.assists) ? `, split between ${s.goals} goals and ${s.assists} assists` : ''}.`;
      analysis.push(defence ? `For a defence slot, the ${fmt(p / gp, 2)}-point rate describes the offensive contribution. Compare the supplied shots and blocks with the roster's category needs; the scoring rate does not establish top-pair deployment.` : `The ${fmt(p / gp, 2)}-point rate describes the scoring contribution without identifying a single dominant category. Use the goals/assists split and confirmed deployment to decide whether that production fills the roster's actual need.`);
    }
    summary.push(angle);
    if (finite(s.goals) && finite(s.assists)) summary.push(`${name} recorded ${p} points (${s.goals} goals, ${s.assists} assists) in ${gp} games in ${period}.`);
    const toi = /^(\d+):([0-5]\d)$/.exec(s.toi ?? '');
    if (toi && Number(toi[1]) + Number(toi[2]) / 60 > 0) summary.push(`He played ${fmt(Number(toi[1]) + Number(toi[2]) / 60)} minutes per game.`);
    if (ppHeavy && result.headline !== 'Power-play exposure') analysis.push(`${Math.round((ppShare as number) * 100)}% of the points came on the power play. Confirm the current unit before carrying that contribution forward.`);
    if (finite(s.xGoals) && s.xGoals >= 5 && finite(s.goals)) {
      const gap = s.goals - s.xGoals;
      if (Math.abs(gap) >= 5) analysis.push(`${s.goals} goals against ${fmt(s.xGoals)} Citrus expected goals left finishing ${fmt(Math.abs(gap))} goals ${gap > 0 ? 'above' : 'below'} the model's chance estimate. That is a sustainability question, not proof of luck or a guaranteed reversal.`);
    }
    if (baseline) analysis.push(baseline.trim());
    result.cardNote = `${label ?? 'Recorded stats'} · ${fmt(p / gp, 2)} P/GP`;
    result.cardTone = p / gp >= (defence ? 0.6 : 0.8) ? 'positive' : 'neutral';
  }
  result.summary = summary.join(' ');
  result.analysis = analysis.join(' ');
  return result;
}
