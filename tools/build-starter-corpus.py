"""Build a bounded offline reference set. Original captures remain untouched."""
import collections, hashlib, json, pathlib, re, shutil
from urllib.parse import urlsplit, parse_qs
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/starter-corpus'
PLATFORMS = {'lever','greenhouse','ashby','meta','janestreet','eightfold','rippling','custom:wellfound.com'}
SENIOR = re.compile(r'\b(senior|staff|principal|lead|leadership|iii)\b',re.I)
ENGINEER = re.compile(r'\b(engineer|developer)\b',re.I)
EXCLUDE = re.compile(r'fluid|thermal|analytics engineer|security operations',re.I)
US = re.compile(r'\b(United States|USA|US|U\.S\.|New York|San Francisco|Seattle|Bellevue|Foster City|Redwood City|Denver|Golden, CO|Palo Alto|Alabama)\b',re.I)
FOREIGN = re.compile(r'\b(Europe|European|MX|Remoto)\b',re.I)
NOTES = {
 'lever':'Verify live selectors, conditional questions, uploads and committed option values.',
 'greenhouse':'Reinspect country/phone widgets; distinguish resume and cover-letter uploads.',
 'ashby':'Required yes/no button choices can be absent from JSON. Re-extract from live page and compare screenshot.',
 'meta':'Reconcile group/child controls and resume labels; verify conditional disclosures.',
 'janestreet':'Dropdown probes were inconclusive. Resolve and verify live options.',
 'eightfold':'Only Netflix application pages included; verify options and unlabeled uploads.',
 'rippling':'Verify document labels and final Apply action; never execute it during preparation.',
 'custom:wellfound.com':'Application includes registration; unresolved selectors require live repair and authorized account handling.'}
def identity(r):
 u=urlsplit(r['finalUrl']); q=parse_qs(u.query)
 return u.netloc.lower()+u.path.rstrip('/')+('?'+'&'.join(k+'='+q[k][0] for k in ('pid','jobId') if k in q) if any(k in q for k in ('pid','jobId')) else '')
def valid_route(r):
 u=r['finalUrl']; p=r['platform']
 return {'lever':'jobs.lever.co/' in u and '/apply' in u,'ashby':'jobs.ashbyhq.com/' in u and '/application' in u,'greenhouse':bool(re.search(r'/jobs/\d+|/careers/apply/|gh_jid=\d+',u)),'meta':'/create_application/' in u,'janestreet':'/join-jane-street/apply/' in u,'eightfold':'explore.jobs.netflix.net/careers/apply?' in u,'rippling':'ats.rippling.com/rippling/jobs/' in u and '/apply?' in u,'custom:wellfound.com':'wellfound.com/jobs/' in u and 'autoOpenApplication=true' in u}[p]
rows=[]; rejected=[]; seen=set()
for src in sorted((ROOT/'data/forms').glob('*.json')):
 try:r=json.loads(src.read_text())
 except (ValueError,OSError):
  rejected.append({'source':str(src.relative_to(ROOT)),'reason':'invalid JSON'});continue
 p=r.get('platform'); s=r.get('seed',{}); title=s.get('title',''); reason=None
 if p not in PLATFORMS:reason='outside initial platform allowlist (includes gates, partial wizards and uncertain provenance)'
 elif not r.get('isApplicationForm') or r.get('blocked'):reason='application not reached or blocked'
 elif r.get('nonUS') or FOREIGN.search(s.get('location','')):reason='recorded non-US location'
 elif not SENIOR.search(title) or not ENGINEER.search(title) or EXCLUDE.search(title):reason='outside explicit senior software/platform/security engineering title scope'
 elif not valid_route(r):reason='not a recognized posting-specific application route'
 elif not any(re.search(r'\bsubmit\b|^Apply$',b,re.I) for b in r.get('buttons',[])):reason='no final application action recorded'
 elif not any(f.get('type')=='file' for f in r.get('fields',[])) or not any(re.search('email|e-mail',f.get('label',''),re.I) for f in r.get('fields',[])):reason='missing application contact/upload evidence'
 elif not all((ROOT/r.get('artifacts',{}).get(k,'__missing')).is_file() for k in ('screenshot','html')):reason='missing artifact'
 elif identity(r) in seen:reason='duplicate posting identity'
 if reason:
  rejected.append({'source':str(src.relative_to(ROOT)),'reason':reason});continue
 seen.add(identity(r)); rows.append((src,r))
