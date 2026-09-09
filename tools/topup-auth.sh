#!/bin/zsh
# Second pass over the top-up list with account registration enabled. Several
# enterprise vendors (SuccessFactors, iCIMS, Taleo) show nothing but a
# create-account screen until you register, so the first pass cannot see their
# forms at all. Never submits an application.
cd /Users/jake/Projects/scrapeJobApplications
while pgrep -f "src/crawl.js --input data/topup-crawl.json" >/dev/null; do sleep 15; done
echo "=== first pass done, regrouping ==="
node tools/regroup.mjs
echo "=== authenticated retry ==="
AUTH=1 node src/crawl.js --input data/topup-crawl.json --browsers 6
echo "=== regroup + scoreboard ==="
node tools/regroup.mjs
node tools/scoreboard.mjs
