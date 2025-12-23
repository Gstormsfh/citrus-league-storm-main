#!/usr/bin/env python3
"""Search for TOI-related fields in the landing endpoint response."""

import json

with open("mcdavid_landing_response.json", "r", encoding="utf-8") as f:
    data = json.load(f)

def search_for_toi(obj, path="", depth=0, max_depth=5):
    """Recursively search for TOI-related fields."""
    if depth > max_depth:
        return
    
    if isinstance(obj, dict):
        for key, value in obj.items():
            current_path = f"{path}.{key}" if path else key
            # Check if key contains TOI-related terms
            if any(term in key.lower() for term in ['time', 'toi', 'ice', 'minutes']):
                print(f"Found TOI-related field: {current_path} = {value}")
            # Recurse
            if isinstance(value, (dict, list)):
                search_for_toi(value, current_path, depth + 1, max_depth)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            current_path = f"{path}[{i}]" if path else f"[{i}]"
            if isinstance(item, (dict, list)):
                search_for_toi(item, current_path, depth + 1, max_depth)

print("=" * 80)
print("SEARCHING FOR TOI IN LANDING ENDPOINT RESPONSE")
print("=" * 80)
print()

search_for_toi(data)

print()
print("=" * 80)
print("SUMMARY")
print("=" * 80)
print("If no TOI found above, the landing endpoint may not have season TOI totals.")
print("We'll need to use the gamecenter boxscore endpoint to sum per-game TOI.")
