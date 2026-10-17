'use strict';
// Pure conversion functions ported from QMS 6c53d82; persistence belongs to SQMS.
const { isFlushStep, stepLabel, stepResultValue, stepErrorInfo } = require('./injectorSteps');
const { measurementOutcome } = require('./injectorResult');
function buildDimensionalFromTests(tests) {
  const items = [];
  const answers = [];
  let id = 0;

  for (const t of tests) {
    if (isFlushStep(t)) continue;        // internal bench diagnostic, not a test point
    if (!t.primary) continue;            // no measurable result (skipped steps)

    id += 1;
    const p = t.primary;
    // Show the flow spec (green band) only; do NOT append bench conditions here
    // — the user asked for Specification = flow spec only.
    const spec = p.spec || '';
    // Dimensional status uses the shared P/F/A code so it renders in the app
    // (PFNToggle) and PDF (statusToGlyph) identically. '' when not scored.
    const primaryOutcome = measurementOutcome(t, p);
    const statusVal = primaryOutcome === 'fail' ? 'F' : (primaryOutcome === 'pass' ? 'P' : '');
    const err = stepErrorInfo(t);
    // ALWAYS the mapped test-step name — a bench error never renames a step.
    const primaryLabel = stepLabel(t, 'primary', p.tank_name) || `Step ${id}`;

    items.push({
      id,
      measurement: primaryLabel,
      spec,
    });
    answers.push({
      id,
      // Persist the spec on the answer row too so it is visible in the app view
      // (the client reads row.spec; without this the Spec/Limit column is blank).
      spec,
      // Measured average, or "Error: <description>" when the step errored.
      actual1: stepResultValue(t, p),
      status: statusVal,
      __unit: p.unit || '',
      __error: err.errored ? err.description : '',
    });

    // Secondary tank (if any) gets its own row.
    if (t.secondary) {
      id += 1;
      const s = t.secondary;
      const secondaryOutcome = measurementOutcome(t, s);
      const sStatusVal = secondaryOutcome === 'fail' ? 'F' : (secondaryOutcome === 'pass' ? 'P' : '');
      // The secondary tank either has its own name ("Inductance") or reuses the
      // step name with a tank suffix ("Peak HP [R]"). Only when neither applies
      // do we disambiguate with the raw tank name.
      const secondaryLabel = stepLabel(t, 'secondary', s.tank_name);
      items.push({
        id,
        measurement: secondaryLabel === primaryLabel
          ? `${secondaryLabel} — ${s.tank_name || 'Secondary'}`
          : secondaryLabel,
        spec: s.spec || '',
      });
      answers.push({
        id,
        spec: s.spec || '',
        actual1: stepResultValue(t, s),
        status: sStatusVal,
        __unit: s.unit || '',
        __error: err.errored ? err.description : '',
      });
    }
  }

  return { items, answers };
}

// Normalised test steps for an injector row (from live sync or DB report_json).
function testsFor(inj) {
  if (Array.isArray(inj.tests)) return inj.tests;
  if (inj.report_json) {
    const rj = typeof inj.report_json === 'string'
      ? safeParse(inj.report_json)
      : inj.report_json;
    if (rj && Array.isArray(rj.tests)) return rj.tests;
  }
  return [];
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/**
 * Build the per-item section_data (checklists + dimensional) for one injector.
 * Receiving & Visual auto-pass when the injector passed all flow tests.
 */
function buildItemForInjector(inj, templateSections) {
  const tests = testsFor(inj);
  const { answers } = buildDimensionalFromTests(tests);

  const passed = inj.overall_pass === 1;
  const failed = inj.overall_pass === 0;

  // VISUAL / quality checklist (pass_fail_checklist): auto-marked PASS when the
  // injector passed every flow test, left OPEN when it failed so a QC reviewer
  // must inspect a failing injector. (Section A is inspection-level — see
  // buildSharedSections below.)
  const visualResult = passed ? 'P' : '';
  // The serial number ties this item's test results and images to the injector.
  const item = { __serial_no: inj.serial_number || '' };

  for (const [key, section] of Object.entries(templateSections)) {
    if (key === 'dimensional') continue;              // handled below
    if (isInspectionLevelSection(key, section)) continue; // answered once, shared
    const srcItems = Array.isArray(section.items) ? section.items : [];
    if (section.section_type === 'pass_fail_checklist') {
      // Visual checklist (SectionChecklist.jsx / PDF) reads `result`.
      item[key] = srcItems.map((it) => ({ id: it.id, result: visualResult, status: visualResult, notes: '', finding: '' }));
    }
  }

  item.dimensional = answers;
  // Disposition uses the app's UPPERCASE codes (PASS / FAIL) so badges, the
  // detail view, and the PDF all colour + label it consistently.
  item.__disposition = inj.overall_pass == null ? '' : (failed ? 'FAIL' : 'PASS');
  item.__disposition_notes = '';
  return item;
}

/**
 * True for a section answered once per inspection (Section A — Receiving &
 * Documentation Verification). Mirrors client/src/lib/sections.js.
 */
function isInspectionLevelSection(key, section) {
  return String(key || '').toLowerCase() === 'receiving' ||
    String((section && section.title) || '').toUpperCase().includes('RECEIVING');
}

/**
 * The inspection-level answers for a report: Section A (carton condition,
 * labels, part marking, quantity, corrosion protection) checks the delivery, so
 * it is filled in once and always auto-marked PASS — those checks are
 * independent of how the injectors performed on the bench.
 *
 * IMPORTANT: the pfn_checklist renderer (SectionReceiving.jsx) and the PDF read
 * the value from `status` (NOT `result`, which is what the pass_fail_checklist
 * renderer uses). Populate BOTH so the mark shows up either way.
 */
function buildSharedSections(templateSections) {
  const shared = {};
  for (const [key, section] of Object.entries(templateSections)) {
    if (!isInspectionLevelSection(key, section)) continue;
    const srcItems = Array.isArray(section.items) ? section.items : [];
    shared[key] = srcItems.map((it) => ({ id: it.id, status: 'P', result: 'P', notes: '', finding: '' }));
  }
  return shared;
}


module.exports={buildDimensionalFromTests,buildItemForInjector,buildSharedSections};
