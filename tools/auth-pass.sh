#!/bin/zsh
# Waits for the open crawl to finish, then retries everything that hit a wall
# with account registration enabled. Never submits an application.
cd /Users/jake/Projects/scrapeJobApplications
while pgrep -f "src/crawl.js --browsers" >/dev/null; do sleep 20; done
echo "=== main crawl done, building walled list ==="
node tools/walled-targets.mjs
echo "=== auth pass starting ==="
AUTH=1 node src/crawl.js --input data/walled-targets.json --browsers 5 --force