OUT.mkdir(parents=True,exist_ok=True)
manifest=[]
for src,r in rows:
 key=hashlib.sha256(identity(r).encode()).hexdigest()[:16]
 group=r['platform'].replace('custom:','').replace('.com','').replace('.','-')
 dest=OUT/'jobs'/group/key;dest.mkdir(parents=True,exist_ok=True)
 files={}; hashes={}
 for kind,name in [('screenshot','screenshot.png'),('html','page.html')]:
  shutil.copyfile(ROOT/r['artifacts'][kind],dest/name)
  files[kind]=str((dest/name).relative_to(OUT));hashes[kind]=hashlib.sha256((dest/name).read_bytes()).hexdigest()
 copy=json.loads(json.dumps(r));copy['artifacts']=files
 copy['starterProvenance']={'sourceRecord':str(src.relative_to(ROOT)),'originalArtifacts':r['artifacts'],'originalRecordSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'note':'Artifact paths relative to starter-corpus root. Original retention flags are historical; use manifest membership.'}
 (dest/'record.json').write_text(json.dumps(copy,indent=2)+'\n')
 files['record']=str((dest/'record.json').relative_to(OUT));hashes['record']=hashlib.sha256((dest/'record.json').read_bytes()).hexdigest()
 seed=r['seed']; loc=seed.get('location','')
 evidence=loc or (seed.get('title','')+' '+r.get('pageTitle',''))
 us=bool(US.search(evidence))
 company=seed.get('company','')
 if r['platform']=='custom:wellfound.com':
  m=re.search(r' at (.*?) (?:•|$)',r.get('pageTitle',''))
  if m:company=m[1]
 manifest.append({'id':key,'platform':r['platform'],'company':company,'title':seed['title'],'locationOriginal':loc or None,'usEligibility':'US-location-evidence-in-capture' if us else 'unknown','locationEvidence':evidence if us else loc or None,'seniorityEvidence':seed['title'],'canonicalPostingIdentity':identity(r),'jobUrl':seed.get('jobUrl'),'applicationUrl':r['finalUrl'],'sourceRecord':str(src.relative_to(ROOT)),'files':files,'sha256':hashes,'fieldCount':len(r.get('fields',[])),'scope':'assisted implementation reference','liveAvailability':'not reverified','endToEndFillValidated':False,'limitations':NOTES[r['platform']]})
counts=dict(sorted(collections.Counter(x['platform'] for x in manifest).items()))
report={'schemaVersion':1,'curatedOn':'2026-09-09','count':len(manifest),'platformCounts':counts,'artifactPathsRelativeTo':'data/starter-corpus/','selection':'Explicit senior engineering titles, posting-specific application routes, contact/upload/submit evidence, saved HTML and PNG. Known foreign locations, unrelated jobs, gates, partial wizards, interest forms and uncertain tenants excluded. Unknown US eligibility retained as reference only. No per-platform quota; historical overCap flags ignored. Distinct jobs may share a form design.','jobs':manifest}
(OUT/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
(OUT/'selection-log.json').write_text(json.dumps({'excluded':rejected},indent=2)+'\n')
lines=['# Starter application corpus','',f'{len(manifest)} distinct senior engineering application references across {len(counts)} platform families. This folder is the sole initial dataset for the implementation handoff.','', 'These are credible application-page examples for assisted development, not certified autofill recipes or a verified live jobs feed. Each includes extracted fields, the original HTML and a screenshot. Unknown geography stays unknown; revalidate US eligibility and availability before applying.','', '## Contents','', '- `manifest.json`: authoritative membership, job URLs, evidence, limitations, artifact paths and SHA-256 hashes. Paths are relative to this folder.', '- `jobs/<platform>/<id>/`: `record.json`, `screenshot.png`, `page.html` for each posting.', '- `selection-log.json`: excluded source records and reasons.', '', '## Coverage','', '| Platform | Jobs |','|---|---:|']
lines += [f'| {p} | {n} |' for p,n in counts.items()]
lines += ['',f"US location evidence in capture: {sum(x['usEligibility']!='unknown' for x in manifest)}. US eligibility unknown: {sum(x['usEligibility']=='unknown' for x in manifest)}. A location mention does not establish hiring eligibility.",'','## Use','', 'Import only manifest members. Begin with Lever and Greenhouse; repair Ashby custom choice extraction. The remaining families require assisted widget/account handling documented per job. All records still require live field verification. Do not treat screenshots as proof that all conditional steps are captured.','', 'Raw HTML is untrusted reference material: do not serve it as executable app content. No identity/profile folders are included. Original captures remain unchanged.','', 'Rebuild from repository root: `python3 tools/build-starter-corpus.py`. Historical overCap flags are ignored because this set selects distinct jobs without padding or a per-platform quota.','', '## Job index','']
lines += [f"- [{x['company']} — {x['title']}]({x['files']['record']}) · [screenshot]({x['files']['screenshot']}) · {x['usEligibility']}" for x in manifest]
(OUT/'README.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'count':len(manifest),'platforms':counts,'unknownUS':sum(x['usEligibility']=='unknown' for x in manifest)},indent=2))
