const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('PHP partial empty-trash failure keeps remaining files recoverable and preserves live media', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-php-image-trash-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^movement-php-image-trash-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, '.movement-media-trash/batch/img'), { recursive: true });
  fs.mkdirSync(path.join(project, 'img'));
  fs.writeFileSync(path.join(project, 'img/live.png'), 'live');
  for (const name of ['first.png', 'second.png']) fs.writeFileSync(path.join(project, '.movement-media-trash/batch/img', name), name);
  const source = fs.readFileSync(path.resolve(__dirname, '../server/core/media-trash.php'), 'utf8');
  const helper = path.join(root, 'injected.php');
  fs.writeFileSync(helper, source.replace('if (!@unlink($file)) return', "if ($item['filename'] === 'second.png' || !@unlink($file)) return"));
  const runner = path.join(root, 'run.php');
  fs.writeFileSync(runner, `<?php
    require $argv[1]; $root = $argv[2];
    $snapshot = mediaTrashSnapshot($root);
    $result = emptyMediaTrash($root, $snapshot['token']);
    $remaining = mediaTrashSnapshot($root)['files'];
    foreach ($remaining as $item) restoreTrashedMedia($root, $item['type'], $item['trashId'], $item['filename']);
    echo json_encode([$result, count($remaining)]);
  `);
  const result = spawnSync('php', [runner, helper, project], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [deleted, remaining] = JSON.parse(result.stdout);
  assert.equal(deleted.deleted, 1);
  assert.match(deleted.error, /remaining files/);
  assert.equal(remaining, 1);
  assert.equal(fs.readFileSync(path.join(project, 'img/second.png'), 'utf8'), 'second.png');
  assert.equal(fs.readFileSync(path.join(project, 'img/live.png'), 'utf8'), 'live');
});

test('PHP interrupted and failed bulk moves remain recoverable, including with a broken flow', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-php-image-trash-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^movement-php-image-trash-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const helper = path.resolve(__dirname, '../server/core/media-trash.php');
  const runner = path.join(root, 'run.php');
  fs.writeFileSync(runner, `<?php
    require $argv[1];
    $root = $argv[2];
    try {
      if ($argv[3] === 'move') {
        $snapshot = unusedImageSnapshot($root, $root . '/flow.json');
        echo json_encode(trashUnusedImages($root, $root . '/flow.json', $snapshot['token']));
      } else {
        foreach (listImageTrash($root) as $item) restoreTrashedImage($root, $item['trashId'], $item['filename']);
        echo json_encode(listImageTrash($root));
      }
    } catch (Throwable $e) { fwrite(STDERR, $e->getMessage()); exit(1); }
  `);
  const run = (source, project, action) => spawnSync('php', [runner, source, project, action], { windowsHide: true, encoding: 'utf8' });
  for (const mode of ['crash', 'failure']) {
    const project = path.join(root, mode);
    fs.mkdirSync(path.join(project, 'img'), { recursive: true });
    for (const name of ['first.png', 'second.png', 'used.png']) fs.writeFileSync(path.join(project, 'img', name), `bytes:${name}`);
    fs.writeFileSync(path.join(project, 'flow.json'), JSON.stringify({ schemaVersion: 2, slides: [{ background: 'used.png' }] }));
    const modified = path.join(root, `${mode}.php`);
    const code = fs.readFileSync(helper, 'utf8');
    fs.writeFileSync(modified, mode === 'crash' ? code.replace('$moved++;', '$moved++; exit(73);')
      : code.replace('if (!@rename($source,', "if ($filename === 'second.png' || !@rename($source,"));
    const interrupted = run(modified, project, 'move');
    assert.equal(interrupted.status, mode === 'crash' ? 73 : 0, interrupted.stderr);
    if (mode === 'failure') {
      assert.equal(JSON.parse(interrupted.stdout).moved, 1);
      assert.match(JSON.parse(interrupted.stdout).error, /Stopped/);
    }
    assert.equal(fs.existsSync(path.join(project, 'img/first.png')), false);
    assert.equal(fs.readFileSync(path.join(project, 'img/second.png'), 'utf8'), 'bytes:second.png');
    fs.writeFileSync(path.join(project, 'flow.json'), '{broken');
    const fallback = path.join(root, 'no-hard-links.php');
    fs.writeFileSync(fallback, fs.readFileSync(helper, 'utf8').replace('if (!@link($source, $target)) {', 'if (true) {'));
    const restored = run(mode === 'failure' ? fallback : helper, project, 'restore');
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout), []);
    for (const name of ['first.png', 'second.png', 'used.png']) assert.equal(fs.readFileSync(path.join(project, 'img', name), 'utf8'), `bytes:${name}`);
  }
});
