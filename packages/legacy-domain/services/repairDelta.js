const {isFlushStep,stepCode,stepLabel,numericValue}=require('./injectorSteps');
const finite=v=>v==null||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const text=(v,n)=>String(v==null?'':v).trim().slice(0,n);
'use strict';
function calculateDelta(before, after) {
  const beforeValue = before ? before.before_value : null;
  const target = before && before.target_value != null
    ? before.target_value
    : (after ? after.target : null);
  const afterValue = after ? after.value : null;
  const absolute = beforeValue != null && afterValue != null ? afterValue - beforeValue : null;
  const percent = absolute != null && beforeValue !== 0 ? (absolute / beforeValue) * 100 : null;
  const beforeDistance = beforeValue != null && target != null ? beforeValue - target : null;
  const afterDistance = afterValue != null && target != null ? afterValue - target : null;
  const effectiveness = beforeDistance != null && afterDistance != null && beforeDistance !== 0
    ? ((Math.abs(beforeDistance) - Math.abs(afterDistance)) / Math.abs(beforeDistance)) * 100
    : null;
  return { target, afterValue, absolute, percent, beforeDistance, afterDistance, effectiveness };
}


module.exports = { calculateDelta };
function measurementSnapshot(test) {
  const rows = new Map();
  for (const step of (test.tests || [])) {
    if (!step || !step.primary || isFlushStep(step)) continue;
    const code = stepCode(step);
    const add = (tank, role, keyRole) => {
      if (!tank) return;
      const min = finite(tank.min_green);
      const max = finite(tank.max_green);
      const explicitTarget = finite(tank.target);
      const target = explicitTarget != null
        ? explicitTarget
        : (min != null && max != null ? (min + max) / 2 : null);
      rows.set(`${code}|${keyRole}`, {
        stepKey: `${code}|${keyRole}`,
        stepCode: code,
        stepName: stepLabel(step, role, tank.tank_name),
        tankRole: role,
        value: finite(tank.average),
        status: String(tank.status || step.status || 'unknown').toUpperCase(),
        target,
        specMin: min,
        specMax: max,
        unit: text(tank.unit, 40) || null,
      });
    };
    add(step.primary, 'primary', '1');
    add(step.secondary, 'secondary', '2');
  }
  return rows;
}


Object.assign(module.exports,{measurementSnapshot});
