// Builds the zip to upload to the Chrome Web Store: only the files the
// extension runs, none of the repo's docs or tests.
// Usage: node scripts/package.js   (Node 22+, no dependencies)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const RUNTIME_FILES = [
  'manifest.json',
  'background.js',
  'constants.js',
  'input-parser.js',
  'content.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icon.png',
  'LICENSE'
];
const RUNTIME_DIRS = ['icons', 'fonts'];

function collectFiles() {
  const files = [...RUNTIME_FILES];
  for (const dir of RUNTIME_DIRS) {
    for (const name of fs.readdirSync(path.join(ROOT, dir)).sort()) files.push(`${dir}/${name}`);
  }
  return files;
}

// Everything the manifest points at must be in the package
function checkManifest(manifest, files) {
  const referenced = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    ...manifest.content_scripts.flatMap(script => script.js),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  const missing = referenced.filter(file => !files.includes(file));
  if (missing.length > 0) throw new Error(`manifest.json references files that are not packaged: ${missing.join(', ')}`);
}

// Minimal zip writer (deflate, no zip64) — enough for a handful of small files
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 names
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt32LE(0x00210000, 10); // fixed timestamp (1980-01-01) so builds are reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(0x00210000, 12);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const files = collectFiles();
checkManifest(manifest, files);

const archive = zip(files.map(name => ({ name, data: fs.readFileSync(path.join(ROOT, name)) })));
const outDir = path.join(ROOT, 'dist');
const outFile = path.join(outDir, `promptcraft-${manifest.version}.zip`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, archive);

console.log(`${path.relative(ROOT, outFile)}  ${files.length} files, ${(archive.length / 1024).toFixed(0)} KB`);
