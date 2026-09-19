"""Read-only advance warnings. Never extends or approves a review boundary."""
from datetime import date, datetime, timedelta, timezone


def review_notice(source, policy, now):
    if now.tzinfo is None or source.get('revision') != policy.get('source_revision'):
        raise ValueError('review_source_or_clock_mismatch')
    records = [('operational_policy', policy),
               ('source_release_review', source['source_release_review']),
               ('finishing_refresh_policy', source['finishing_refresh_policy'])]
    records += [('player:' + str(p['player_id']), p['availability_scenario'])
                for p in source['players'] if p.get('availability_scenario')]
    items = []
    for key, record in records:
        reviewed, deadline = (date.fromisoformat(record[k])
                              for k in ('reviewed_at', 'review_after'))
        if reviewed >= deadline or reviewed > now.astimezone(timezone.utc).date():
            raise ValueError('invalid_review_window')
        expires = datetime.combine(deadline, datetime.min.time(), timezone.utc)
        if expires - now <= timedelta(hours=24):
            items.append({'review': key, 'expires_at': expires.isoformat(),
                          'expired': now >= expires})
    return {'review_due': bool(items), 'review_items': items,
            'review_notice_hours': 24,
            'review_authority': 'Engineering: release task; manual injury/status: Citrus owner'}
