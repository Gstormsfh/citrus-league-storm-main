import type { DashboardIndexEntry } from '../types/playerDashboard';
import type { PlayerWriteup, WriteupExtras } from '../playerWriteup';
import { getSeasonStartDate } from '../constants/season';
import { canonicalEditorialContext } from './canonicalContext';
import { selectEditorialNews, type EditorialNewsItem } from './news';
import { CITRUS_EDITORIAL_VERSION } from './index';

const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const f = (v: number, digits = 1) => String(Number(v.toFixed(digits)));
const seasonName = (v: number) => `${v}-${String(v + 1).slice(-2)}`;

/** One evidence-led forecast argument, shared by remote card summaries and
 * persisted season outlooks. Never uses a precomputed default fantasy score.
 * The same facts deliberately produce the same thesis; no name/ID rotation.
 */
export function seasonOutlookWriteup(
  entry: DashboardIndexEntry,
  items: readonly EditorialNewsItem[] = [],
  now: Date = new Date(),
  extras?: WriteupExtras,
): PlayerWriteup | null {
  const season = entry.projection_season ?? entry.canonical_context?.season;
  if (!number(season)) return null;
  const seasonLabel = seasonName(season);
  const start = getSeasonStartDate(season);
  const inSeason = start !== null && now.toISOString().slice(0, 10) >= start;
  const label = inSeason ? `${seasonLabel} rest-of-season` : seasonLabel;
  const name = entry.name;
  const canonical = canonicalEditorialContext(entry, entry.canonical_context, now);
  const news = selectEditorialNews(entry, items, now);
  const gp = number(entry.proj_gp) ? entry.proj_gp : null;
  const publication = entry.canonical_context;
  if (publication?.status === 'projected' && (gp === null || entry.projection_run_id !== publication.run_id || entry.projection_revision !== publication.revision)) return null;
  const allocated = gp !== null && gp > 0;
  const retired = entry.current_affiliation?.status === 'retired';
  const exposureUnit = entry.canonical_context?.exposure?.unit === 'starts' ? 'starts' : 'appearances';
  const historical = number(entry.actuals_season) && entry.actuals_season <= season && entry.gp >= 8;
  const actualLabel = historical ? seasonName(entry.actuals_season!) : null;
  let thesis = '';
  let summary = '';
  let analysis = '';
  let anchor = '';

  if (retired) {
    thesis = 'Playing opportunity withdrawn';
    summary = `${name} is retired in Citrus's maintained affiliation record. The ${label} outlook therefore has no active playing opportunity to value.`;
    analysis = 'A retained historical or numerical scenario does not establish a return to play. An updated affiliation record and a supported playing commitment would be needed before treating him as an active roster option.';
    anchor = 'an active playing commitment';
  } else if (!allocated) {
    thesis = 'Opportunity not allocated';
    summary = `${name} needs a path to ${entry.is_goalie ? 'the crease' : 'the NHL lineup'} before there is a useful season-total case. Citrus has not allocated ${label} ${entry.is_goalie ? 'starts' : 'games'} to him.`;
    if (historical && entry.is_goalie) {
      analysis = `The ${actualLabel} record supplies ${entry.gp} appearances${number(entry.save_pct) && entry.save_pct > 0 ? ` and a ${entry.save_pct.toFixed(3).replace(/^0/, '')} save percentage` : ''}; it does not assign a share of the coming season's starts.`;
    } else if (historical) {
      analysis = `${entry.points} points and ${entry.sog} shots in ${entry.gp} games belong to ${actualLabel}. A season-total valuation needs a supported path to games before those rates can be applied to ${label}.`;
    } else {
      analysis = 'The supplied NHL record does not establish a dependable rate. A confirmed roster place and usable workload are the missing inputs for a season-total valuation.';
    }
    anchor = 'access to a roster role';
  } else if (!historical && !entry.is_goalie) {
    thesis = 'Opportunity ahead of NHL evidence';
    summary = `${name} is an opportunity bet: the available NHL record is too thin to validate the ${label} forecast. The working plan gives him ${f(gp)} games, so earning and keeping a lineup place carries more weight than a precise scoring pace.`;
    analysis = entry.canonical_context?.role?.pp === 'PP2'
      ? 'Citrus’s role scenario puts him on the second power-play unit. That leaves a route to more offence if he earns a larger role, with less special-teams access if the initial plan holds.'
      : entry.canonical_context?.role?.pp === 'PP1'
        ? 'The working role includes the first power-play unit. That is a meaningful opportunity assumption to verify in camp, especially when there is little NHL evidence beneath the estimate.'
        : 'Watch for a sustained lineup role before paying for the full allocation; the projection needs opportunity to become usable production.';
    anchor = 'earning the forecast role';
  } else if (entry.is_goalie) {
    const saves = number(entry.proj_saves) ? entry.proj_saves : null;
    const wins = number(entry.proj_wins) ? entry.proj_wins : null;
    const ga = number(entry.proj_goals_against) ? entry.proj_goals_against : null;
    const saveRate = saves !== null && ga !== null && saves + ga > 0 ? saves / (saves + ga) : null;
    const load = saves === null ? null : saves / gp;
    if (saveRate !== null && saveRate < .905 && wins !== null && wins / gp >= .48) {
      thesis = 'Wins versus save-rate exposure';
      summary = `${name} fits a wins chase more comfortably than a roster protecting save percentage. The ${label} forecast pairs ${f(wins, 0)} wins with an implied ${saveRate.toFixed(3).replace(/^0/, '')} save rate.`;
      analysis = 'Extra starts are useful only if the counting-stat need outweighs the ratio exposure. This is a different roster choice when the priority is defending an existing save-percentage lead.';
    } else if (load !== null && load >= 27) {
      thesis = 'Saves carried by shot workload';
      summary = `${name}'s appeal is the chance to accumulate saves through busy nights. Citrus projects ${f(saves!, 0)} saves over ${f(gp)} ${exposureUnit} for ${label}.`;
      analysis = 'That volume can fill a saves need, but a league penalizing goals allowed puts a price on the same exposure. Treat shot workload as an opportunity rather than an automatic scoring benefit.';
    } else if (gp >= 50) {
      thesis = 'Season volume with a performance condition';
      summary = `${name} is a season-volume option in the ${label} plan, with ${f(gp)} projected ${exposureUnit}. The case rests on regular access to games more than on picking isolated matchups.`;
      analysis = `${saveRate === null ? 'The supplied forecast does not establish the ratio return.' : `An implied ${saveRate.toFixed(3).replace(/^0/, '')} save rate makes performance a separate condition on that volume.`} A roster looking for dependable counting opportunities should still track how the crease is actually divided.`;
    } else {
      thesis = 'Selective workload';
      summary = `${name} fits a selective-start plan more naturally than a heavy season workload. Citrus allocates ${f(gp)} ${exposureUnit} for ${label}, leaving a roster with start minimums dependent on another source of games.`;
      analysis = `${saveRate !== null ? `The implied ${saveRate.toFixed(3).replace(/^0/, '')} save rate helps frame the performance expectation. ` : ''}The useful question is which confirmed starts serve the categories needed, rather than whether a full-season total looks large.`;
    }
    anchor = 'the balance between workload and goaltending performance';

  } else {
    const goals = entry.proj_goals;
    const assists = entry.proj_assists;
    if (!number(goals) || !number(assists)) return null;
    const points = goals + assists;
    const shots = number(entry.proj_sog) ? entry.proj_sog : null;
    const ppp = number(entry.proj_ppp) ? entry.proj_ppp : null;
    const hits = number(entry.proj_hits) ? entry.proj_hits : null;
    const blocks = number(entry.proj_blocks) ? entry.proj_blocks : null;
    const shotRate = shots === null ? null : shots / gp;
    const assistShare = points > 0 ? assists / points : 0;
    const ppShare = ppp !== null && points > 0 ? ppp / points : 0;
    const defence = entry.position === 'D';
    const physical = (hits ?? 0) + (blocks ?? 0);
    if (physical / gp >= 3.5 && points / gp < .65) {
      thesis = 'Physical categories before offence';
      summary = `${name} is a physical-category addition before he is an offensive one. The ${label} forecast puts ${f(physical, 0)} combined hits and blocks beside ${f(points, 0)} points.`;
      analysis = 'He can fill a hits-and-blocks gap without requiring a scoring night. In a format that excludes those categories, there is much less offensive compensation for the roster slot.';
      anchor = 'physical-category production';
    } else if (defence && points / gp >= .6 && ppp !== null && ppShare < .5) {
      thesis = 'Defence-slot offence beyond special teams';
      summary = `${name} offers a way to get substantial offence from a defence slot without relying entirely on special teams. Most of the ${f(points, 0)}-point ${label} forecast comes outside the power play.`;
      analysis = `That broader scoring base can matter when building around defencemen with narrower category contributions. The ${f(assists, 0)} projected assists are the main offensive strength; a power-play bonus adds to the case rather than defining it.`;
      anchor = 'offence from a defence slot';
    } else if (shotRate !== null && shotRate >= 4) {
      thesis = 'Shot volume alongside playmaking';
      summary = `${name} brings shot volume to an assist-rich offensive profile. At ${f(shotRate, 1)} projected shots per game for ${label}, there is a recurring contribution to chase even when the finishing goes quiet.`;
      analysis = `The ${f(assists, 0)}-assist forecast gives him value beyond being a goals-and-shots specialist. That combination is useful alongside efficient scorers who produce fewer shots of their own, provided shots are rewarded in the league.`;
      anchor = 'shot generation alongside assists';
    } else if (assistShare >= .68 && points / gp >= .75) {
      thesis = 'Playmaking sets the offensive shape';
      summary = `${name} is a playmaking anchor for a roster that needs assists without giving up its shooting contribution. The ${f(assists, 0)}-assist ${label} forecast makes that the defining strength of his offensive profile.`;
      analysis = `Pairing that playmaking with goals-first players balances the roster's goals and assists. ${shots !== null ? `The supporting ${f(shots, 0)} shots keep this from being an assists-only contribution. ` : ''}A goals-only format would capture less of what makes the profile valuable.`;
      anchor = 'assist-led offence';
    } else if (ppp !== null && ppShare >= .4 && ppp >= 10) {
      thesis = 'Special-teams concentration';
      summary = `${name}'s ${label} upside is closely tied to special-teams opportunity. The forecast puts ${f(ppShare * 100, 0)}% of his offence on the power play, making that usage the deployment to watch most closely.`;
      analysis = `A league awarding a power-play bonus has a clear reason to value this concentration. If that role shrinks, sustaining the same total would require more offence elsewhere; holding the projected opportunity matters more than assuming last season's pace will simply repeat.`;
      anchor = 'power-play opportunity';
    } else if (goals >= assists && goals / gp >= .35) {
      thesis = gp < 70 ? 'Goal production within fewer games' : 'Goals lead the return';
      summary = `${name} supplies a goals-first contribution in the ${label} forecast. ${gp < 70 ? `The tension is pace versus volume: ${f(goals / gp, 2)} goals per game across a ${f(gp)}-game allocation.` : `The projected ${f(goals, 0)} goals give the roster a finishing contribution to pair with assist-heavy players.`}`;
      analysis = gp < 70 ? 'A roster built around that pace needs enough depth to cover the games outside the allocation. The goals are appealing; paying as though the workload were a full season would erase the central tradeoff.' : 'That finishing emphasis fits a goals need more directly than an assists shortage. Shot support and the league’s goal weight determine how much extra value to assign it.';
      anchor = 'goal production and usable games';
    } else if (assistShare >= .6) {
      thesis = 'Assists without a goals-first profile';
      summary = `${name} is better suited to strengthening playmaking than solving a goals shortage. The ${f(assists, 0)}-assist ${label} forecast carries most of the offensive case.`;
      analysis = gp < 50
        ? `The ${f(gp)}-game allocation limits how much of that playmaking reaches a season total. A roster short of games needs another source of volume even if the assist mix fits.`
        : physical / gp >= 2.5
          ? 'Hits and blocks give this assist-led profile another way to contribute when the scoring is quiet. That combination fits a roster needing playmaking and physical categories more directly than one chasing goals.'
          : ppShare >= .3
            ? 'A substantial part of the scoring depends on power-play production. The assist allocation is more useful if that special-teams opportunity holds; a reduced role would leave more to replace at other strengths.'
            : entry.canonical_context?.role?.pp === 'PP2'
              ? 'The working role places him on the second power-play unit, limiting the special-teams opportunity behind this assist-led estimate. A larger share would offer a route to more production, but it still needs to be earned.'
              : shotRate !== null && shotRate >= 2
                ? `The supporting ${f(shotRate)} shots per game offer something to the lineup when assists are quiet. This is a broader category fit than a low-shot distributor, while remaining an assist-led choice.`
                : 'The modest shot support leaves the slot more dependent on setting up scoring plays. It fits an assist shortage better than a roster needing recurring shot production.';
      anchor = 'assists and supporting categories';
    } else {
      thesis = points / gp < .4 ? 'Limited offence, specific category needs' : 'Balanced offensive allocation';
      summary = points / gp < .4 ? `${name} needs a specific category fit to justify the roster slot. The ${label} forecast offers ${f(points, 0)} points across ${f(gp)} games, leaving limited offence to fall back on.` : `${name} offers a relatively even mix of goals and assists in the ${label} forecast. The ${f(points, 0)}-point allocation fits a roster seeking support in both categories rather than a specialist in either.`;
      analysis = physical / gp >= 2 ? 'Hits and blocks provide another way for the slot to contribute between scoring nights. Those categories make the profile more useful in formats that reward them.' : shotRate !== null && shotRate >= 2.5 ? `The supporting ${f(shotRate)} shots per game offer a recurring contribution between scoring nights. That support matters most when shots are a category the roster needs.` : 'With less support from shots and physical categories, the return depends more heavily on scoring nights. Check whether that offensive mix fills the actual roster need.';
      anchor = 'the distribution across scoring categories';
    }

  }

  const status = canonical.availability;
  const unavailable = status && status.authority !== 'imported_scenario' && ['ir', 'ltir', 'out', 'inj', 'injured'].includes(status.status.toLowerCase());
  const statusLabel = status?.status === 'injured' ? 'INJ' : status?.status.toUpperCase();
  if (unavailable) {
    thesis = `${statusLabel}: availability comes first`;
    summary = `${name} remains ${statusLabel} in Citrus's owner-maintained record dated ${status.asOf.slice(0, 10)}, with return timing unconfirmed. ${summary.replace(`${name}'s`, 'The').replace(name, 'He')}`;
    analysis = `${analysis} The allocation already reflects the retained absence scenario; return timing remains unconfirmed.`;
  } else if (status?.status === 'day_to_day' && status.authority !== 'imported_scenario') {
    summary = `${name} is day-to-day in Citrus's maintained record (${status.asOf.slice(0, 10)}); return timing is unconfirmed. ${summary.replace(name, 'He')}`;
  }
  // Integrate the newest relevant report into the argument. Do not append a
  // generic news verdict or a methodology warning to every player.
  if (news.length && (!retired || news[0].kind === 'retirement')) {
    const event = news[0];
    const source = `${event.source} (${event.publishedAt.slice(0, 10)})`;
    if (event.kind === 'trade-request') {
      thesis = 'Team uncertainty around the workload';
      summary = `${source} reported ${name}'s trade request. ${entry.is_goalie ? allocated ? `His ${f(gp!)} projected ${exposureUnit} remain tied to the current team scenario, so the destination question matters as much as the workload itself.` : 'Citrus has not allocated a workload; a destination and supported crease role are needed before estimating his return.' : `The current forecast still uses the maintained club context; a completed move could change the opportunity behind ${anchor}.`}`;
      analysis = entry.is_goalie ? 'A requested move is not a completed trade. Keep the current workload as the working case, with room for a different crease split and team support if a transaction follows.' : `Keep ${anchor} as the working profile, but reassess deployment after any completed move rather than awarding an automatic boost.`;
    } else if (event.kind === 'camp') {
      summary = `${source} reported ${name}'s participation in rookie practice. ${summary.replace(name, 'He')}`;
      analysis += ' Camp participation gives him a chance to earn that role; it does not settle his opening-night place.';
    } else if (event.kind === 'coaching') {
      analysis += ` ${source} covered his discussion of a new head coach; camp deployment is the next check on ${anchor}.`;
    } else if (event.kind === 'retirement') {
      thesis = 'Playing opportunity withdrawn';
      summary = `${source} reported ${name}'s retirement. A retained forecast scenario is no longer a sound reason on its own to reserve an active roster slot.`;
      analysis = 'Use the maintained affiliation record to reconcile the playing status; historical production remains useful as history, not as an expectation of more games.';
    } else {
      summary = `${source}: ${name} ${event.report}. ${summary.replace(name, 'He')}`;
      analysis += unavailable && event.kind === 'cleared'
        ? ' The clearance report and maintained designation need reconciliation before treating him as available.'
        : event.kind === 'practice' ? ' Practice is progress to follow, but game clearance and workload still need confirmation.'
          : event.kind === 'power-play' ? ` The reported unit work strengthens the opportunity case for ${anchor} if it carries into games.`
            : event.kind === 'transaction' ? ` The completed transaction makes the ensuing deployment the next test of ${anchor}.`
              : event.kind === 'out' || event.kind === 'uncertain' ? ' Check the next availability report before relying on the allocated games.'
                : ' Confirm that the dated start applies to the game in the lineup.';
    }
  }
  if (unavailable && !summary.includes(`remains ${statusLabel}`)) summary += ` He remains ${statusLabel} in the maintained record (${status.asOf.slice(0, 10)}); return timing is unconfirmed.`;
  if (typeof extras?.projFp === 'number' && Number.isFinite(extras.projFp) && number(extras?.projGp)) analysis += ` Under this league's configured scoring, the forecast totals ${f(extras.projFp)} fantasy points over ${f(extras.projGp)} ${entry.is_goalie ? 'appearances' : 'games'}.`;
  const affiliation = entry.current_affiliation;
  if (affiliation && entry.projection_team && entry.team !== entry.projection_team) analysis += ` Current affiliation: ${entry.team || String(affiliation.status ?? 'unconfirmed')}; the retained forecast scenario uses ${entry.projection_team}.`;
  return {
    headline: `${seasonLabel} Outlook: ${thesis}`, summary, analysis,
    tags: [{ label: `${label} forecast`, tone: 'neutral' }, { label: thesis, tone: unavailable ? 'caution' : 'neutral' }],
    hasEnoughData: allocated, cardNote: thesis, cardTone: unavailable ? 'caution' : 'neutral',
    editorialVersion: CITRUS_EDITORIAL_VERSION,
    sourceContext: { actualsSeason: entry.actuals_season ?? null, projectionSeason: season, indexAsOf: entry.as_of,
      canonicalRevision: entry.canonical_context?.revision, canonicalRunId: entry.canonical_context?.run_id },
    newsSources: news, canonicalSources: canonical.sources,
    availabilityExplanation: canonical.availabilityExplanation,
  };
}
