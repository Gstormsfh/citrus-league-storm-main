"""Pure official appearance reconciliation; no fabricated historical provenance."""
import re


SUMMARY_URL = "https://api.nhle.com/stats/rest/en/skater/summary"


def official_summary_population(receipts, season):
    """Validate a complete, one-row-per-skater season summary, including trades.

    NHL's single-season summary uses teamAbbrevs for all stints in a player row.
    Never sum landing seasonTotals or reverse rounded timeOnIcePerGame into TOI.
    Every raw page and its exact query are retained by the collector.
    """
    if not isinstance(receipts, list) or not receipts:
        return None
    players = {}
    total = None
    offset = 0
    for receipt in receipts:
        if not isinstance(receipt, dict) or receipt.get("status") != "ok":
            return None
        params = receipt.get("params", {})
        payload = receipt.get("payload")
        if (receipt.get("url") != SUMMARY_URL or not isinstance(payload, dict)
                or params.get("cayenneExp") != f"seasonId={season}{season + 1} and gameTypeId=2"
                or params.get("isAggregate") != "false" or params.get("isGame") != "false"
                or params.get("sort") != '[{"property":"playerId","direction":"ASC"}]'
                or params.get("start") != offset or type(params.get("limit")) is not int
                or params["limit"] <= 0):
            return None
        count = payload.get("total")
        rows = payload.get("data")
        if type(count) is not int or count <= 0 or not isinstance(rows, list):
            return None
        if total is not None and total != count:
            return None
        total = count
        if offset >= total or len(rows) != min(params["limit"], total - offset):
            return None
        for row in rows:
            if not isinstance(row, dict):
                return None
            pid, gp = row.get("playerId"), row.get("gamesPlayed")
            if (row.get("seasonId") != season * 10000 + season + 1
                    or type(pid) is not int or pid <= 0 or pid in players
                    or (players and pid <= next(reversed(players)))
                    or type(gp) is not int or gp <= 0):
                return None
            players[pid] = gp
        offset += len(rows)
    return players if offset == total else None


def parse_toi(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,3}:[0-5]\d", value):
        return None
    minutes, seconds = map(int, value.split(":"))
    return minutes * 60 + seconds


def official_gp_from_landing(data, season):
    exact = season * 10000 + season + 1
    featured = data.get("featuredStats", {})
    if featured.get("season") == exact:
        gp = featured.get("regularSeason", {}).get("subSeason", {}).get("gamesPlayed")
        if type(gp) is int and gp >= 0:
            return gp
    # Historical single-team season records are unambiguous. Multi-team totals
    # need a verified aggregate-row convention; do not guess or double-count.
    totals = [r for r in data.get("seasonTotals", []) if r.get("season") == exact
              and r.get("leagueAbbrev") == "NHL" and r.get("gameTypeId") == 2]
    if len(totals) == 1:
        gp = totals[0].get("gamesPlayed")
        if type(gp) is int and gp >= 0:
            return gp
    return None


def reconcile_appearances(stored, official_log, official_gp, season):
    """Exact identities and TOI must agree with a GP-complete official game log."""
    if official_log is None or official_gp is None:
        return {"available": False, "reason": "official_source_unavailable"}
    if not isinstance(official_log, list) or type(official_gp) is not int or official_gp < 0:
        return {"available": False, "reason": "official_source_invalid"}
    logs = {}
    for row in official_log:
        if not isinstance(row, dict):
            return {"available": False, "reason": "official_source_invalid"}
        gid = row.get("gameId")
        if type(gid) is not int or not season * 1000000 + 20000 <= gid < season * 1000000 + 30000:
            return {"available": False, "reason": "official_population_mismatch"}
        if gid in logs:
            return {"available": False, "reason": "official_duplicate"}
        seconds = parse_toi(row.get("toi"))
        if seconds is None:
            return {"available": False, "reason": "official_toi_missing"}
        logs[gid] = seconds
    if len(logs) != official_gp or official_gp <= 0:
        return {"available": False, "reason": "official_log_incomplete"}
    if any(type(r.get("game_id")) is not int for r in stored):
        return {"available": False, "reason": "stored_identity_invalid"}
    games = {r["game_id"]: r.get("nhl_toi_seconds") for r in stored}
    if len(games) != len(stored):
        return {"available": False, "reason": "stored_duplicate"}
    if games.keys() != logs.keys():
        return {"available": False, "reason": "event_set_mismatch",
                "missing_games": sorted(logs.keys() - games.keys()),
                "extra_games": sorted(games.keys() - logs.keys())}
    changed = [gid for gid in logs if type(games[gid]) is not int or games[gid] != logs[gid]]
    if changed:
        return {"available": False, "reason": "toi_mismatch", "games": sorted(changed)}
    return {"available": True, "reason": "verified", "games_played": official_gp,
            "toi_seconds": sum(logs.values()),
            "avg_toi_per_game": round(sum(logs.values()) / official_gp / 60, 2)}
