const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../studio/maker/maker-engine.js'), 'utf8');

function bootMaker({ desktop = false, config = null, standalone = false, search = '' } = {}) {
  const elements = new Map();
  for (const id of ['media-library-modal', 'img1Input', 'img2Input', 'overrideLabel',
    'overrideLabel2', 'makerMediaImportBtn', 'slideshowInput', 'framesInput']) {
    elements.set(id, {
      id, style: {}, listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); }
    });
  }
  const requests = [];
  const previews = [];
  const imports = [];
  const mediaUrl = name => '/media.php?p=user/story/img/' + name.replace(/^img\//, '');
  const top = {
    PROJECT_CONTEXT: { desktopMode: desktop, csrfToken: 'test-token' },
    MAKER_ENDPOINT: '/json-maker.php?project=story',
    getMakerMediaList: async () => [],
    resolveMakerMediaUrl: (_type, name) => desktop
      ? 'movement-project://workspace/story/img/' + name.replace(/^img\//, '')
      : mediaUrl(name),
    // The web editor also exposes this function; presence alone is not capability.
    importDesktopMediaForMaker: async type => {
      imports.push(type);
      if (!desktop) throw new Error('Desktop media importing is unavailable.');
      return { filename: 'chosen.webp', url: 'movement-project://workspace/story/img/chosen.webp' };
    }
  };
  const window = {
    top, location: { protocol: 'http:', search }, addEventListener() {},
    MakerAPI: {
      loadEditConfig(value) {
        previews.push([window.img1Data || value.imgSrc, window.img2Data || value.imgSrc2]);
      },
      run() { previews.push([window.img1Data, window.img2Data]); }
    }
  };
  if (standalone) window.top = window;
  let ready;
  const context = {
    window, URLSearchParams, FormData, console,
    sessionStorage: { getItem: () => config ? JSON.stringify({ config }) : null },
    document: {
      getElementById: id => elements.get(id) || null,
      addEventListener: (_type, listener) => { ready = listener; }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        blob: async () => ({}),
        json: async () => ({ status: 'success', filename: 'uploaded.webp' })
      };
    },
    FileReader: class {
      readAsDataURL() { this.onload({ target: { result: 'data:image/webp;base64,AAAA' } }); }
    },
    alert(message) { throw new Error(message); }
  };
  vm.runInNewContext(source, context);
  ready();
  return { window, elements, requests, previews, imports, mediaUrl };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('web makers keep the browser picker and upload to the project endpoint', async () => {
  const maker = bootMaker();
  const input = maker.elements.get('img1Input');
  assert.equal(input.listeners.has('click'), false);
  assert.equal(input.listeners.has('change'), true);
  assert.equal(maker.elements.get('img2Input').listeners.has('click'), false);
  assert.equal(maker.elements.get('slideshowInput').listeners.has('click'), false);
  assert.equal(maker.elements.get('framesInput').listeners.has('click'), false);
  assert.equal(maker.elements.get('makerMediaImportBtn').listeners.has('click'), false);
  input.listeners.get('change')({ target: { files: [new Blob(['image'])] } });
  await flush();
  assert.equal(maker.imports.length, 0);
  assert.equal(maker.requests[0].url, '/json-maker.php?project=story');
  assert.equal(maker.requests[0].options.body.get('action'), 'upload_media');
  assert.equal(maker.requests[0].options.body.get('csrf_token'), 'test-token');
  assert.equal(maker.window.name1, 'uploaded.webp');
});

test('desktop makers still use native project media importing', async () => {
  const maker = bootMaker({ desktop: true });
  const input = maker.elements.get('img1Input');
  assert.equal(input.listeners.has('change'), false);
  let prevented = false;
  await input.listeners.get('click')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(maker.imports, ['img']);
  assert.equal(maker.window.name1, 'chosen.webp');
  assert.equal(maker.requests[0].url, 'movement-project://workspace/story/img/chosen.webp');
});

test('edit preview uses preloaded sources before asynchronous image conversion completes', async () => {
  const maker = bootMaker({
    search: '?mode=edit&img=view1.webp',
    config: { imgSrc: 'img/view1.webp', preloadedData1: 'blob:http://redhead.local/saved-image' }
  });
  assert.equal(maker.previews[0][0], 'blob:http://redhead.local/saved-image');
  assert.equal(maker.requests[0].url, 'blob:http://redhead.local/saved-image');
  await flush();
  assert.equal(maker.window.img1Data, 'data:image/webp;base64,AAAA');
  assert.equal(maker.window.name1, 'view1.webp');
});

test('saved primary and secondary images resolve through the web project before edit hydration', async () => {
  const maker = bootMaker({
    search: '?mode=edit&img=slide.webp&imgUrl=%2Fmedia.php%3Fp%3Duser%2Fstory%2Fimg%2Fslide.webp',
    config: { imgSrc: 'img/view1.webp', imgSrc2: 'img/view2.webp' }
  });
  assert.deepEqual(maker.previews[0], [maker.mediaUrl('view1.webp'), maker.mediaUrl('view2.webp')]);
  assert.deepEqual(maker.requests.map(request => request.url), maker.previews[0]);
  await flush();
  assert.equal(maker.window.name1, 'view1.webp');
  assert.equal(maker.window.name2, 'view2.webp');
});

test('desktop edit hydration retains project protocol URLs', () => {
  const maker = bootMaker({ desktop: true, search: '?mode=edit', config: { imgSrc: 'img/view1.webp' } });
  assert.equal(maker.previews[0][0], 'movement-project://workspace/story/img/view1.webp');
});

test('a standalone maker uses the supplied project URL for its linked saved image', () => {
  const maker = bootMaker({
    standalone: true,
    search: '?mode=edit&img=view1.webp&imgUrl=%2Fmedia.php%3Fp%3Duser%2Fstory%2Fimg%2Fview1.webp',
    config: { imgSrc: 'img/view1.webp' }
  });
  assert.equal(maker.previews[0][0], maker.mediaUrl('view1.webp'));
});

test('standalone relative paths avoid duplicate img directories and retain data URLs', () => {
  const maker = bootMaker({
    standalone: true, search: '?mode=edit',
    config: { imgSrc: 'img/view1.webp', imgSrc2: 'data:image/webp;base64,BBBB' }
  });
  assert.equal(maker.previews[0][0], '/img/view1.webp');
  assert.equal(maker.previews[0][1], 'data:image/webp;base64,BBBB');
});
