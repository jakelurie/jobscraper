# Application workspace: corpus readiness audit

Audited September 9, 2026. **Enough to begin an assisted prototype; not enough to claim complete automatic application support for all 13 platforms.** The previous 10/10 scoreboard measures retained captures, not completed workflows. Do not use it as a shipping gate.

## Scope and evidence

Read every retained JSON record for the 13 platforms at exactly ten records: 130 records, 2,098 extracted field entries. Checked all 130 referenced screenshot and HTML files exist, read PNG headers/dimensions, and hashed artifacts. All 130 PNGs are distinct byte sequences. That does not establish distinct form designs or complete field extraction. Reviewed extraction, capture, widget probing, screenshot, browser lifecycle, and persistence code. Visually inspected five representative screenshots: Ashby/OpenAI, Avature/MassMutual, Eightfold/Deere, Phenom/Cisco, Pinpoint/Arm. This was an offline audit, not 130 live fill tests or a visual review of every screenshot.

The repository contains 571 parseable form records and one malformed JSON file: `data/forms/teamtailor__doodle__value-consultant.json`. The existing retention rule selects 165 records across all platforms; 130 belong to the audited group. No originals were moved, reclassified, repaired, or deleted during this audit. The README was preserved.

Reproduce the inventory with `python3 tools/audit-readiness.py`. Record-level evidence, artifact paths/hashes, field counts, and audit classifications are in `docs/corpus-readiness-data.json`. Those classifications are offline assessments, not certifications. The script writes only that report under `docs/` and uses no network or browser.

## Platform findings

Every row has 10 retained records and 10 existing screenshot/HTML pairs. “Candidate” below means useful application-page evidence requiring live validation, not a certified complete form.

| Platform | What the ten records actually provide | First-pass implication |
|---|---|---|
| Ashby | 10 application candidates; 104 extracted field entries. OpenAI screenshot contains required yes/no questions and agreement controls absent from its nine-field JSON. | Strong visual reference; re-extract custom button choices and consent controls before filling. |
| Avature | 6 ManTech login/upload gates and 4 MassMutual listing/detail pages; only 30 field entries total. All vendor identities in `detectedPlatform` are custom domains; grouping relies on seed assumptions. | No demonstrated post-gate application in this retained set. Treat as manual-first and verify vendor identity. |
| Shopify | 10 candidates with custom questions; 126 entries. Some seed titles describe category pages rather than the actual applied-to role. | Usable reference; reconcile actual posting identity and full question text. |
| Wellfound | 10 combined application/account-registration pages; 100 entries, 20 unresolved widget selectors. | Account-aware assisted flow; cannot assume registration or submission has been validated. |
| Eightfold | 8 John Deere search/detail pages, 2 Netflix application candidates; 74 entries. Deere's resume-matching upload is not a job application. | Only two retained application candidates support this family; reject listing-page false positives. |
| Greenhouse | 10 application candidates; 234 entries, 10 unprobed country-picker fields. | Good initial implementation target; distinguish attachments and verify custom dropdowns. |
| Jane Street | 10 candidates; 160 entries, all sharing one label signature; 30 `none-observed` option sources. | Useful common template, not ten different mechanics. Reinspect selects instead of treating no observed options as plain text. |
| Lever | 10 candidates; 286 entries, ten label signatures. | Good initial implementation target; still no saved evidence of successfully filling and validating all required fields. |
| Meta | 10 candidates; 376 entries. Resume upload mislabelled with a location in the inspected JSON; group and child controls both appear. | Useful reference; resolve radio/checkbox grouping, upload labels, and live selected values. |
| Phenom | 10 Cisco first-step captures; 180 entries, one label signature. Screenshot shows six steps through Review, but `multiStep` is false and no subsequent steps were captured. | First-step information only. Must implement and validate experience, questions, disclosures, and review traversal. |
| Pinpoint | 7 application candidates, 3 speculative “Register Your Interest” forms; 141 entries. Some records contain placeholder-style questions. | Separate talent pools from applications; verify employer provenance rather than trusting tenant slugs. |
| Teamtailor | 10 candidates; 136 entries, 10 unprobed country pickers. Includes sales/product roles and an explicitly Remote Europe title. | Useful UI diversity; not a clean US senior-SWE jobs list. |
| Workday | 10 first-step captures; 151 entries. All have a multi-step flag, zero additional steps saved. | Initial information page only; later wizard steps and readiness cannot be inferred. |

