"""Read-only corpus audit; writes reports only under docs/. No browser/network use."""
import collections, hashlib, json, pathlib, struct
ROOT = pathlib.Path(__file__).resolve().parents[1]
records, invalid = [], []
for path in sorted((ROOT / 'data/forms').glob('*.json')):
    try:
        r = json.loads(path.read_text())
        if not isinstance(r, dict): raise ValueError('record is not an object')
        r['_source'] = str(path.relative_to(ROOT))
        records.append(r)
    except (ValueError, OSError) as e:
        invalid.append({'path': str(path.relative_to(ROOT)), 'error': str(e)[:180]})
kept = [r for r in records if r.get('isApplicationForm') and not any(r.get(k) for k in ('nonUS', 'overCap', 'duplicateOfSameForm'))]
groups = collections.defaultdict(list)
for r in kept: groups[r['platform']].append(r)
report = {'scope': 'Retained records in platforms with exactly 10 records; original retention flags are not certification.', 'parsedRecords': len(records), 'invalidRecords': invalid, 'retainedAllPlatforms': len(kept), 'platforms': []}
for platform, rows in sorted(groups.items()):
    if len(rows) != 10: continue
    details = []
    for r in rows:
        fields = r.get('fields', [])
        artifacts = {}
        for kind in ('screenshot', 'html'):
            name = r.get('artifacts', {}).get(kind)
            path = ROOT / name if name else None
            artifact = {'path': name, 'exists': bool(path and path.is_file())}
            if artifact['exists']:
                raw = path.read_bytes()
                artifact.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
                if kind == 'screenshot' and raw[:8] == b'\x89PNG\r\n\x1a\n':
                    artifact['width'], artifact['height'] = struct.unpack('>II', raw[16:24])
            artifacts[kind] = artifact
        url = r.get('finalUrl', '')
        labels = [f.get('label', '') for f in fields]
        kind = 'application_candidate_requires_live_validation'
        if 'register-your-interest' in url: kind = 'talent_interest_form'
        elif platform == 'avature':
            kind = 'login_upload_gate' if 'ApplicationMethods' in url else 'listing_or_job_detail'
        elif platform == 'eightfold' and 'Search for job title or keywords' in labels: kind = 'listing_or_job_detail'
        elif platform in ('workday', 'phenom'): kind = 'first_wizard_step_only'
        elif platform == 'custom:wellfound.com': kind = 'application_with_account_registration'
        options = collections.Counter(f.get('fill', {}).get('optionsFrom') or 'not_applicable_or_unspecified' for f in fields)
        details.append({'record': r['_source'], 'title': r.get('seed', {}).get('title'), 'location': r.get('seed', {}).get('location'), 'pageTitle': r.get('pageTitle'), 'observedKind': kind, 'fields': len(fields), 'unlabeled': sum(not f.get('label') for f in fields), 'missingSelectors': sum(not f.get('selector') for f in fields), 'missingFillActions': sum(not f.get('fill', {}).get('action') for f in fields), 'optionsSources': dict(options), 'additionalSteps': len(r.get('steps', [])), 'multiStepFlag': bool(r.get('signals', {}).get('multiStep')), 'labelSignature': r.get('fingerprint', {}).get('labelSig'), 'artifacts': artifacts})
    report['platforms'].append({'platform': platform, 'retained': len(rows), 'fieldTotal': sum(d['fields'] for d in details), 'kinds': dict(collections.Counter(d['observedKind'] for d in details)), 'records': details})
(ROOT / 'docs/corpus-readiness-data.json').write_text(json.dumps(report, indent=2) + '\n')
print('Parsed:', len(records), 'Invalid:', len(invalid), 'Audited:', sum(p['retained'] for p in report['platforms']))
for p in report['platforms']: print(p['platform'], p['kinds'])
