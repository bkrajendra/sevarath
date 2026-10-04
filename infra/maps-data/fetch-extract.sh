#!/bin/bash
# Fetches a real OpenStreetMap extract for the campus region (Shantivan, Abu Road,
# Rajasthan) via the public Overpass API. This is a reasonable bounding box around
# the public "Abu Road" location, NOT a precise surveyed campus boundary - refine
# with real coordinates once available (see docs/architecture.md §8.2).
#
# Output is gitignored (see .gitignore in this directory) - this script is the
# reproducible source of truth, not the data file itself.
set -euo pipefail

# left(minlon),bottom(minlat),right(maxlon),top(maxlat) - ~10km x 10km around Abu Road.
BBOX="72.73,24.43,72.83,24.53"
OUT="$(dirname "$0")/abu-road-extract.osm"

echo "Fetching OSM extract for bbox=$BBOX ..."
curl -sf \
  -H "Accept: */*" \
  -H "User-Agent: sevarath-maps-pipeline" \
  "https://overpass-api.de/api/map?bbox=${BBOX}" \
  -o "$OUT"

echo "Saved to $OUT ($(wc -c < "$OUT") bytes)"
echo "Sanity check - looking for 'Shantivan' in the extract:"
grep -ci "shantivan" "$OUT" || echo "  (not found - bbox may need adjusting)"
