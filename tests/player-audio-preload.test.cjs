const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');

function audioRuntime(fetch) {
    const source = fs.readFileSync(path.join(process.env.MOVEMENT_AUDIO_TEST_ROOT || path.join(__dirname, '..'), 'studio/player/player-runtime.js'), 'utf8');
    class Audio extends EventTarget {
        load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('canplaythrough'))); }
        removeAttribute() { this.src = ''; }
    }
    const context = vm.createContext({ Audio, URL, TypeError, document: { baseURI: 'https://movement.test/player.php' }, fetch,
        audioPreloadCache: new Map(), audioPreloadPromises: new Map(), PRELOAD_AHEAD_SLIDES: 1,
        state: { i: 2, slides: [], globalAudioLayers: [] } });
    for (const name of ['loadAudioPromise', 'preparedAudioSource', 'trimAudioPreloads', 'isGlobalAudioActiveOnSlide']) {
        const start = source.indexOf('    function ' + name + '(');
        assert.ok(start >= 0);
        vm.runInContext(source.slice(start, source.indexOf('\n    }', start) + 6), context);
    }
    return context;
}

test('audio preload waits for the complete body and shares concurrent requests', async () => {
    let finish, downloads = 0;
    const body = new Promise(resolve => { finish = resolve; });
    const runtime = audioRuntime(async () => { downloads++; return { ok: true, blob: () => body }; });
    let ready = false;
    const first = runtime.loadAudioPromise('/speech/voice.wav').then(source => { ready = true; return source; });
    const second = runtime.loadAudioPromise('/speech/voice.wav');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false);
    assert.equal(downloads, 1);
    finish(new Blob(['audio'], { type: 'audio/wav' }));
    const source = await first;
    assert.equal(await second, source);
    assert.match(source, /^blob:/);
    assert.equal(runtime.preparedAudioSource('/speech/voice.wav'), source);
    URL.revokeObjectURL(source);
});

test('failed private media is not cached as ready and can be retried', async () => {
    let fail = true, downloads = 0;
    const runtime = audioRuntime(async () => { downloads++; return { ok: !fail, blob: async () => new Blob(['audio']) }; });
    await assert.rejects(runtime.loadAudioPromise('/speech/voice.wav'), /downloaded/);
    assert.equal(runtime.audioPreloadCache.size, 0);
    fail = false;
    const source = await runtime.loadAudioPromise('/speech/voice.wav');
    assert.equal(downloads, 2);
    URL.revokeObjectURL(source);
});

test('external audio without CORS keeps native playback compatibility', async () => {
    const runtime = audioRuntime(async () => { throw new TypeError('CORS'); });
    const url = 'https://external.test/audio.wav';
    assert.equal(await runtime.loadAudioPromise(url), url);
    await assert.rejects(runtime.loadAudioPromise('/speech/private.wav'), /CORS/);
});

test('audio memory window retains current, previous, upcoming and active global tracks', () => {
    const runtime = audioRuntime(() => {});
    runtime.state.slides = [0, 1, 2, 3, 4].map(index => ({ audioLayers: [{ src: `clip${index}` }] }));
    runtime.state.globalAudioLayers = [{ src: 'music', allSlides: true }];
    for (const url of ['clip0', 'clip1', 'clip2', 'clip3', 'clip4', 'music']) {
        runtime.audioPreloadCache.set(url, { source: url }); runtime.audioPreloadPromises.set(url, Promise.resolve(url));
    }
    runtime.trimAudioPreloads();
    assert.deepEqual([...runtime.audioPreloadCache.keys()], ['clip1', 'clip2', 'clip3', 'music']);
    assert.equal(runtime.audioPreloadPromises.has('clip0'), false);
});

test('player reuses complete audio on normal/slow connections and preserves offline playback', {
    skip: process.env.MOVEMENT_TEST_AUDIO_BROWSER !== '1', timeout: 150000
}, () => {
    const root = path.resolve(__dirname, '..');
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-audio-preload-'));
    try {
        const environment = { ...process.env };
        delete environment.ELECTRON_RUN_AS_NODE;
        const result = spawnSync(require('electron'), [path.join(__dirname, 'fixtures/player-audio-preload-browser.cjs'), fixture], {
            cwd: root, env: environment, windowsHide: true, encoding: 'utf8', timeout: 140000
        });
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /PLAYER_AUDIO_PRELOAD_OK/);
        console.log(result.stdout.trim());
    } finally {
        assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
        assert.ok(path.basename(fixture).startsWith('movement-audio-preload-'));
        fs.rmSync(fixture, { recursive: true, force: true });
    }
});
