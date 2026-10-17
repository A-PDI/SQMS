'use strict';
const {
  splitStepName,
  normaliseStepCode,
  isFlushStep,
  stepDisplayName,
  formatErrorDescription,
  formatErrorValue,
} = require('./injectorSteps');
const {
  injectorScorecard,
  stepOutcome,
} = require('./injectorResult');

const PASS = 'pass';
const FAIL = 'fail';
const SKIP = 'skip';

/**
 * Determine PASS / FAIL / SKIP for a tank.
 *
 * IMPORTANT — pass/fail is judged against the GREEN acceptance band
 * (min_green … max_green), which is exactly the spec shown to the operator as
 * `text_green` (e.g. "8.5 +/- 4.5" → 4.0 … 13.0). The bench's own
 * `result_pass` / `result_color` fields instead reflect the much tighter BLUE
 * *target* band (min_blue … max_blue), so relying on them makes in-spec
 * injectors show up as FAIL. We therefore compute status from AvrResult vs the
 * green band and only fall back to result_pass when the green bounds are
 * unavailable.
 */
function tankStatus(tank) {
  if (!tank) return null;

  const avr = toNum(tank.AvrResult);
  const lo = toNum(tank.min_green);
  const hi = toNum(tank.max_green);

  // Preferred path: green acceptance band + a measured average.
  if (avr != null && (lo != null || hi != null)) {
    const okLo = lo == null || avr >= lo - EPS;
    const okHi = hi == null || avr <= hi + EPS;
    return okLo && okHi ? PASS : FAIL;
  }

  // Fallback: no green band available — trust the bench's own flag.
  const p = Number(tank.result_pass);
  if (p === 1) return PASS;
  if (p === 2) return FAIL;
  return SKIP; // 4 / anything else / no data
}

// Small helpers for numeric tolerance comparison.
const EPS = 1e-6;
function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a normalised list of test steps for a single injector report object.
 * Each step: { code, name, display_name, category, conditions, spec, unit,
 *              results, status, errored, error_description, error_raw,
 *              internal, secondary: {...}|null }
 *
 * NAME vs ERROR: the bench appends anomaly text to the step name itself
 * ("iVM.06 : HP ERROR (out of range) #1000"). `name` is always the step code
 * with that text removed, so a failing result can never rename a test step;
 * the error only ever surfaces through `errored` / `error_description` and the
 * result value ("Error: Out of Range").
 *
 * FL(W) — the internal flush/prep diagnostic — is kept in the list but flagged
 * `internal: true` so consumers can exclude it from customer-facing rows while
 * still seeing an aborted-run error.
 */
function normaliseTests(report) {
  const tests = Array.isArray(report.AllTests) ? report.AllTests : [];
  return tests.map((t) => {
    const ti = t.TestInfo || {};
    const pt = t.PrimaryTank || null;
    const st = t.SecondaryTank || null;
    const parsed = splitStepName(ti.test_name);
    const errored = parsed.errored;
    const skipped = Number(ti.status) === 1 && !errored;

    const conditionParts = [];
    if (ti.rpm != null && ti.rpm !== '') conditionParts.push(`RPM ${ti.rpm}`);
    if (ti.hp != null && ti.hp !== '') conditionParts.push(`HP ${ti.hp}`);
    if (ti.lp != null && ti.lp !== '') conditionParts.push(`LP ${ti.lp}`);
    if (ti.inj_1 != null && ti.inj_1 !== '') conditionParts.push(`Inj ${ti.inj_1}`);
    if (ti.strk != null && ti.strk !== '') conditionParts.push(`Strk ${ti.strk}`);

    // Structured test-step parameters used by the custom comparison report.
    //   hp    → "Rail Pressure"
    //   inj_1 → "Pulse Width"
    //   strk  → stroke count
    const clean = (v) => (v == null || v === '' ? '' : String(v));
    const params = {
      rail_pressure: clean(ti.hp),   // "Rail Pressure"
      pulse_width: clean(ti.inj_1),  // "Pulse Width"
      strk: clean(ti.strk),
    };

    // The API error description, preserved verbatim plus a cleaned-up form for
    // display ("HP ERROR (out of range) #1000" → "Out of Range").
    const errorRaw = errored ? parsed.errorRaw : '';
    const errorDescription = errored ? formatErrorDescription(errorRaw) : '';
    const errorValue = errored ? formatErrorValue(errorDescription) : '';

    function tankView(tank, role) {
      if (!tank && !errored) return null;
      const t2 = tank || {};
      const specText = t2.text_green != null && t2.text_green !== ''
        ? `${t2.text_green}${t2.tank_unit ? ' ' + t2.tank_unit : ''}`
        : (t2.tank_unit || '');
      const avr = toNum(t2.AvrResult);
      return {
        tank_name: t2.tank_name || '',
        unit: t2.tank_unit || '',
        // Human-readable green-band spec, e.g. "8.5 +/- 4.5 mm3/STRK".
        spec: specText,
        // Structured specification pieces for the comparison report columns.
        target: t2.target_blue != null ? String(t2.target_blue) : '',
        tolerance: t2.tol_blue != null ? String(t2.tol_blue) : '',
        // Green acceptance band (the true pass/fail range).
        min_green: toNum(t2.min_green),
        max_green: toNum(t2.max_green),
        results: t2.results != null ? String(t2.results) : '',
        // The single "flow" value reported per injector = the average reading.
        // A step the bench flagged (e.g. an excess return) still reports what it
        // MEASURED — the reading is kept and the failure is carried by `status`
        // and `error_description`. The error text is only used as the value when
        // the bench recorded no reading at all.
        average: avr != null ? String(avr) : (errored ? errorValue : ''),
        error: errored,
        error_description: errorDescription,
        // Keep the measurement's independent band result even when the bench
        // interrupted the step. The shared classifier decides whether that
        // proves a component failure or represents a DNF.
        status: tankStatus(t2),
        // Which display label this tank uses ("Resistance" vs "Inductance").
        role,
      };
    }

    const primary = tankView(pt, 'primary');
    const secondary = st ? tankView(st, 'secondary') : null;

    // Overall step status. An interrupted step is DNF unless one of its
    // measured tanks is explicitly outside the green acceptance range.
    let status = SKIP;
    if (!skipped && primary && !errored) {
      const parts = [primary.status, secondary ? secondary.status : null].filter(Boolean);
      if (parts.includes(FAIL)) status = FAIL;
      else if (parts.includes(PASS)) status = PASS;
      else status = SKIP;
    }

    const normalised = {
      // Step code with any bench anomaly text removed — never the error message.
      name: parsed.base || (ti.test_name || ''),
      code: normaliseStepCode(parsed.base),
      display_name: stepDisplayName(parsed.base, 'primary', pt && pt.tank_name),
      raw_name: ti.test_name || '',
      order: ti.test_order != null ? Number(ti.test_order) : 0,
      category: ti.test_category_id != null ? Number(ti.test_category_id) : null,
      conditions: conditionParts.join(' · '),
      params,
      skipped,
      status,
      errored,
      error_description: errorDescription,
      // The untouched API text, kept for troubleshooting (never shown raw).
      error_raw: errorRaw,
      internal: isFlushStep(parsed.base),
      primary,
      secondary,
    };
    normalised.status = stepOutcome(normalised);
    return normalised;
  });
}

