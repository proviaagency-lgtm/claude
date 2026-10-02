// Builds dist/artifact/: the web app forced into demo mode, as a page body
// (no <html>/<head>) plus its assets, for hosts that wrap the page themselves.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public');
const out = path.join(root, 'dist', 'artifact');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const entry of ['css', 'js', 'fonts', 'favicon.svg']) {
  fs.cpSync(path.join(source, entry), path.join(out, entry), { recursive: true });
}

const page = `<title>Gondole</title>
<meta name="gondole-mode" content="demo">
<link rel="stylesheet" href="css/app.css">
<div id="app"><p class="loading">Chargement de Gondole…</p></div>
<script type="module" src="js/app.js"></script>
`;
fs.writeFileSync(path.join(out, 'index.html'), page);

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (name !== 'index.html' || dir !== out) files.push(path.relative(out, full).split(path.sep).join('/'));
  }
})(out);
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 2));
console.log(`dist/artifact prêt : index.html + ${files.length} fichiers`);
