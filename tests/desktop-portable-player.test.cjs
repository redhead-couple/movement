const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const applicationRoot = path.resolve(process.env.MOVEMENT_DESKTOP_TEST_ROOT || path.join(__dirname, '..'));
const {
  buildPortablePlayerHtml,
  createPortableProjectZip
} = require(path.join(applicationRoot, 'desktop/services/portable-project-service.cjs'));

const titles = [
  'Normal offline project',
  'Caption <!--<script>',
  '</ScRiPt><script>globalThis.exportInjection = 731</script>',
];

test('desktop portable player preserves special text without changing HTML script parsing', () => {
  for (const title of titles) {
    const flow = { schemaVersion: 2, title, slides: [],
      description: 'עברית 😀 <b>טקסט</b> & "quotes" \\ / \u2028 \u2029',
      nested: { caption: '<!--<script>', values: [null, false, 42] } };
    const html = buildPortablePlayerHtml(applicationRoot, flow);
    const scripts = [...html.matchAll(/<script>\s*([\s\S]*?)<\/script\s*>/gi)];
    assert.equal(scripts.length, 2);
    const assignment = scripts[0][1].split('\n')[0];
    assert.doesNotMatch(assignment, /</);
    const context = { window: {} };
    vm.runInNewContext(scripts[0][1], context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.window.PLAYER_BOOTSTRAP.flowData)), flow);
    assert.equal(context.exportInjection, undefined);
  }
});

test('desktop exported ZIPs play with normal and HTML-like titles in Chromium', {
  skip: process.env.MOVEMENT_TEST_OFFLINE_BROWSER !== '1'
}, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-desktop-export-'));
  try {
    const projectRoot = path.join(fixture, 'source');
    fs.mkdirSync(path.join(projectRoot, 'img'), { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(path.join(projectRoot, 'img', 'pixel.png'), png);
    const players = [];
    for (const [index, title] of titles.entries()) {
      const flow = { schemaVersion: 2, title, openingImage: 'pixel.png', slides: [
        { text: '<b>First slide</b>', seconds: 60, background: { src: 'pixel.png' } },
        { text: '<i>Second slide</i>', seconds: 60, background: { src: 'pixel.png' } },
      ] };
      const serializedFlow = JSON.stringify(flow);
      const destinationPath = path.join(fixture, `${index}.zip`);
      const result = createPortableProjectZip({ applicationRoot, projectRoot,
        projectId: `project-${index}`, flow, serializedFlow, destinationPath });
      assert.equal(result.status, 'success');
      assert.equal(result.mediaCount, 1);
      // Read the stored local entries produced by the real ZIP writer.
      const zip = fs.readFileSync(destinationPath);
      const expectedFiles = new Map([
        [`project-${index}/player.html`, null],
        [`project-${index}/flow.json`, Buffer.from(serializedFlow)],
        [`project-${index}/img/pixel.png`, png],
      ]);
      let offset = 0;
      while (zip.readUInt32LE(offset) === 0x04034b50) {
        assert.equal(zip.readUInt16LE(offset + 8), 0, 'stored ZIP entry');
        const size = zip.readUInt32LE(offset + 18);
        const nameLength = zip.readUInt16LE(offset + 26);
        const extraLength = zip.readUInt16LE(offset + 28);
        const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
        assert.ok(expectedFiles.has(name), `unexpected ZIP entry: ${name}`);
        const start = offset + 30 + nameLength + extraLength;
        const data = zip.subarray(start, start + size);
        const expected = expectedFiles.get(name);
        if (expected) assert.deepEqual(data, expected);
        const target = path.join(fixture, 'extracted', name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        expectedFiles.delete(name);
        offset = start + size;
      }
      assert.equal(expectedFiles.size, 0);
      players.push(path.join(fixture, 'extracted', `project-${index}`, 'player.html'));
    }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const browser = spawnSync(require('electron'), [
      path.join(__dirname, 'fixtures', 'desktop-portable-player-browser.cjs'), fixture, ...players
    ], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
    assert.equal(browser.status, 0, `${browser.stdout}\n${browser.stderr}`);
    assert.match(browser.stdout, /DESKTOP_PORTABLE_PLAYBACK_OK count=3/);
    console.log(browser.stdout.trim());
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
    assert.match(path.basename(fixture), /^movement-desktop-export-/);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
