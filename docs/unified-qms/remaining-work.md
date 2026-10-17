# Remaining work and release gates

> Latest October 17 direction: use SQMS navigation/organization and the QMS-Development theme, while preserving the operational workflows. See [navigation and theme](navigation-theme.md), [reference preservation](feature-preservation.md) and [source parity](source-parity.md). Earlier “implemented” labels are code availability, not proof of operator or historical-data parity.

The immediate release task is a walkthrough of every used original workflow against the copied operational database and uploads. Include populated custom/miscellaneous forms, all used inspection types, report/PDF samples, drawing versions, bench full-resync/clear and repair episodes, role restrictions, concurrent edits and performance at operational volume. The source port and synthetic checks do not replace that acceptance.


## External acceptance blockers

| Gate | Current evidence | Required next input/action | Release effect |
| --- | --- | --- | --- |
| Copied operational database and matching uploads/drawings | Not supplied; user confirmed copies have not been created | Operational owner supplies a consistent standalone backup, upload manifest/copy, source timezone and backup/restore evidence | Full user/template/custom/NCR/repair/file inventory, complete reconciliation and operational PDF parity remain unverified |
| SQMS Render test service identity | User supplied `https://sqms-gateway.onrender.com` and reports it is running. Platform service IDs are unconfirmed; no Render connector/service credentials are available in this session | Record the exact gateway/API/worker/database/storage/Redis/scanner service IDs, branch, region, environment and durable disks; verify this is the UI-test deployment | This correction has not been deployed remotely or accepted on Render |
| PDI form register and actual branded templates | Source code/PDI PDF assets are available; the external register/fillable forms are not | Document-control owner confirms code-to-record/upload mapping and drawing classification; compare actual issued forms | No invented mappings or blanket reconstruction of the 37 catalog entries |
| Historical attribution and identity decisions | Repository fixtures deliberately contain unknown suppliers | Reviewed PO/vendor/account/part/feature/timezone mappings against the real copy | Unknown supplier/history stays labeled and outside supplier-specific metrics |
| Operator acceptance | Automated fixtures exercise representative workflows | Inspectors, Test Lab, Quality and Engineering execute the matrix on copied history and confirm all forms/outputs used operationally | Complete replacement remains a candidate until accepted |
| Complete Docker image build | Host builds pass; clean image dependency-layer preparation exhausted this workspace's disk | Build the API, worker and web images on a build host with sufficient free disk, then run container health/persistence checks | Container and Render acceptance remain open |

## Controlled release configuration

Select and record operators for MySQL, backups, Redis, object storage, scanning and email. Confirm retention with the business; do not assert ISO certification/compliance from this implementation. Portal remains disabled. Bench reads and Google delivery need separately configured, reviewed destinations/credentials; recorded/mock tests are not evidence of live connectivity. Do not carry legacy secrets into ordinary settings. Review existing customized SQMS role grants and safe branding/settings explicitly.

Before enabling the new daily export, reconcile days already sent by the old system, confirm explicit part aliases and use a dedicated tab with the delivery-ID column. Late-arriving source reports require reviewed sheet reconciliation, not a blind resend of completed days. Render backup/restore and persistence must be demonstrated on the confirmed deployment.

## Validation status

Actual commands/results are recorded in [validation.md](validation.md). Any failing local check must be fixed before local acceptance; absence of operational resources must remain an explicit gate rather than a passing fixture claim. Keep the feature matrix current for newly discovered source behavior. Baseline operational source remains unchanged throughout.

## Deferred by assignment

Entra/SSO, supplier portal activation/MFA rollout, automated ERP/purchasing sync, full CAPA, gauge/calibration management and speculative analytics expansion are future work. PPAP/PSW/AS9102 are conditional on customer/business requirements. They are not added as blanket gates to existing internal workflows.
