const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');

test('presentation copies preserve dimensions, transparency and originals; fail safely and invalidate on replacement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-image-copy-'));
  try {
    const script = `<?php
require $argv[1]; $dir=$argv[2]; $source="$dir/source.png"; $cache="$dir/cache";
function check($ok,$message) { if (!$ok) throw new RuntimeException($message); }
$im=imagecreatetruecolor(512,256); imagealphablending($im,false); imagesavealpha($im,true);
for($y=0;$y<256;$y++) for($x=0;$x<512;$x++) imagesetpixel($im,$x,$y,imagecolorallocatealpha($im,$x%256,$y,120,($x%128)));
imagepng($im,$source,0); $hash=hash_file('sha256',$source);
$copy=playerImageCopy($source,$cache); check(is_string($copy),'copy created');
check(hash_file('sha256',$source)===$hash,'original unchanged');
check(filesize($copy)<filesize($source)*0.85,'meaningful saving');
$out=imagecreatefromwebp($copy); check(imagesx($out)===512 && imagesy($out)===256,'same dimensions');
for($y=0;$y<256;$y+=7) for($x=0;$x<512;$x+=7) check((imagecolorat($im,$x,$y)>>24)===(imagecolorat($out,$x,$y)>>24),'alpha preserved');
check(playerImageCopy($source,$cache)===$copy,'reused cache');
// A noisy lossy WebP exceeds the small-file cutoff, but must still be passed
// through without an extra lossy encode or a cache entry.
$noise=imagecreatetruecolor(512,512); mt_srand(7);
for($y=0;$y<512;$y++) for($x=0;$x<512;$x++) imagesetpixel($noise,$x,$y,mt_rand(0,16777215));
imagewebp($noise,"$dir/lossy.webp",90); check(filesize("$dir/lossy.webp")>65536,'large lossy fixture');
check(playerImageCopy("$dir/lossy.webp",$cache)===null,'already-lossy WebP retained');
imagefilledrectangle($im,0,0,511,255,imagecolorallocatealpha($im,20,40,80,0)); imagepng($im,$source,0);
check(playerImageCopy($source,$cache)!==$copy,'replacement refreshes copy');
file_put_contents("$dir/not-directory",'x'); check(playerImageCopy($source,"$dir/not-directory/cache")===null,'failed write falls back');
file_put_contents("$dir/broken.webp",str_repeat('x',70000)); check(playerImageCopy("$dir/broken.webp",$cache)===null,'corrupt fallback');
// Preserve animation/profile data instead of flattening or stripping it.
foreach(['acTL','iCCP','gAMA'] as $tag) { file_put_contents("$dir/tag.png",file_get_contents($source).$tag); check(playerImageCopy("$dir/tag.png",$cache)===null,'special image fallback'); }
imagewebp($im,"$dir/small.webp",30); check(playerImageCopy("$dir/small.webp",$cache)===null,'small original retained');
$old="$cache/".str_repeat('a',64).'.webp'; file_put_contents($old,'old'); touch($old,time()-8*86400); prunePlayerImageCopies($cache); check(!file_exists($old),'expired copies removed');
$abandoned="$cache/encode-abandoned"; file_put_contents($abandoned,'partial'); touch($abandoned,time()-2*86400); prunePlayerImageCopies($cache); check(!file_exists($abandoned),'abandoned temporary copy removed');
echo json_encode(['originalPreserved'=>true,'alphaPreserved'=>true,'replacementVerified'=>true]);
`;
    const file = path.join(dir, 'run.php'); fs.writeFileSync(file, script);
    const result = spawnSync('php', ['-d', 'extension=gd', file, path.join(root, 'server/core/player-image.php'), dir], { windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).alphaPreserved, true);
    const fallback = spawnSync('php', ['-n', '-r', 'require $argv[1]; echo json_encode(playerImageCopy($argv[2],$argv[3]));', path.join(root, 'server/core/player-image.php'), path.join(dir, 'source.png'), path.join(dir, 'cache')], { windowsHide: true, encoding: 'utf8' });
    assert.equal(fallback.status, 0, fallback.stderr); assert.equal(fallback.stdout, 'null');
  } finally {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^movement-image-copy-/);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('media controller authorizes cached copies on every request and keeps originals/audio unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-image-http-'));
  let child, closed;
  try {
    for (const file of ['media.php', 'player.php', 'server/core/player-image.php', 'server/core/project-paths.php', 'server/core/config-loader.php', 'server/core/web-session.php', 'server/core/response.php', 'templates/player/player-page-template.php', 'studio/player/player-runtime.js']) {
      const target = path.join(dir, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, file), target);
    }
    fs.writeFileSync(path.join(dir, 'server/core/app-config.php'), '<?php $APP_ENVIRONMENT="development";');
    const project = path.join(dir, 'private-data/slidedeck/owner/demo');
    for (const folder of ['img', 'speech', 'backups', '.movement-media-trash']) fs.mkdirSync(path.join(project, folder), { recursive: true });
    const flow = { schemaVersion: 2, isPublished: true, slides: [] };
    const saveFlow = () => fs.writeFileSync(path.join(project, 'flow.json'), JSON.stringify(flow)); saveFlow();
    const original = path.join(project, 'img/test.png');
    const generate = spawnSync('php', ['-d', 'extension=gd', '-r', '$i=imagecreatetruecolor(512,512); imagepng($i,$argv[1],0);', original], { windowsHide: true });
    assert.equal(generate.status, 0, generate.stderr.toString());
    const bytes = fs.readFileSync(original);
    fs.writeFileSync(path.join(project, 'speech/test.mp3'), 'unchanged audio');
    fs.copyFileSync(original, path.join(project, 'backups/test.png'));
    fs.copyFileSync(original, path.join(project, '.movement-media-trash/test.png'));
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    child = spawn('php', ['-d', 'extension=gd', '-S', `127.0.0.1:${port}`, '-t', dir], { windowsHide: true, stdio: 'ignore' }); closed = once(child, 'close');
    const url = `http://127.0.0.1:${port}`;
    for (let i=0;i<100;i++) { try { await fetch(url); break; } catch { await new Promise(r=>setTimeout(r,30)); } }
    const get = (file, suffix='') => fetch(url+'/media.php?p=owner/demo/'+file+suffix);
    const optimized = await get('img/test.png', '&variant=player');
    assert.equal(optimized.status, 200); assert.equal(optimized.headers.get('content-type'), 'image/webp');
    assert.match(optimized.headers.get('cache-control'), /no-store/);
    assert.ok((await optimized.arrayBuffer()).byteLength < bytes.length * .85);
    assert.ok(Buffer.from(await (await get('img/test.png')).arrayBuffer()).equals(bytes));
    assert.ok(fs.readFileSync(original).equals(bytes));
    assert.equal(await (await get('speech/test.mp3', '&variant=player')).text(), 'unchanged audio');
    const html = await (await fetch(url+'/player.php?username=owner&project=demo')).text();
    assert.match(html, /variant=player&p=owner\/demo\/img\//);
    assert.match(html, /"speechBase":"\/media.php\?p=owner\/demo\/speech\//);
    assert.equal((await get('backups/test.png', '&variant=player')).status, 403);
    assert.equal((await get('.movement-media-trash/test.png', '&variant=player')).status, 403);
    flow.isPublished = false; saveFlow();
    assert.equal((await get('img/test.png', '&variant=player')).status, 403);
    flow.isPublished = true; saveFlow(); fs.unlinkSync(original);
    assert.equal((await get('img/test.png', '&variant=player')).status, 404);
  } finally {
    if (child) { child.kill(); await closed; }
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^movement-image-http-/);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
