#!/usr/bin/env bash
# Aggregate unique visitors from the nginx access log — no tracking code anywhere
# in the app; nginx already records (IP, time, URL) for every request.
#
# Usage (on the VPS):
#   ./deploy/visitors.sh                      # per-day table from the default log
#   ./deploy/visitors.sh /var/log/nginx/amazoncalculate.access.log
#   ./deploy/visitors.sh | tail -7            # last week
set -euo pipefail

LOG="${1:-/var/log/nginx/amazoncalculate.access.log}"
if [ ! -r "$LOG" ]; then
  echo "cannot read $LOG — pass the log path as the first argument" >&2
  exit 1
fi

echo "Per-day unique visitors (by IP):"
awk '
  { date = substr($4, 2, 11); ip = $1; seen[date SUBSEP ip] = 1 }
  END {
    for (key in seen) {
      split(key, parts, SUBSEP)
      count[parts[1]]++
      total[parts[2]] = 1
    }
    # date is dd/Mon/yyyy — sort by year, then month NAME (-k2M), then day
    for (d in count) print d, count[d] | "sort -t/ -k3,3n -k2,2M -k1,1n"
    close("sort")
    uniq = 0
    for (ip in total) uniq++
    printf "TOTAL unique IPs (all time in this log): %d\n", uniq
  }
' "$LOG"
