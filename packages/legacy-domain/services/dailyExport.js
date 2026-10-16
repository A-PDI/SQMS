'use strict';
const { PASS, injectorOutcome }=require('./injectorResult');
const { zonedTestDate, testTimeZone }=require('./timeZone');
const { displayPartNumber, unmappedPartNumbers }=require('./injectorPartNumbers');
function passedTests(tests = []) {
  return (Array.isArray(tests) ? tests : []).filter((test) => injectorOutcome(test) === PASS);
}

/**
 * Sheet rows for a day's passed injectors: [Test Date, Part Number, Serial Number].
 *
 * The part number is PDI's, not the bench's: the bench records evaluation and
 * pre-production spellings of the same part, and the sheet is read as a record
 * of PDI parts (see injectorPartNumbers). A bench part with no PDI number
 * passes through as it came, and is listed by `unmappedParts` on the result.
 *
 * A missing part or serial is written as an empty cell rather than a dash, so
 * the column stays usable as data.
 */
function buildExportRows(tests = [], timeZone = testTimeZone()) {
  return passedTests(tests).map((test) => [
    zonedTestDate(test.test_datetime, timeZone),
    displayPartNumber(test.part_number),
    String(test.serial_number || '').trim(),
  ]);
}

/** The bench part numbers among these tests that have no PDI number. */
function unmappedPartsIn(tests = []) {
  return unmappedPartNumbers(passedTests(tests).map((test) => test.part_number));
}


module.exports={passedTests,buildExportRows,unmappedPartsIn};
