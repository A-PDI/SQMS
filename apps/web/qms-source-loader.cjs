const path = require('node:path');
// Build-time integration only: preserve source files verbatim while resolving
// the reference application's Vite @ alias and public environment expression.
module.exports = function(source) {
  const root = path.join(__dirname, 'src/qms');
  const relative = path.relative(path.dirname(this.resourcePath), root).replaceAll('\\', '/') || '.';
  return source.replace(/(['"])@\//g, (_, quote) => quote + relative + '/')
    .replaceAll('import.meta.env', '({ VITE_API_URL: "", DEV: false })');
};
