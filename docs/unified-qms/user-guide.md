# Administrator and shop-floor guide

## Accounts and permissions

In Admin → Users, a system administrator can create a local account, assign reviewed internal roles and hand its initial password to the user through PDI's normal secure process. Local provisioning does not send email. The normal password-reset flow uses the configured delivery channel; migration does not manufacture passwords or send reset notices automatically. Disable duplicate/stale accounts only after reviewing ownership and record links.

Migrated supported bcrypt passwords continue to work and upgrade on first successful login. Unsupported/missing credentials or passwords exceeding bcrypt's byte boundary need a controlled reset. Do not copy browser sessions or tokens. Quality Manager has operational quality authority, not user administration. Existing customized SQMS roles must be explicitly reviewed for new inspection/test-lab grants.

## Plans and specifications

Inspection → Plans installs current source defaults as drafts. Quality reviews the required forms and releases revisions. Released definitions cannot be edited; “Revise/customize” creates a new draft revision. The builder supports the source checklist, visual, dimensional, general measurement, bore, fire-ring, groove, valve and vacuum sections and custom/miscellaneous plans. Review cylinder/bore counts, item IDs, units and requirements before release.

On a product page, record permanent physical features and reviewed revision mappings. A drawing balloon is an alias, not a permanent identity. Choose a stable feature when defining FAI/inspection characteristics. Use UNCERTAIN until Engineering has established that cross-revision measurements are comparable. Reused balloons for different features must have different feature IDs.

The product page also edits part-specific inspection specifications. New inspections freeze those settings. Existing inspections retain their original snapshot. Use the plan page for scanned XLSX/CSV catalog preview/import and download; identifier columns must be text so leading zeros survive. Catalog commit requires both plan-management and product-write authority. No purchasing/ERP synchronization is automatic.

## Incoming inspection

Create an inspection from a released plan. Select the approval for the exact supplier-product/site/configuration where known. Record PO, receiving date and item count. If approval/supplier identity is unresolved, preserve the original text and enter the reason; that warning is not a material-release authorization.

Receiving is completed once for the receipt. Switch item tabs to record serials, measurements, findings and disposition for each item. Save regularly. Upload row evidence using the row attachment action and general item evidence in the item-evidence field. Files remain quarantined until scanning completes. Failed/accepted checklist findings require notes and their own row photo. Failed/accepted item dispositions also need notes and item evidence. A failed measurement cannot support a PASS item disposition.

Complete when every applicable measurement and item disposition is recorded. FAIL/ACCEPTED completion creates a Quality alert; acknowledge the alert after review. Completion protects answers and evidence. Quality Manager can reopen with a reason, preserving prior completion/measurement history. Review assignment, queue search/status filters, related defects and imported notes/activity from the same screen.

“Raise NCR” saves current answers and copies failed source results/items, supplier/part/site/revision, PO, lot and serial context into the unified NCR. Choose classification and affected quantity. Use the returned NCR link; retrying a failed/lost request does not create a second record. Inspection completion alone does not disposition the NCR or release material.

Incoming → Reports provides custom date/status/disposition/plan grouping, saved report filters, summary PDF and detailed Excel. Dates are explicitly based on inspection creation in UTC; injector reports use shop-calendar test days. Saved configurations belong to their creator.

## NCRs and recurrence

The NCR page combines containment/disposition controls with report narrative, ordered sections, captioned photos, PDF and direct source links. Draft section removal archives the section so prior evidence remains traceable. Dispositioned/closed evidence is controlled. Legacy exceptions preserve missing historical approval evidence; they do not grant a policy bypass to new records.

Quality signals show historical candidates, human-confirmed recurrence and dismissed candidates with reasons. Review the current/prior specifications, values, origin, closed state, revision compatibility and previous SCAR/effectiveness record. A possible match is not proof of recurrence or failed corrective action. Engineering must resolve incompatible/uncertain feature mappings before confirmation. The lookback window is administered through Settings → `qms.recurrence.lookbackDays`.

From the source FAI or incoming record, create a linked NCR rather than retyping its evidence. Add reviewed defect lines if the initial description is unclassified. Closed legacy classifications require Quality disposition authority and a reason; the historical disposition is retained. Existing SCARs can cover multiple NCRs through reviewed links. Raising/issuing a SCAR, material hold/release, concession, approval change and requalification require their normal human authorization.

Supplier pages provide consolidated history including qualification attempts/FAIs, product approvals, incoming inspections, closed NCRs, SCARs and changes. Product pages retain supplier-product/site/revision links. Unattributed records remain accessible but are not counted as a particular supplier's performance.

## Injector tests and repairs

Test Lab → Injector Tests imports recorded CarbonZapp response arrays in the isolated environment. Reporting transport is available only when separately configured as test-safe/live. Synchronization deduplicates by report/slot, retains DNF, applies source green acceptance bands, and excludes R-prefixed bench reruns/RMA jobs from the operational list. It does not change bench settings or delete permanent history.

Select tests in the desired report-column order. Preview measured values/specification bands/outcomes, choose comparison/shipment PDF or Excel, and supply the report heading. A released PDI-IQI-012 plan enables “Create inspection from selection.” The resulting draft has per-item source values/serials and provenance; review receiving, findings, failure evidence and unresolved supplier/approval context before completion.

Open a failure repair case or use Quick Entry for the six standard before/after pairs. Record date, units and measurements. Repairs belong to a physical injector; shortened serials are matched only when unambiguous for that part. Quick Entry can link the prior unsuccessful retest and record the next repair atomically. Repair History records diagnosis, hypothesis, expected/observed outcome and component changes, then links a later retest. Held/scrapped cases require authorized reopening before retest review. Different units/specifications are flagged incomparable; a missing test is not assumed to prove effectiveness. A passing case is permanent; a later failure starts a new episode.

Analytics exposes test/repair cohorts, trends, DNF/unknown denominators, attempts to pass and observed adjustment associations, with definitions and an Excel evidence workbook. Associations do not establish causality.

Daily export previews/downloads passed-test rows using Mountain time and explicit PDI aliases. Delivery is disabled during this project. Test-sink can exercise the outbox without network requests. Configure a Google destination only as a reviewed release action, reconcile old sent days, and use a dedicated tab with the delivery-ID column. Delivery retry is for failed outbox delivery, not a way to blindly resend completed days.
