"""Customer-facing attribution; complete evidence stays in the source snapshot."""

def availability_note(player):
    availability = player.get('availability') or {}
    source = availability.get('source')
    pieces = [f"{player['name']}: {availability.get('status', 'unknown').replace('_', ' ')}."]
    if availability.get('reason'):
        pieces.append(str(availability['reason']))
    if isinstance(source, dict):
        # Whitelist presentation fields instead of leaking nested audit records,
        # raw before-images, database IDs or implementation keys into the guide.
        if source.get('reference'):
            pieces.append('Source: ' + str(source['reference']) + '.')
        if source.get('url'):
            pieces.append(str(source['url']))
        if source.get('source_date') and source.get('kind') != 'manual_confirmation':
            pieces.append('Source date: ' + str(source['source_date']) + '.')
        if source.get('adopted_at'):
            pieces.append('Workbook adopted: ' + str(source['adopted_at']) + ' (not a new injury observation).')
        review_due = source.get('review_due_at') or availability.get('review_after')
        if review_due:
            pieces.append('Review due: ' + str(review_due) + ' (not a recovery date).')
        if source.get('independently_verified') is False:
            pieces.append('Not independently verified.')
        if source.get('kind') == 'manual_confirmation':
            pieces.append('This manual note does not establish medical clearance or fantasy IR eligibility.')
        if not source.get('reference') and not source.get('url'):
            pieces.append('Source attribution not supplied.')
    else:
        if availability.get('as_of'):
            pieces.append('Recorded as of ' + str(availability['as_of']) + '.')
        pieces.append('Source: ' + str(source or 'not supplied') + '.')
    return ' '.join(pieces)
