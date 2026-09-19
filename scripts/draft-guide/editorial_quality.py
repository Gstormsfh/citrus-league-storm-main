"""Narrow copy regressions, not an AI detector or a substitute for an editor."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
COPY_FIELDS = ('headline', 'body', 'metricRead', 'fact', 'analysis', 'read', 'risk', 'watch', 'theme', 'campNote')
BUNDLES = ('board-reads.json', 'player-season-context.json', 'player-story-library.json',
           'player-spotlights.json', 'draft-watchlist.json', 'offseason-editorial.json', 'team-readings.json')
# These are rejected stock phrases, not a ban on normal hockey terms such as
# ceiling, upside, role or floor. Preserve useful qualifications and uncertainty.
REJECTED_PHRASES = (
    'the captaincy is not an extra fantasy category',
    'the debut is history; the skating is not',
    'the fantasy purchase', 'a different purchase',
    'buying the playoff memory', 'borrowed upside',
    'the question is not finding toronto',
    'the family kept moving', 'the painted fans are long gone',
    'shared surnames do not establish', 'a zero-talent season',
    'the job is the bridge', 'a season-long entitlement',
    'a fascinating journey', 'a testament to', 'in the ever-evolving landscape',
)
DASHES = re.compile('[\u2010-\u2015]')


def copy_issues(text):
    issues = ['Unicode dash'] if DASHES.search(text) else []
    normalized = ' '.join(text.casefold().split())
    issues.extend('Rejected phrase: '+phrase for phrase in REJECTED_PHRASES if phrase in normalized)
    return issues


def validate_copy(text, location):
    issues = copy_issues(text)
    if issues:
        raise ValueError(location+': '+'; '.join(issues))


def validate_editorial_bundles(root=ROOT):
    count = 0
    for filename in BUNDLES:
        bundle = json.loads((root/filename).read_text())
        for item in bundle['items']:
            for field in COPY_FIELDS:
                if field in item:
                    validate_copy(item[field], filename+'/'+item.get('name', '')+'/'+field)
                    count += 1
    return count
