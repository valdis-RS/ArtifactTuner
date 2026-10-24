// Bundles src/ into one HTML page. Each module is wrapped in its own scope;
// `import { a, b as c } from './x.js'` becomes a destructure of that
// module's exports. Only that import form and `export function|class|const`
// are supported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ORDER = [
  'xml.js', 'math.js', 'codec.js', 'xdf.js', 'table.js', 'image.js', 'ops.js',
  'checksums/ems2k.js', 'checksums/index.js', 'zip.js', 'save.js',
  'ui/dom.js', 'ui/status.js', 'ui/demo.js', 'ui/sidebar.js',
  'ui/grid.js', 'ui/toolbar.js', 'ui/surface3d.js', 'ui/graph2d.js',
  'ui/app.js',
];

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT = /^export\s+((?:async\s+)?function\*?|class|const)\s+([A-Za-z_$][\w$]*)/gm;

export function bundle(srcDir, order) {
  const known = new Set(order);
  const exportsOf = new Map();
  const parts = [];
  for (const id of order) {
    let code = fs.readFileSync(path.join(srcDir, id), 'utf8');
    const names = [];
    code = code.replace(IMPORT, (_, list, spec) => {
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
      if (!known.has(dep)) throw new Error(`${id}: imports ${spec}, which is not in the bundle`);
      if (order.indexOf(dep) > order.indexOf(id)) throw new Error(`${id}: imports ${dep}, which comes later in the bundle order`);
      const binds = list.split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
        if (!m) throw new Error(`${id}: cannot bundle the import "${s}"`);
        if (!exportsOf.get(dep).has(m[1])) throw new Error(`${id}: ${dep} does not export ${m[1]}`);
        return m[2] ? `${m[1]}: ${m[2]}` : m[1];
      });
      return `const { ${binds.join(', ')} } = __mods[${JSON.stringify(dep)}];`;
    });
    code = code.replace(EXPORT, (_, kind, name) => {
      names.push(name);
      return `${kind} ${name}`;
    });
    exportsOf.set(id, new Set(names));
    const left = /^\s*(import|export)\b.*$/m.exec(code);
    if (left) throw new Error(`${id}: unsupported ${left[1]} statement: ${left[0].trim()}`);
    parts.push(`__mods[${JSON.stringify(id)}] = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();`);
  }
  const js = `(() => {\n'use strict';\nconst __mods = {};\n${parts.join('\n')}\n})();\n`;
  if (js.includes('</script')) throw new Error('The bundle contains "</script", which would end the inline script early');
  return js;
}

export function build() {
  const src = path.join(HERE, 'src');
  const js = bundle(src, ORDER);
  const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');
  const page = fs.readFileSync(path.join(src, 'index.html'), 'utf8')
    .replace('/*STYLE*/', () => css)
    .replace('/*SCRIPT*/', () => js);
  const dist = path.join(HERE, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const artifact = path.join(dist, 'xdf-editor.html');
  const local = path.join(dist, 'xdf-editor-local.html');
  fs.writeFileSync(artifact, page);
  fs.writeFileSync(local, '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n' +
    page + '\n</body>\n</html>\n');
  return { artifact, local, bytes: page.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`wrote ${path.relative(HERE, r.artifact)} and ${path.relative(HERE, r.local)} (${Math.round(r.bytes / 1024)} KB)`);
}
