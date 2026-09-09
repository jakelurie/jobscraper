// Candidate company names. Slug variants are derived from these and tested
// against every ATS board API, so spelling only has to be close.
export const COMPANIES = `
Airbnb Airtable Affirm Asana Atlassian Amplitude Anthropic Anduril Applied Intuition Arctic Wolf
Astranis Auth0 Automattic Aurora Avalara Benchling Betterment Bill Bitly Blend Block Bolt Box
Braze Brex Bumble Calendly Canva Carta Chainalysis Checkr Chime Cisco Meraki Clari Clearcover
Cloudflare Coalition Cockroach Labs Cohere Coinbase Confluent Contentful Coupa Credit Karma
Crowdstrike Cruise Databricks Datadog Dave Deel Descript Digital Ocean Discord Docker DoorDash
Doximity Drata Dropbox Duolingo Dutchie Ebay Elastic Envoy Equinix Etsy Everlaw Evernote Expel
Expensify Fanatics Faire Fastly Figma Fireblocks Fivetran Flexport Forter Front Fivestars
Gemini Gitlab Glassdoor Glean Gong Grafana Labs Grammarly Grow Therapy Gusto Handshake Harness
Hashicorp Headway Hims Hinge Health Honeybook Hopper Housecall Pro Hubspot Human Interest
Iterable Instacart Intercom Ironclad Jasper Jerry Jobber Justworks Kandji Kayak Klaviyo Kraken
Lattice Launch Darkly Lead IQ Lightmatter Linear Linkedin Lithic Loom Lucid Lyft Lyra Health
Mercury Miro Modern Health Modern Treasury Monte Carlo Motive Mozilla MongoDB Narvar Neo4j
Netlify Newfront Nextdoor Nerdwallet Notion Nuro Nylas Oatly Okta Olo Opendoor Openai Optimizely
Oscar Health Outreach Owner Pagerduty Palantir Panther Labs Papaya Global Paxos Peloton Pendo
Persona Pinterest Plaid Planet Labs PlanetScale Podium Postman Postscript Prefect Pulumi Quora
Quantcast Rakuten Ramp Rapid7 Reddit Redis Relativity Space Reltio Remitly Replit Retool Rippling
Riot Games Robinhood Roblox Rockset Roku Rula Samsara Sardine Scale AI Scribd Seatgeek Sentry
Shield AI ShipBob Sigma Computing Signifyd Skydio Slack Smartsheet Snyk Sofi Sonder Sourcegraph
Spotify Sprig Squarespace Stord Strava Stripe Stord Superhuman Sumo Logic Sword Health Synack
Talkdesk Tanium Tecton Temporal Tesla Thumbtack Tinder Toast Tomorrow Health Tremendous Trumid
Twilio Twitch Uber Unity Upstart Upwork Vanta Vercel Veeva Verkada Via Viam Vimeo Virta Health
Voleon Warby Parker Wealthfront Webflow Whatnot Whoop Wiz Workato Wonolo Xometry Yelp Yotpo
Zapier Zendesk Zscaler Zip Zocdoc Zoox Braintrust Clay Cresta Cursor Decagon Deepgram Distyl
Elevenlabs Etched Figure AI Fireworks AI Groq Harvey Hebbia Hume Imbue Inflection Kaggle Lambda
Langchain Luma AI Magic Mistral Modal Notable Health Nvidia Ollama Perplexity Physical Intelligence
Pika Pinecone Poolside Reflection AI Runway Sakana Scale Sierra Skild Snorkel Stability AI
Suno Synthesia Together AI Tome Twelve Labs Unstructured Weaviate World Labs Writer Zhipu
Addepar Alloy Alpaca Altruist Anrok Apollo Arcadia Arize Ascend Assembled Atomic Attentive
Baseten Beacon Bland Bounce Bridge Cadence Capsule Cedar Chainguard Clearwater Clipboard Health
Coactive Codeium Column Comulate Coram Corelight Cyera Deepnote Doppler Dosu Dune Elicit Ergeon
Fennel Finch Firework Flatfile Found Fountain Fudge Galileo Gamma Garner Gecko Genesys Getir
Grouparoo Guild Halcyon Handshake Hex Highnote Hightouch Honeycomb Included Health Instawork
Intero Jeeves Jump Kalshi Kentik Kiddom Knock Komodo Health Lago Level Lifted Lightdash Lithos
Loft Orbital Luminai Materialize Mercor Metabase Metronome Middesk Mixpanel Moody Motif Narrative
Neon Netradyne Nextroll Nomad Health Northbeam Nova Credit Nuvocargo Observe Ocrolus Odeko
Omada Health Openly Opsera Orum Osmind Ottimate Outschool Overjet Owner Pave Paytient Pendulum
Persado Petal Phaidra Pilot Placer AI Plate IQ Polymarket Prime Security Privacy Dynamics Prove
Quantum Metric Radar Rain Ravel Recharge Reforge Regrow Relyance Rescale Restaurant365 Rhino
Rockstar Games Roofstock Rula Runway Financial Salsify Sanas Sardine Savvy Scope AR Secureframe
Sema4 Semgrep Sensible Shef Shipwell Shortwave Sidecar Health Sift Simplebet Skyflow Slope
Snapdocs Socket Solugen Spectrum Labs Spekit Spring Health Sprinter Health Stellar Health Strider
Superblocks Supabase Sword Symbotic Synthego Tailscale Tanka Tavus Tekion Tenstorrent Terray
Thatch Thoropass Tigergraph Tinybird Tomorrow Torch Traba Tracer Transcarent Treasure Data
Trestle Truebill Trunk Twelve Unit21 Upguard Uplight Vannevar Labs Varonis Vast Data Vecna
Veho Vellum Vention Verax Veza Vic AI Vint Voltron Data Warp Watershed Weights Biases Windfall
Wing Wisq Workstream Wrapbook Writer Xero Xwing Yohana Zafin Zamp Zeta Zip Security Zuora
`.trim().split(/\s*\n\s*/).join(' ');

// Turns "Weights Biases" into ['weightsbiases','weights-biases','weights'].
export function slugVariants(name) {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set([words.join(''), words.join('-')]);
  if (words.length > 1) out.add(words[0]);
  return [...out].filter((s) => s.length > 2);
}

// The candidate list is built from 1- and 2-word groupings of the name blob,
// since we cannot know which words belong to the same company.
export function candidateSlugs() {
  const words = COMPANIES.split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i < words.length; i++) {
    for (const v of slugVariants(words[i])) out.add(v);
    if (i + 1 < words.length) for (const v of slugVariants(`${words[i]} ${words[i + 1]}`)) out.add(v);
  }
  return [...out];
}
