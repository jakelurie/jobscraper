#!/bin/zsh
# Retries whatever the US pass could not reach, with account registration on.
# SuccessFactors and iCIMS render nothing until you have an account, so their
# forms are invisible without it. Never submits an application.
cd /Users/jake/Projects/scrapeJobApplications
while pgrep -f "src/crawl.js --input data/us-crawl.json" >/dev/null; do sleep 15; done
node tools/regroup.mjs
echo "=== authenticated retry ==="
AUTH=1 node src/crawl.js --input data/us-crawl.json --browsers 6
node tools/regroup.mjs
node tools/scoreboard.mjs
