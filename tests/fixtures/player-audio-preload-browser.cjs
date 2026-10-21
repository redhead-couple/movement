const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(process.env.MOVEMENT_AUDIO_TEST_ROOT || path.join(__dirname, '../..'));
function buildPlayer(flow) {
    if (fs.existsSync(path.join(root, 'desktop/services/portable-project-service.cjs'))) {
        return require(path.join(root, 'desktop/services/portable-project-service.cjs')).buildPortablePlayerHtml(root, flow);
    }
    // Exercise the PHP player template and runtime from the extracted web ZIP.
    const result = spawnSync('php', ['-r', "require 'templates/player/offline-player-template.php'; echo buildOfflinePlayerHtml(stream_get_contents(STDIN), '', []);"],
        { cwd: root, input: JSON.stringify(flow), encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}
const fixture = process.argv[2];
app.setPath('userData', path.join(fixture, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const wav = Buffer.alloc(44 + 8000 * 2 * 4);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(Math.round(1000 * Math.sin((i - 44) / 2 * 2 * Math.PI * 220 / 8000)), i);
const flow = { schemaVersion: 2, title: 'Audio buffering regression', globalAudioLayers: [
    { src: 'audio/music.wav', volume: 0.2, allSlides: true, loop: true }
], slides: [
    { text: 'First', transition: 'none', audioLayers: [{ src: 'speech/voice.wav' }, { src: 'audio/music.wav', volume: 0.1 }] },
    { text: 'Second', transition: 'none', audioLayers: [{ src: 'audio/second.wav' }] },
    { text: 'Third', transition: 'none', seconds: 60 }
] };
let server;
app.whenReady().then(async () => {
    let slow = false, fail = false;
    const requests = [];
    const html = buildPlayer(flow);
    server = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/jump') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(req.url === '/jump' ? html.replace(/"preloadAheadSlides":\d+/, '"preloadAheadSlides":0') : html);
            return;
        }
        if (!req.url.includes('.wav')) { res.writeHead(404); res.end(); return; }
        requests.push(req.url);
        if (fail && req.url.includes('voice.wav')) { res.writeHead(503); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'private, no-store' });
        if (!slow) { res.end(wav); return; }
        // Complete download takes over the old 15s timeout. Each parallel
        // response is deliberately slower than this file's playback bitrate.
        let offset = 0;
        const timer = setInterval(() => {
            const end = Math.min(wav.length, offset + 2000);
            res.write(wav.subarray(offset, end)); offset = end;
            if (offset === wav.length) { clearInterval(timer); res.end(); }
        }, 500);
        res.on('close', () => clearInterval(timer));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    function browser() {
        const win = new BrowserWindow({ show: false, webPreferences: { partition: `audio-${Math.random()}`, sandbox: true,
            contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        const js = text => win.webContents.executeJavaScript(text, true);
        const until = async (text, limit = 25000) => {
            const deadline = Date.now() + limit;
            while (Date.now() < deadline) { if (await js(text)) return; await sleep(25); }
            throw Error(`Timed out: ${text}`);
        };
        return { win, js, until };
    }
    const ready = "document.getElementById('maxLabel').textContent === '3' && document.getElementById('captionText').textContent === 'First'";
    for (const mode of ['normal', 'slow', 'file']) {
        slow = mode === 'slow'; requests.length = 0;
        const { win, js, until } = browser();
        if (mode === 'file') {
            fs.mkdirSync(path.join(fixture, 'speech'), { recursive: true }); fs.mkdirSync(path.join(fixture, 'audio'), { recursive: true });
            for (const relative of ['speech/voice.wav', 'audio/music.wav', 'audio/second.wav']) fs.writeFileSync(path.join(fixture, relative), wav);
            fs.writeFileSync(path.join(fixture, 'player.html'), html);
            await win.loadFile(path.join(fixture, 'player.html'));
        } else await win.loadURL(origin);
        if (slow) {
            await sleep(15500);
            assert.equal(await js("document.getElementById('startBtn').disabled"), true, 'partial audio must not release Start after 15 seconds');
        }
        await until(ready);
        const loadedRequests = requests.length;
        if (mode !== 'file') assert.equal(loadedRequests, 3, 'shared audio layer/global music downloads once');
        await js(`window.testAudio=[]; const OriginalAudio=window.Audio;
            window.Audio=function(...args){const a=new OriginalAudio(...args);testAudio.push(a);return a;};
            window.Audio.prototype=OriginalAudio.prototype;
            window.audioEvents=[]; const a=document.getElementById('speech');
            for(const name of ['playing','waiting','ended'])a.addEventListener(name,()=>audioEvents.push({name,time:a.currentTime,at:performance.now()}));
            window.startedAt=performance.now(); document.getElementById('startBtn').click();`);
        await until("document.getElementById('speech').currentTime > 0.2");
        assert.equal(await js("testAudio.length === 2 && testAudio.every(a=>!a.paused && a.currentTime>0)"), true, 'secondary audio and global music both play');
        assert.ok(await js("audioEvents.find(e=>e.name==='playing').at-startedAt < 500"), mode + ' starts from prepared audio promptly');
        await js("document.getElementById('playPauseBtn').click()");
        assert.equal(await js("document.getElementById('speech').paused"), true);
        assert.equal(await js("testAudio.every(a=>a.paused)"), true, 'pause includes all layers and music');
        await sleep(150);
        await js("document.getElementById('playPauseBtn').click()");
        await until("document.getElementById('speech').currentTime > 0.3 && !document.getElementById('speech').paused");
        await until("document.getElementById('posLabel').textContent === '2'", 7000);
        assert.ok(await js("audioEvents.some(e=>e.name==='ended'&&e.time >= 3.9)"), 'narration finishes before auto advance');
        await until("document.getElementById('speech').currentTime > 0.3");
        assert.equal(await js("testAudio.some(a=>a.loop && !a.paused && a.currentTime>0)"), true, 'music continues on the next slide');
        assert.equal(await js("audioEvents.filter(e=>e.name==='waiting'&&e.time>0.05).length"), 0, mode + ' no mid-audio buffering');
        if (mode !== 'file') assert.equal(requests.length, loadedRequests, 'playback/resume does not refetch no-store media');
        await js("document.getElementById('prevBtn').click()");
        await until("document.getElementById('posLabel').textContent === '1'");
        assert.equal(await js("document.getElementById('speech').paused"), true);
        console.log(`AUDIO_${mode.toUpperCase()}_OK complete preload, speech, audio, shared music, pause/resume, ended, previous, no duplicate download`);
        win.destroy();
    }
    // Navigating outside the prepared window must wait, and stale downloads
    // must not restart playback after Pause or Previous.
    slow = false;
    {
        const { win, js, until } = browser();
        await win.loadURL(origin + '/jump'); await until(ready);
        await js("document.getElementById('startBtn').click()");
        await until("document.getElementById('speech').currentTime > 0.1");
        slow = true;
        await js("document.getElementById('nextBtn').click()");
        await until("document.getElementById('posLabel').textContent === '2'");
        await js("document.getElementById('playPauseBtn').click()");
        await until("document.getElementById('status').textContent.includes('Loading audio')");
        await js("document.getElementById('playPauseBtn').click(); document.getElementById('prevBtn').click()");
        await sleep(18000);
        assert.equal(await js("document.getElementById('speech').paused"), true);
        assert.equal(await js("document.getElementById('posLabel').textContent"), '1');
        await js("document.getElementById('playPauseBtn').click()");
        await until("document.getElementById('speech').currentTime > 0.1");
        win.destroy();
        console.log('AUDIO_PENDING_NAVIGATION_OK pause/previous cancels stale playback');
    }
    // A network failure remains recoverable instead of silently skipping speech.
    slow = false; fail = true;
    const { win, js, until } = browser();
    await win.loadURL(origin); await until(ready);
    await js("document.getElementById('startBtn').click()");
    await until("document.getElementById('status').textContent.includes('retry')");
    assert.equal(await js("document.getElementById('posLabel').textContent"), '1');
    fail = false;
    await js("document.getElementById('playPauseBtn').click()");
    await until("document.getElementById('speech').currentTime>0.1");
    win.destroy();
    console.log('PLAYER_AUDIO_PRELOAD_OK');
    server.close(); app.exit(0);
}).catch(error => { console.error(error); server?.close(); app.exit(1); });