/**
 * Convert one CarbonZapp report object into an injector row for our DB.
 */
function mapReportToInjector(report) {
  const slot = report.SlotsData || {};
  const tests = normaliseTests(report);
  // Customer-facing steps only (FL(W) is internal). A bench interruption does
  // not count as a component failure unless a preceding point failed or the
  // interrupted point contains an out-of-band measured value.
  const scorecard = injectorScorecard({ tests });

  return {
    report_ext_id: report._id != null ? String(report._id) : '',
    slot_position: slot.position != null ? Number(slot.position) : 0,
    part_number: report.actuator_code || null,
    serial_number: slot.sn || null,
    // Job # is evaluated transiently by the import-exclusion rules below but
    // is not retained as application data.
    job_number: null,
    brand: report.actuator_Brand || null,
    injector_type: report.actuator_type || null,
    machine_name: report.machine_name || null,
    machine_sn: report.machine_sn || null,
    test_datetime: report.datetime || report.created_at || null,
    ext_status: report.status != null ? Number(report.status) : null,
    overall_pass: scorecard.overallPass,
    result_status: scorecard.outcome,
    steps_total: scorecard.stepsTotal,
    steps_passed: scorecard.stepsPassed,
    steps_failed: scorecard.stepsFailed,
    tests,
    // Keep the trimmed but complete data we need for the custom PDF.
    report_json: {
      report_ext_id: report._id != null ? String(report._id) : '',
      slot_position: slot.position != null ? Number(slot.position) : 0,
      part_number: report.actuator_code || null,
      serial_number: slot.sn || null,
      brand: report.actuator_Brand || null,
      injector_type: report.actuator_type || null,
      machine_name: report.machine_name || null,
      machine_sn: report.machine_sn || null,
      test_datetime: report.datetime || report.created_at || null,
      tests,
    },
  };
}

// ── Remote fetch ──────────────────────────────────────────────────────────────

/**
 * Call the CarbonZapp API. Returns the parsed JSON array of report objects.
 * `opts.dateFrom` is an ISO date string used for incremental sync.
 */
function hydrateInjectorRow(row) {
  let rj = {};
  try { rj = row.report_json ? JSON.parse(row.report_json) : {}; } catch (_) { rj = {}; }
  const hydrated = {
    ...row,
    tests: Array.isArray(rj.tests) ? rj.tests : [],
    report_json: rj,
  };
  // The compatibility column can still exist in older databases, but Job # is
  // no longer part of the application model after the import decision.
  delete hydrated.job_number;
  return hydrated;
}


module.exports = {tankStatus, normaliseTests, mapReportToInjector, hydrateInjectorRow};

function jobNumberOf(report) {
  return String((report && (report.job || report.drs_id)) || '').trim();
}

function serialNumberOf(report) {
  return String((report && report.SlotsData && report.SlotsData.sn) || '').trim();
}

function exclusionReasons(report) {
  const reasons = [];
  if (/^R/i.test(serialNumberOf(report))) reasons.push('serial_starts_with_r');
  if (/RMA/i.test(jobNumberOf(report))) reasons.push('job_contains_rma');
  return reasons;
}

function shouldImportReport(report) {
  return exclusionReasons(report).length === 0;
}


Object.assign(module.exports,{exclusionReasons,shouldImportReport});
