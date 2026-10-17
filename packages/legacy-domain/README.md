# Preserved QMS domain functions

Source: A-PDI/QMS-Development at `6c53d829a5e69ff095975cddc41d419c4b812ada`. `provenance.json` records original hashes. PDF renderers, injector calculations, serial identity, filters, exports and tests are reused. CarbonZapp/report adapters contain only parsing and rendering functions: SQLite, app startup, live bench transport, settings, credentials and Express routes are excluded. Nest services own authentication, persistence and authorization. No standalone legacy server is started.

Original hashes describe the inspected source, not a byte-identical port. The inspection PDF header intentionally preserves the full original part identifier, including leading zeros and punctuation; its former numeric-only display could change meaningful identifiers. New adapters and paths use the SQMS services and managed evidence described in the feature matrix. The source calculation and PDF regressions run alongside tests for these adaptations.
