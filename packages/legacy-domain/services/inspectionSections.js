function initSectionData(templateSections) {
  const data = {}
  for (const [key, section] of Object.entries(templateSections)) {
    switch (section.section_type) {
      // 'N' is the inspector-selected "not applicable" code, so a fresh row
      // starts with no status at all (as every other section type does).
      case 'pfn_checklist':
        data[key] = section.items.map(item => ({ id: item.id, finding: '', status: '' }))
        break
      case 'pfn_visual':
        data[key] = section.items.map(item => ({ id: item.id, result: '', remarks: '' }))
        break
      case 'dimensional':
        data[key] = section.items.map(item => ({ id: item.id, spec: item.spec || '', actual1: '', actual2: '', actual3: '', status: '' }))
        break
      case 'pass_fail_checklist':
        data[key] = section.items.map(item => ({ id: item.id, pass: false, fail: false, notes: '' }))
        break
      case 'general_measurements':
        data[key] = section.items.map(item => ({ id: item.id, specification: '', actual_value: '', notes: '', result: '' }))
        break
      case 'camshaft_bore':
        data[key] = { spec: '', bores: Array(section.bore_count).fill('') }
        break
      case 'fire_ring_protrusion':
        data[key] = { spec: '', cylinders: Array(section.cylinder_count).fill('') }
        break
      case 'valve_recession':
        data[key] = {
          intake_min: '', intake_max: '', exhaust_min: '', exhaust_max: '',
          cylinders: Array(section.cylinder_count).fill(null).map(() => ({ int1: '', int2: '', exh1: '', exh2: '' }))
        }
        break
      case 'vacuum_test':
        data[key] = {
          cylinders: Array(section.cylinder_count).fill(null).map(() => ({
            overall: '', int1: '', int2: '', exh1: '', exh2: ''
          }))
        }
        break
      case 'groove_specs':
        data[key] = {
          measurements: section.items.map(item => ({
            id: item.id,
            cylinders: Array(section.cylinder_count || 6).fill(''),
            status: '',
            notes: '',
          }))
        }
        break
      default:
        data[key] = {}
    }
  }
  return data
}

/** Merge saved section_data with fresh initialized structure (fills missing keys) */
function mergeSectionData(saved, fresh) {
  const merged = { ...fresh }
  for (const key of Object.keys(fresh)) {
    if (saved && saved[key] !== undefined) {
      merged[key] = saved[key]
    }
  }
  return merged
}


module.exports={initSectionData,mergeSectionData};