## Material gaps to carry into implementation

1. **No demonstrated end-to-end preparation.** None of the 130 records contains a saved additional step. Workday and Phenom explicitly need them. Conditional questions, repeatable work/education histories, resume parsing results, server validation, session expiry, and a genuine final-review state remain unverified. A tall screenshot covers the current rendered page, not unseen steps.
2. **Field extraction is incomplete even on visible forms.** There are 22 unlabeled entries. Every extracted entry has a selector and fill action, but that only describes fields the extractor found. It omits visible controls in the Ashby example. Selectors can be stale, ambiguous, or point at nested duplicate controls. Some question text is truncated to 200 characters; labels cannot serve as the full legal/question text.
3. **Widget recipes are observations, not tested fill routines.** Across these 130 records: 77 `none-observed`, 30 `country-picker-unprobed`, 20 `unresolved-selector`, 1 `unknown`. Another 61 entries report `network-on-type`; the probe uses broad request matching and fixed delays, which do not establish causality or successful selection. The 1,199 null/unspecified option sources include ordinary inputs and are not all errors. Read back committed values after every actual fill.
4. **Job inventory is not ready for salary/company filtering without enrichment.** Capture records do not provide a normalized offered-compensation schema. Desired salary in an application is not the job's pay. 98/130 seed locations are empty. The retained set includes non-SWE roles, speculative forms, foreign postings, and seed/page title mismatches. “Not flagged nonUS” does not mean verified US eligibility; Americas/Europe/unknown must not silently become US-only. A detected branded site is not proof of employer ownership or underlying ATS.
5. **Research machinery is not the product runtime.** `src/browser.js` closes each page when a task ends; it does not retain paused sessions for a user. The app needs durable state, browser ownership, a question queue, takeover, resumption, and a separate explicit-submit executor. Existing throwaway registration identities and saved research credentials must never become the user's candidate profile.
6. **Known code risks to address before reuse.** `src/fingerprint.js` maps every file input to resume. `src/capture.js` selects the first non-placeholder locale/consent option in a pre-form gate; the app must use the user's actual choice. Capture IDs use truncated company/title text and still permit collisions. Async record writes in `src/crawl.js` are not awaited before rebuilding its aggregate. `shot.coversAllFields` is a geometry heuristic and does not require `shot.ok`; it is not screenshot or completion certification. Richest-frame selection is not complete multi-frame extraction.

## Recommended first pass

Build the organizer, candidate profile, live session manager, question inbox, and review queue now. Start tested automatic preparation with Greenhouse and Lever; add Ashby once custom choice extraction is corrected, then the other application candidates. Expose all 13 families in a capability matrix with honest per-flow statuses: fixture-tested, live-assisted, manual-required, or unsupported. Avature and uncaptured later wizard steps are manual-first until independently demonstrated.

Use this corpus as reference fixtures and regression cases. Runtime decisions must come from the current page, trusted candidate facts, and user answers. “Ready for review” requires evidence that the selected job's actual final application state has been reached; a blocked first step belongs in the question/manual queue instead. No more arbitrary capture-count chasing is required to begin this bounded product.

The implementation handoff is `docs/APPLICATION_WORKSPACE_HANDOFF.md`. Its initial acceptance tests deliberately include the failures discovered here. No real applications were submitted, accounts created, or websites contacted in this audit.
