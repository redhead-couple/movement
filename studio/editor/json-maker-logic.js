// --- State Management ---
const PROJECT_CONTEXT = window.PROJECT_CONTEXT || {};
const MAKER_ENDPOINT = PROJECT_CONTEXT.makerEndpoint || 'json-maker.php';
const DESKTOP_BRIDGE = window.movementDesktop || null;
const DESKTOP_MODE = !!PROJECT_CONTEXT.desktopMode;
// CSRF token emitted by json-maker.php into PROJECT_CONTEXT
function getCsrfToken() {
    return (window.PROJECT_CONTEXT && window.PROJECT_CONTEXT.csrfToken) || '';
}
const LOCAL_PREVIEW_STORAGE_KEY = PROJECT_CONTEXT.previewStorageKey || 'timelineJsonStudio.previewProject';
window.MAKER_ENDPOINT = MAKER_ENDPOINT;
const PLAYER_URL = PROJECT_CONTEXT.playerUrl || (DESKTOP_MODE ? '/studio/player/local-player.html' : 'index.php');
const IMG_BASE_URL = PROJECT_CONTEXT.imgBaseUrl || 'img/';
window.IMG_BASE_URL = IMG_BASE_URL;
const SPEECH_BASE_URL = PROJECT_CONTEXT.speechBaseUrl || 'speech/';
const AUDIO_BASE_URL = PROJECT_CONTEXT.audioBaseUrl || 'audio/';
const localAssetFiles = new Map();
const localAssetUrls = new Map();
let activeProjectAssetBase = '';
let desktopMediaVersion = Date.now();
let currentProjectMediaOverview = null;

let state = {
    title: "",
    description: "",
    openingImage: null, // File object or string filename
    defaultDuration: 5,
    globalAudioLayers: [],
    slides: []
};

let activeSlideIndex = 0;
let activeEffectTarget = null; // 'bg' or 'fg' - tracks which effect input opened the modal
let unsavedChanges = false; // Track if the user has made changes since last save/load
let pendingLocalPlayerPayload = null;
let activeProjectRevision = null;
let activePublicationState = { isPublished: false, publishedAt: null };

// Helper to mark changes
function markUnsaved() {
    unsavedChanges = true;
    const saveBtn = document.getElementById('saveProjectBtn');
    if (saveBtn && saveBtn.textContent === "Save Slideshow") {
        saveBtn.textContent = "* Save Slideshow"; // Visual indicator
    }
    const playBtn = document.getElementById('playSlideshowBtn');
    const playCurrentBtn = document.getElementById('playFromCurrentBtn');

    if (playBtn) {
        playBtn.style.backgroundColor = 'var(--danger)';
        playBtn.textContent = 'Save First to Play';
        playBtn.title = 'You have unsaved changes. Save the slideshow before playing.';
    }

    if (playCurrentBtn) {
        playCurrentBtn.style.backgroundColor = 'var(--danger)';
        playCurrentBtn.textContent = 'Save First to Play';
        playCurrentBtn.title = 'You have unsaved changes. Save the slideshow before playing.';
    }
}

// Helper to clear changes mark
function clearUnsaved() {
    unsavedChanges = false;
    const saveBtn = document.getElementById('saveProjectBtn');
    if (saveBtn && saveBtn.textContent === "* Save Slideshow") {
        saveBtn.textContent = "Save Slideshow";
    }
    const playBtn = document.getElementById('playSlideshowBtn');
    const playCurrentBtn = document.getElementById('playFromCurrentBtn');

    if (playBtn) {
        playBtn.style.backgroundColor = '#10b981'; // Original green
        playBtn.textContent = 'Play Slideshow';
        playBtn.title = 'Play the slideshow from the beginning';
    }

    if (playCurrentBtn) {
        playCurrentBtn.style.backgroundColor = '#3b82f6'; // Original blue
        playCurrentBtn.textContent = 'Play from Current Slide';
        playCurrentBtn.title = 'Play the slideshow starting from the current slide';
    }
}

// --- Utils ---
function getFileName(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') {
        if (isDirectAssetUrl(obj)) return obj;
        return obj.replace(/^(?:img|speech|audio)\//i, '');
    }
    if (obj instanceof File) return obj.name;
    return null;
}

function isDirectAssetUrl(src) {
    return typeof src === 'string' && (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('//'));
}

function normalizeLocalAssetKey(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/^\/+/, '');
}

function localAssetKeyFor(src, fallbackFolder = '') {
    const val = normalizeLocalAssetKey(src);
    if (!val || isDirectAssetUrl(val)) return '';
    if (val.startsWith('img/') || val.startsWith('speech/') || val.startsWith('audio/')) return val;
    return fallbackFolder ? `${fallbackFolder.replace(/\/+$/, '')}/${val}` : val;
}

function rememberLocalAsset(key, file) {
    const cleanKey = normalizeLocalAssetKey(key);
    if (!cleanKey || !file) return;
    localAssetFiles.set(cleanKey, file);
    localAssetFiles.set(cleanKey.toLowerCase(), file);
}

function getLocalAssetFile(src, fallbackFolder = '') {
    const key = localAssetKeyFor(src, fallbackFolder);
    if (!key) return null;
    return localAssetFiles.get(key) || localAssetFiles.get(key.toLowerCase()) || null;
}

function getLocalAssetUrl(src, fallbackFolder = '') {
    const file = getLocalAssetFile(src, fallbackFolder);
    if (!file) return '';
    const key = `${fallbackFolder}:${localAssetKeyFor(src, fallbackFolder)}`;
    if (!localAssetUrls.has(key)) {
        localAssetUrls.set(key, URL.createObjectURL(file));
    }
    return localAssetUrls.get(key);
}

function mediaSrcForFolder(src, folder) {
    if (!src) return '';
    if (typeof src === 'string' && isDirectAssetUrl(src)) return src;
    const name = getFileName(src);
    if (!name) return '';
    if (typeof src === 'string' && isDirectAssetUrl(src)) return src;
    return `${folder}/${name}`;
}

function resolveAudioPreviewUrl(src, layerIndex = 0) {
    if (!src) return '';
    if (src instanceof File) return URL.createObjectURL(src);
    const val = String(src).trim();
    if (isDirectAssetUrl(val)) return val;
    if (val.startsWith('speech/')) return buildMediaPreviewUrl(SPEECH_BASE_URL, val.slice(7));
    if (val.startsWith('audio/')) return buildMediaPreviewUrl(AUDIO_BASE_URL, val.slice(6));
    return buildMediaPreviewUrl(layerIndex === 0 ? SPEECH_BASE_URL : AUDIO_BASE_URL, val.replace(/^\/+/, ''));
}

function buildMediaPreviewUrl(baseUrl, filename) {
    if (!filename) return '';
    const folder = baseUrl === IMG_BASE_URL ? 'img' : (baseUrl === AUDIO_BASE_URL ? 'audio' : 'speech');
    const projectUrl = buildProjectAssetUrl(filename, folder);
    if (projectUrl) return projectUrl;
    const localUrl = getLocalAssetUrl(filename, folder);
    if (localUrl) return localUrl;
    const cleanBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const cleanName = String(filename)
        .replace(/^\/+/, '')
        .replace(new RegExp(`^${folder}/`, 'i'), '')
        .split('/')
        .map(encodePathPart)
        .join('/');
    return cleanBase + cleanName;
}

window.resolveMakerMediaUrl = function (type, filename) {
    const mediaType = type === 'audio' ? 'audio' : (type === 'speech' ? 'speech' : 'img');
    const baseUrl = mediaType === 'img' ? IMG_BASE_URL : (mediaType === 'audio' ? AUDIO_BASE_URL : SPEECH_BASE_URL);
    return buildMediaPreviewUrl(baseUrl, filename);
};

window.getMakerMediaList = async function (type) {
    const mediaType = type === 'audio' ? 'audio' : (type === 'speech' ? 'speech' : 'img');
    if (DESKTOP_MODE) {
        if (!DESKTOP_BRIDGE) throw new Error('The desktop bridge is unavailable.');
        return DESKTOP_BRIDGE.listProjectMedia(
            PROJECT_CONTEXT.workspaceId,
            PROJECT_CONTEXT.project,
            mediaType
        );
    }
    const formData = new FormData();
    formData.append('action', 'list_media');
    formData.append('csrf_token', getCsrfToken());
    const res = await fetch(MAKER_ENDPOINT, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'Could not scan media.');
    return mediaType === 'img' ? data.media.img : (mediaType === 'audio' ? data.media.audio : data.media.speech);
};

function encodePathPart(part) {
    try {
        return encodeURIComponent(decodeURIComponent(part));
    } catch (e) {
        return encodeURIComponent(part);
    }
}

function buildReplaceExistingMessage(files, fallbackMessage) {
    if (!Array.isArray(files) || files.length === 0) {
        return fallbackMessage || 'A file with this name already exists. Would you like to Replace it, or click Browse Lib to use the version already in your library?';
    }

    if (files.length === 1) {
        return `The file "${files[0]}" already exists.\n\nAre you sure you want to replace the existing file?`;
    }

    return `These files already exist:\n- ${files.join('\n- ')}\n\nAre you sure you want to replace the existing files?`;
}

async function postUploadWithConfirmation(file, replaceExisting = false, mediaKind = '') {
    if (DESKTOP_MODE) {
        throw new Error('Use the protected desktop Choose or Import New button to add media.');
    }
    const formData = new FormData();
    formData.append('action', 'upload_media');
    formData.append('file', file);
    formData.append('csrf_token', getCsrfToken());
    if (mediaKind) {
        formData.append('media_kind', mediaKind);
    }

    if (replaceExisting) {
        formData.append('replace_existing', '1');
    }

    const res = await fetch(MAKER_ENDPOINT, { method: 'POST', body: formData });
    const text = await res.text();
    let data = {};
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.error('Non-JSON upload response:', text);
        if (text.includes('POST Content-Length') || res.status === 413) {
            data = { status: 'error', message: 'File is too large. Please upload an MP3 smaller than your server limits.' };
        } else {
            try { data = JSON.parse(text.slice(text.indexOf('{'))); } catch (e) { }
        }
    }

    if (data.status === 'needs_confirmation' && !replaceExisting) {
        const confirmed = window.confirm(buildReplaceExistingMessage(data.files, data.message));
        if (!confirmed) {
            return { cancelled: true, data };
        }
        return postUploadWithConfirmation(file, true, mediaKind);
    }

    return { res, data };
}

// Cache object URLs to avoid memory leaks
const urlCache = new WeakMap();
function getObjectUrl(file) {
    if (!file || !(file instanceof File)) {
        if (typeof file === 'string' && isDirectAssetUrl(file)) {
            return file;
        }
        if (typeof file === 'string') {
            const projectUrl = buildProjectAssetUrl(file, 'img');
            if (projectUrl) return projectUrl;
            const localUrl = getLocalAssetUrl(file, 'img');
            if (localUrl) return localUrl;
        }
        // If it's a string, attempt to show from img/ folder for preview purposes
        if (typeof file === 'string' && (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.webp') || file.endsWith('.jpeg'))) {
            return IMG_BASE_URL + getFileName(file);
        }
        return null;
    }
    if (urlCache.has(file)) return urlCache.get(file);
    const url = URL.createObjectURL(file);
    urlCache.set(file, url);
    return url;
}

function buildPlayerPreviewUrl(params = {}) {
    const url = new URL(PLAYER_URL, DESKTOP_MODE ? window.location.href : window.location.origin);
    url.searchParams.set('t', Date.now());
    url.searchParams.set('preview', 'editor');
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
    return DESKTOP_MODE ? url.href : url.pathname + url.search;
}

function encodePathForUrl(pathValue) {
    return normalizeLocalAssetKey(pathValue)
        .split('/')
        .filter(Boolean)
        .map(part => {
            try {
                return encodeURIComponent(decodeURIComponent(part));
            } catch (err) {
                return encodeURIComponent(part);
            }
        })
        .join('/');
}

function buildProjectAssetUrl(src, fallbackFolder = '') {
    if (!activeProjectAssetBase || !src || src instanceof File) return '';
    if (typeof src !== 'string' || isDirectAssetUrl(src)) return '';

    const val = normalizeLocalAssetKey(src);
    if (!val) return '';

    const relativePath = (val.startsWith('img/') || val.startsWith('speech/') || val.startsWith('audio/'))
        ? val
        : `${fallbackFolder.replace(/\/+$/, '')}/${val}`;

    const assetUrl = activeProjectAssetBase + encodePathForUrl(relativePath);
    return DESKTOP_MODE ? `${assetUrl}?v=${desktopMediaVersion}` : assetUrl;
}

async function chooseDesktopProjectMedia(type, targetInputId = '', assignToTarget = true) {
    if (!DESKTOP_MODE || !DESKTOP_BRIDGE || typeof DESKTOP_BRIDGE.chooseProjectMedia !== 'function') {
        throw new Error('Desktop media importing is unavailable.');
    }

    const result = await DESKTOP_BRIDGE.chooseProjectMedia(
        PROJECT_CONTEXT.workspaceId,
        PROJECT_CONTEXT.project,
        type
    );
    if (!result || result.cancelled) return { cancelled: true };
    if (result.status !== 'success' || !result.filename) {
        throw new Error('The selected media file could not be imported.');
    }

    desktopMediaVersion = Date.now();
    if (assignToTarget && targetInputId) {
        activeMediaLibType = type === 'img' ? 'img' : 'audio';
        activeMediaLibFolder = type;
        activeMediaLibTarget = targetInputId;
        window.selectMediaFromLib(result.filename);
    }

    if (els.saveStatus) {
        const action = result.disposition === 'replaced'
            ? 'Replaced'
            : (result.disposition === 'existing' ? 'Using existing' : 'Imported');
        els.saveStatus.textContent = `${action} ${result.filename}`;
        setTimeout(() => {
            if (els.saveStatus && els.saveStatus.textContent.includes(result.filename)) {
                els.saveStatus.textContent = '';
            }
        }, 4000);
    }
    return result;
}

window.chooseMediaForTarget = async function (type, targetInputId, browserInputId) {
    if (DESKTOP_MODE) {
        try {
            await chooseDesktopProjectMedia(type, targetInputId, true);
        } catch (error) {
            console.error('Desktop media import failed:', error);
            alert(error && error.message ? error.message : 'Could not import the selected media file.');
        }
        return;
    }
    const browserInput = document.getElementById(browserInputId);
    if (browserInput) browserInput.click();
};

window.importDesktopMediaForMaker = async function (type = 'img') {
    const result = await chooseDesktopProjectMedia(type, '', false);
    if (!result || result.cancelled) return result;
    return {
        ...result,
        url: buildProjectAssetUrl(result.filename, type)
    };
};

function openPlaybackModal(params = {}) {
    const pbModal = document.getElementById('playback-modal');
    const pbIframe = document.getElementById('playback-iframe');

    if (!pbModal || !pbIframe) return;

    if (DESKTOP_MODE) {
        let payload;
        try {
            payload = createLocalPlayerPayload();
        } catch (err) {
            alert(err && err.message ? err.message : 'Could not prepare offline playback media.');
            return;
        }
        pendingLocalPlayerPayload = payload;
        const sendPayload = () => {
            if (pbIframe.contentWindow) {
                pbIframe.contentWindow.postMessage(payload, '*');
            }
        };

        pbIframe.onload = sendPayload;
        pbIframe.src = buildPlayerPreviewUrl(params);
        pbModal.style.display = 'block';

        setTimeout(sendPayload, 200);
        return;
    }

    pbIframe.src = buildPlayerPreviewUrl(params);
    pbModal.style.display = 'block';
}

function buildLocalAwareUrl(path) {
    if (window.location.protocol === 'file:') {
        return new URL(path.replace(/^\/+/, ''), new URL('../../', window.location.href));
    }
    return new URL(path, window.location.origin);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

// --- DOM Elements ---
const els = {
    // Top config
    title: document.getElementById('projectTitle'),
    description: document.getElementById('projectDescription'),
    openImgInput: document.getElementById('openingImageInput'),
    openImgPreview: document.getElementById('openingImagePreview'),
    openImgPlaceholder: document.getElementById('openingImagePlaceholder'),
    defDuration: document.getElementById('defaultDuration'),
    globalAudioLayersList: document.getElementById('globalAudioLayersList'),
    addGlobalAudioLayerBtn: document.getElementById('addGlobalAudioLayerBtn'),

    // Timeline
    timeline: document.getElementById('timelineContainer'),
    addSlideBtn: document.getElementById('addSlideBtn'),

    // Editor
    editorHeader: document.getElementById('editorHeader'),
    editorContent: document.getElementById('editorContent'),
    slideText: document.getElementById('editSlideText'),

    bgInput: document.getElementById('editBgInput'),
    bgName: document.getElementById('editBgName'),
    fgInput: document.getElementById('editFgInput'),
    fgName: document.getElementById('editFgName'),
    audioInput: document.getElementById('editAudioInput'),
    audioName: document.getElementById('editAudioName'),
    audioVolume: document.getElementById('editAudioVolume'),
    audioVolumeValue: document.getElementById('editAudioVolumeValue'),
    audioLayersList: document.getElementById('audioLayersList'),
    addAudioLayerBtn: document.getElementById('addAudioLayerBtn'),
    foregroundLayersList: document.getElementById('foregroundLayersList'),
    addForegroundLayerBtn: document.getElementById('addForegroundLayerBtn'),

    duration: document.getElementById('editDuration'),
    transition: document.getElementById('editTransition'),
    transitionAdvancedName: document.getElementById('transitionAdvancedName'),
    transitionHubBtn: document.getElementById('transitionHubBtn'),
    transitionEditBtn: document.getElementById('transitionEditBtn'),
    transitionJsonBtn: document.getElementById('transitionJsonBtn'),
    transitionClearBtn: document.getElementById('transitionClearBtn'),

    bgEffect: document.getElementById('editBgEffect'),
    fgEffect: document.getElementById('editFgEffect'),

    duplicateBtn: document.getElementById('duplicateSlideBtn'),
    delBtn: document.getElementById('deleteSlideBtn'),

    // Preview
    previewBg: document.getElementById('previewBg'),
    previewFg: document.getElementById('previewFg'),
    previewPlaceholder: document.getElementById('previewPlaceholder'),

    // Global Actions
    saveBtn: document.getElementById('saveProjectBtn'),
    exportBtn: document.getElementById('exportJsonBtn'),
    saveStatus: document.getElementById('saveStatus'),
    projectMediaBtn: document.getElementById('openProjectMediaManagerBtn'),

    // Effects modal
    modal: document.getElementById('effects-modal'),
    iframe: document.getElementById('effects-iframe'),

    // Transitions modal
    transitionsModal: document.getElementById('transitions-modal'),
    transitionsIframe: document.getElementById('transitions-iframe'),

    // Effect Edit modal
    editModal: document.getElementById('effect-edit-modal'),
    editName: document.getElementById('effectEditName'),
    editJson: document.getElementById('effectEditJson'),
    editError: document.getElementById('effectEditError')
};

window.renderOpeningImagePreview = function () {
    if (!els.openImgPreview || !els.openImgPlaceholder) return;

    if (state.openingImage) {
        els.openImgPreview.style.display = 'block';
        els.openImgPlaceholder.style.display = 'none';

        let url;
        if (state.openingImage instanceof File) {
            url = getObjectUrl(state.openingImage);
        } else if (typeof state.openingImage === 'string') {
            url = getObjectUrl(state.openingImage) || (isDirectAssetUrl(state.openingImage) ? state.openingImage : IMG_BASE_URL + state.openingImage);
        }

        if (url) {
            els.openImgPreview.src = url;
        }
    } else {
        els.openImgPreview.style.display = 'none';
        els.openImgPlaceholder.style.display = 'block';
        els.openImgPlaceholder.textContent = 'No Image';
        els.openImgPreview.src = '';
    }
};

// --- Initialization ---
function init() {
    bindGlobalEvents();
    bindEditorEvents();
    addSlide(); // Start with 1 empty slide
    renderAll();
}

function createEmptySlide() {
    return {
        text: "",
        bgImage: null,
        fgImage: null,
        foregroundLayers: [],
        audio: null,
        audioLayers: [],
        duration: null,
        bgEffect: null, // Will store {name: "morph-effect", json: {...}}
        fgEffect: null,
        transition: "fade",
        transitionDraft: createDefaultTransitionDraft()
    };
}

function createDefaultTransitionDraft() {
    return {
        version: 1,
        enabled: false,
        name: '',
        engine: 'soft-wipe',
        direction: 'left',
        duration: 1,
        easing: 'ease',
        intensity: 0.5
    };
}

function normalizeTransitionDraft(slide) {
    if (!slide) return createDefaultTransitionDraft();
    const raw = slide.transitionDraft && typeof slide.transitionDraft === 'object' ? slide.transitionDraft : {};
    const draft = {
        ...createDefaultTransitionDraft(),
        ...raw
    };

    draft.enabled = !!draft.enabled;
    draft.name = typeof draft.name === 'string' ? draft.name : '';
    draft.engine = typeof draft.engine === 'string' && draft.engine ? draft.engine : 'soft-wipe';
    draft.direction = typeof draft.direction === 'string' && draft.direction ? draft.direction : 'left';
    draft.duration = Math.max(0.1, Math.min(10, Number(draft.duration) || 1));
    draft.easing = typeof draft.easing === 'string' && draft.easing ? draft.easing : 'ease';
    draft.intensity = Math.max(0, Math.min(1, Number(draft.intensity) || 0));

    slide.transitionDraft = draft;
    return draft;
}

function normalizeAudioLayersForSlide(slide) {
    if (!slide) return [];

    if (!Array.isArray(slide.audioLayers)) {
        slide.audioLayers = [];
    }

    if (slide.audio && slide.audioLayers.length === 0) {
        slide.audioLayers.push({ name: 'Speech', src: slide.audio, volume: 1 });
    }

    slide.audioLayers = slide.audioLayers.map((layer, index) => ({
        name: layer && layer.name ? layer.name : (index === 0 ? 'Speech' : `Audio ${index + 1}`),
        src: layer ? (layer.src || null) : null,
        volume: Math.max(0, Math.min(1, Number(layer && layer.volume != null ? layer.volume : 1)))
    }));

    slide.audio = slide.audioLayers[0] ? slide.audioLayers[0].src : null;
    return slide.audioLayers;
}

function getAudioLayer(slide, index) {
    const layers = normalizeAudioLayersForSlide(slide);
    while (layers.length <= index) {
        layers.push({ name: index === 0 ? 'Speech' : `Audio ${index + 1}`, src: null, volume: 1 });
    }
    slide.audio = layers[0] ? layers[0].src : null;
    return layers[index];
}

function setAudioLayerValue(index, patch) {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;

    const layer = getAudioLayer(slide, index);
    Object.assign(layer, patch);
    if (index === 0) slide.audio = layer.src || null;
    markUnsaved();
    renderTimeline();
}

function normalizeGlobalAudioLayers() {
    if (!Array.isArray(state.globalAudioLayers)) {
        state.globalAudioLayers = [];
    }

    state.globalAudioLayers = state.globalAudioLayers.map((layer, index) => ({
        name: layer && layer.name ? layer.name : `Global Audio ${index + 1}`,
        src: layer ? (layer.src || null) : null,
        volume: Math.max(0, Math.min(1, Number(layer && layer.volume != null ? layer.volume : 1))),
        allSlides: layer ? layer.allSlides !== false : true,
        startSlide: layer && layer.startSlide ? Math.max(1, parseInt(layer.startSlide, 10) || 1) : 1,
        endSlide: layer && layer.endSlide ? Math.max(1, parseInt(layer.endSlide, 10) || 1) : null,
        loop: layer ? layer.loop !== false : true
    }));

    return state.globalAudioLayers;
}

function setGlobalAudioLayerValue(index, patch) {
    const layers = normalizeGlobalAudioLayers();
    while (layers.length <= index) {
        layers.push({ name: `Global Audio ${layers.length + 1}`, src: null, volume: 1, allSlides: true, startSlide: 1, endSlide: null, loop: true });
    }
    layers[index] = { ...layers[index], ...patch };
    markUnsaved();
}

function normalizeForegroundLayersForSlide(slide) {
    if (!slide) return [];

    if (!Array.isArray(slide.foregroundLayers)) {
        slide.foregroundLayers = [];
    }

    if ((slide.fgImage || slide.fgEffect) && slide.foregroundLayers.length === 0) {
        slide.foregroundLayers.push({
            name: 'Foreground 1',
            src: slide.fgImage || null,
            effect: slide.fgEffect || null
        });
    }

    slide.foregroundLayers = slide.foregroundLayers.map((layer, index) => ({
        name: layer && layer.name ? layer.name : `Foreground ${index + 1}`,
        src: layer ? (layer.src || null) : null,
        effect: layer ? (layer.effect || null) : null
    }));

    const firstLayer = slide.foregroundLayers[0] || null;
    slide.fgImage = firstLayer ? firstLayer.src : null;
    slide.fgEffect = firstLayer ? firstLayer.effect : null;
    return slide.foregroundLayers;
}

function getForegroundLayer(slide, index) {
    const layers = normalizeForegroundLayersForSlide(slide);
    while (layers.length <= index) {
        layers.push({ name: `Foreground ${layers.length + 1}`, src: null, effect: null });
    }
    const firstLayer = layers[0] || null;
    slide.fgImage = firstLayer ? firstLayer.src : null;
    slide.fgEffect = firstLayer ? firstLayer.effect : null;
    return layers[index];
}

function setForegroundLayerValue(index, patch) {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;

    const layer = getForegroundLayer(slide, index);
    Object.assign(layer, patch);
    if (index === 0) {
        slide.fgImage = layer.src || null;
        slide.fgEffect = layer.effect || null;
    }
    markUnsaved();
    renderTimeline();
}

function parseForegroundTarget(target) {
    if (target === 'fg') return 0;
    if (typeof target === 'string' && target.startsWith('fg:')) {
        const index = parseInt(target.slice(3), 10);
        return Number.isFinite(index) ? index : 0;
    }
    return 0;
}

function getForegroundTargetLayer(target) {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return null;
    return getForegroundLayer(slide, parseForegroundTarget(target));
}

// --- Event Binding ---
function bindGlobalEvents() {
    els.title.addEventListener('input', e => { state.title = e.target.value; markUnsaved(); });
    els.description.addEventListener('input', e => { state.description = e.target.value; markUnsaved(); });

    els.openImgInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) {
            if (els.openImgPreview) els.openImgPreview.style.display = 'none';
            if (els.openImgPlaceholder) {
                els.openImgPlaceholder.style.display = 'block';
                els.openImgPlaceholder.textContent = 'Reading file...';
            }

            try {
                const { res, data, cancelled } = await postUploadWithConfirmation(file);
                if (cancelled) {
                    if (els.openImgPlaceholder) {
                        els.openImgPlaceholder.textContent = getFileName(state.openingImage) || 'No Image';
                    }
                    return;
                }
                if (res.ok && data.status === 'success') {
                    state.openingImage = file;
                    markUnsaved();
                } else {
                    alert(data.message || 'Could not read the selected file');
                }
            } catch (err) {
                console.error('File selection error', err);
                alert('Could not read the selected file. Check console.');
            }
            if (window.renderOpeningImagePreview) window.renderOpeningImagePreview();
        }
    });



    els.defDuration.addEventListener('input', e => { state.defaultDuration = parseFloat(e.target.value) || 5; markUnsaved(); });
    if (els.addGlobalAudioLayerBtn) {
        els.addGlobalAudioLayerBtn.addEventListener('click', () => {
            const layers = normalizeGlobalAudioLayers();
            layers.push({ name: `Global Audio ${layers.length + 1}`, src: null, volume: 1, allSlides: true, startSlide: 1, endSlide: null, loop: true });
            markUnsaved();
            renderGlobalAudioLayers();
        });
    }
    if (els.globalAudioLayersList) {
        els.globalAudioLayersList.addEventListener('input', handleGlobalAudioLayerInput);
        els.globalAudioLayersList.addEventListener('change', handleGlobalAudioLayerChange);
        els.globalAudioLayersList.addEventListener('click', handleGlobalAudioLayerClick);
    }

    els.addSlideBtn.addEventListener('click', () => { addSlide(); });
    if (els.addAudioLayerBtn) {
        els.addAudioLayerBtn.addEventListener('click', () => {
            const slide = state.slides[activeSlideIndex];
            if (!slide) return;
            const layers = normalizeAudioLayersForSlide(slide);
            if (layers.length === 0) {
                layers.push({ name: 'Speech', src: null, volume: 1 });
            }
            layers.push({ name: `Audio ${layers.length + 1}`, src: null, volume: 1 });
            markUnsaved();
            renderEditor();
            renderTimeline();
        });
    }
    if (els.audioLayersList) {
        els.audioLayersList.addEventListener('input', handleAudioLayerInput);
        els.audioLayersList.addEventListener('change', handleAudioLayerChange);
        els.audioLayersList.addEventListener('click', handleAudioLayerClick);
    }
    if (els.addForegroundLayerBtn) {
        els.addForegroundLayerBtn.addEventListener('click', () => {
            const slide = state.slides[activeSlideIndex];
            if (!slide) return;
            const layers = normalizeForegroundLayersForSlide(slide);
            layers.push({ name: `Foreground ${layers.length + 1}`, src: null, effect: null });
            markUnsaved();
            renderEditor();
            renderTimeline();
        });
    }
    if (els.foregroundLayersList) {
        els.foregroundLayersList.addEventListener('input', handleForegroundLayerInput);
        els.foregroundLayersList.addEventListener('change', handleForegroundLayerChange);
        els.foregroundLayersList.addEventListener('click', handleForegroundLayerClick);
    }
    els.saveBtn.addEventListener('click', saveProject);
    if (els.exportBtn && els.exportBtn.tagName === 'BUTTON') {
        els.exportBtn.addEventListener('click', () => {
            if (DESKTOP_MODE) {
                exportDesktopPortableProject();
            } else {
                downloadJSONOnly();
            }
        });
    }
    bindDesktopLibraryReturn();
    bindProjectMediaManagerEvents();

    // Play Slideshow action
    const playBtn = document.getElementById('playSlideshowBtn');
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (unsavedChanges) {
                alert("Please save your project first!");
                return;
            }

            openPlaybackModal();
        });
    }

    // Play from Current Slide action
    const playCurrentBtn = document.getElementById('playFromCurrentBtn');
    if (playCurrentBtn) {
        playCurrentBtn.addEventListener('click', () => {
            if (unsavedChanges) {
                alert("Please save your project first!");
                return;
            }

            openPlaybackModal({ startSlide: activeSlideIndex, autoPlay: 1 });
        });
    }

    // Add drag and drop to timeline
    els.timeline.addEventListener('dragover', handleDragOver);
    els.timeline.addEventListener('drop', handleDrop);

    // Listen for messages from Effects Hub iframe
    window.addEventListener('message', handleEffectMessage);
    window.addEventListener('message', handleTransitionMessage);
    window.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'local-player-ready' || !pendingLocalPlayerPayload) return;
        const pbIframe = document.getElementById('playback-iframe');
        if (pbIframe && pbIframe.contentWindow) {
            pbIframe.contentWindow.postMessage(pendingLocalPlayerPayload, '*');
        }
    });
    window.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'movement-editor-preview-ready') return;
        const pbIframe = document.getElementById('playback-iframe');
        if (!DESKTOP_MODE || !pbIframe || event.source !== pbIframe.contentWindow) return;
        DESKTOP_BRIDGE.reportReady({ surface: 'preview', workspaceCount: 0, projectCount: 1 });
    });
    window.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'movement-effects-hub-failed') return;
        if (!DESKTOP_MODE || !els.iframe || event.source !== els.iframe.contentWindow) return;
        DESKTOP_BRIDGE.reportReady({
            surface: 'effects',
            workspaceCount: 0,
            projectCount: 1,
            error: event.data.message || 'Effects Hub smoke test failed.'
        });
    });
    window.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'movement-open-registry-editor') return;
        const fromEffects = els.iframe && event.source === els.iframe.contentWindow;
        const fromTransitions = (
            els.transitionsIframe
            && event.source === els.transitionsIframe.contentWindow
        );
        if (!fromEffects && !fromTransitions) return;
        if (
            !DESKTOP_MODE
            || !DESKTOP_BRIDGE
            || typeof DESKTOP_BRIDGE.openRegistryEditor !== 'function'
        ) {
            alert('The integrated Registry Editor is available in the desktop edition.');
            return;
        }
        const registryType = event.data.registryType === 'transitions'
            ? 'transitions'
            : 'effects';
        DESKTOP_BRIDGE.openRegistryEditor(registryType).catch(error => {
            alert(error && error.message ? error.message : 'Could not open the Registry Editor.');
        });
    });
    window.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'movement-open-effect-prompt-builder') return;
        const fromEffects = els.iframe && event.source === els.iframe.contentWindow;
        if (!fromEffects) return;
        if (
            !DESKTOP_MODE
            || !DESKTOP_BRIDGE
            || typeof DESKTOP_BRIDGE.openEffectPromptBuilder !== 'function'
        ) {
            alert('The Effect Prompt Builder is available in the desktop edition.');
            return;
        }
        DESKTOP_BRIDGE.openEffectPromptBuilder().catch(error => {
            alert(error && error.message ? error.message : 'Could not open the Effect Prompt Builder.');
        });
    });
    window.addEventListener('message', event => {
        if (!event.data || event.data.type !== 'movement-open-transition-prompt-builder') return;
        const fromTransitions = (
            els.transitionsIframe
            && event.source === els.transitionsIframe.contentWindow
        );
        if (!fromTransitions) return;
        if (
            !DESKTOP_MODE
            || !DESKTOP_BRIDGE
            || typeof DESKTOP_BRIDGE.openTransitionPromptBuilder !== 'function'
        ) {
            alert('The Transition Prompt Builder is available in the desktop edition.');
            return;
        }
        DESKTOP_BRIDGE.openTransitionPromptBuilder().catch(error => {
            alert(
                error && error.message
                    ? error.message
                    : 'Could not open the Transition Prompt Builder.'
            );
        });
    });
    if (
        DESKTOP_MODE
        && DESKTOP_BRIDGE
        && typeof DESKTOP_BRIDGE.onRegistryChanged === 'function'
    ) {
        DESKTOP_BRIDGE.onRegistryChanged(details => {
            const registryType = details && details.type === 'transitions'
                ? 'transitions'
                : 'effects';
            const targetFrame = registryType === 'transitions'
                ? els.transitionsIframe
                : els.iframe;
            if (targetFrame && targetFrame.contentWindow) {
                targetFrame.contentWindow.postMessage({
                    type: 'movement-registry-changed',
                    registryType
                }, '*');
            }
        });
    }

    // Open existing JSON
    const openJsonInput = document.getElementById('openJsonInput');
    if (openJsonInput) {
        openJsonInput.addEventListener('change', handleOpenJSON);
    }
}

function bindEditorEvents() {
    const updateActive = (key, val) => {
        if (!state.slides[activeSlideIndex]) return;
        state.slides[activeSlideIndex][key] = val;
        markUnsaved();
        renderTimeline(); // Update preview in timeline
    };

    els.slideText.addEventListener('input', e => updateActive('text', e.target.value));
    els.duration.addEventListener('input', e => updateActive('duration', e.target.value ? parseFloat(e.target.value) : null));
    els.transition.addEventListener('change', e => updateActive('transition', e.target.value));
    bindTransitionDraftEvents();
    if (els.audioVolume) {
        els.audioVolume.addEventListener('input', e => {
            const volume = parseFloat(e.target.value);
            setAudioLayerValue(0, { volume: Number.isFinite(volume) ? volume : 1 });
            if (els.audioVolumeValue) els.audioVolumeValue.textContent = `${Math.round((Number.isFinite(volume) ? volume : 1) * 100)}%`;
        });
    }

    // File inputs (with immediate background upload)
    const handleFile = (inputEl, displayEl, stateKey, isImage) => {
        if (!inputEl || !displayEl) return;

        // File Selection Event
        inputEl.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (file) {
                const originalText = displayEl.value;
                displayEl.value = 'Reading file...';

                try {
                    const mediaKind = stateKey === 'audio' ? 'speech' : 'img';
                    const { res, data, cancelled } = await postUploadWithConfirmation(file, false, mediaKind);
                    if (cancelled) {
                        displayEl.value = originalText;
                        return;
                    }
                    if (res.ok && data.status === 'success') {
                        // Keep the local File object in state for drag & drop indexing, but we know it's on the server now
                        updateActive(stateKey, file);
                        if (stateKey === 'audio') {
                            setAudioLayerValue(0, { src: file, name: 'Speech' });
                        }
                        if (stateKey === 'fgImage') {
                            setForegroundLayerValue(0, { src: file, name: 'Foreground 1' });
                        }
                        displayEl.value = file.name;
                        if (isImage) updatePreview();
                    } else {
                        alert(data.message || 'Could not read the selected file');
                        displayEl.value = originalText;
                    }
                } catch (err) {
                    console.error('File selection error:', err);
                    alert('Could not read the selected file. Check console.');
                    displayEl.value = originalText;
                }
            }
        });

        // Manual Text Input Event (Allows user to type existing file names)
        displayEl.addEventListener('input', e => {
            if (!state.slides[activeSlideIndex]) return;
            const val = e.target.value.trim();

            // If the user hasn't actually changed the name of the file they just uploaded, don't destroy the File object!
            const currentItem = state.slides[activeSlideIndex][stateKey];
            if (currentItem instanceof File && currentItem.name === val) {
                return;
            }

            // Store as a string so the timeline knows it's an existing server file
            state.slides[activeSlideIndex][stateKey] = val || null;
            if (stateKey === 'audio') {
                setAudioLayerValue(0, { src: val || null, name: 'Speech' });
            }
            if (stateKey === 'fgImage') {
                setForegroundLayerValue(0, { src: val || null, name: 'Foreground 1' });
            }

            markUnsaved();
            renderTimeline();
            if (isImage) updatePreview();
        });
    };

    handleFile(els.bgInput, els.bgName, 'bgImage', true);
    handleFile(els.fgInput, els.fgName, 'fgImage', true);
    handleFile(els.audioInput, els.audioName, 'audio', false);

    if (els.duplicateBtn) {
        els.duplicateBtn.addEventListener('click', duplicateCurrentSlide);
    }

    els.delBtn.addEventListener('click', () => {
        if (state.slides.length <= 1) return alert('Cannot delete the last slide.');
        if (!confirm('Are you sure you want to delete this slide?')) return;
        state.slides.splice(activeSlideIndex, 1);
        activeSlideIndex = Math.max(0, activeSlideIndex - 1);
        markUnsaved();
        renderAll();
    });
}

function bindTransitionDraftEvents() {
    if (els.transitionHubBtn) els.transitionHubBtn.addEventListener('click', openTransitionsHub);
    if (els.transitionEditBtn) els.transitionEditBtn.addEventListener('click', openTransitionInHub);
    if (els.transitionJsonBtn) els.transitionJsonBtn.addEventListener('click', openTransitionJsonEditor);
    if (els.transitionClearBtn) {
        els.transitionClearBtn.addEventListener('click', clearTransitionDraft);
    }
}

function renderTransitionDraft() {
    const slide = state.slides[activeSlideIndex];
    if (!slide || !els.transitionAdvancedName) return;
    const draft = normalizeTransitionDraft(slide);

    els.transitionAdvancedName.value = draft.enabled
        ? (draft.name || transitionDraftLabel(draft.engine))
        : '';

    const hasAdvancedTransition = !!draft.enabled;
    if (els.transitionEditBtn) els.transitionEditBtn.style.display = hasAdvancedTransition ? 'inline-block' : 'none';
    if (els.transitionJsonBtn) els.transitionJsonBtn.style.display = hasAdvancedTransition ? 'inline-block' : 'none';
    if (els.transitionClearBtn) els.transitionClearBtn.style.display = hasAdvancedTransition ? 'inline-block' : 'none';
}

function transitionDraftLabel(value) {
    return String(value || '')
        .split('-')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Advanced';
}

// --- Audio Preview ---
let currentAudioPreview = null;

function legacyToggleAudioPreview(btnEl) {
    const slide = state.slides[activeSlideIndex];
    if (!slide || !slide.audio) return;

    if (currentAudioPreview && !currentAudioPreview.paused) {
        // Stop current playing audio
        currentAudioPreview.pause();
        currentAudioPreview.currentTime = 0;
        btnEl.textContent = 'Play';
        return;
    }

    // Prepare to play new audio
    let url;
    if (typeof slide.audio === 'string') {
        url = resolveAudioPreviewUrl(slide.audio, 0);
    } else {
        url = URL.createObjectURL(slide.audio);
    }

    currentAudioPreview = new Audio(url);

    currentAudioPreview.addEventListener('ended', () => {
        btnEl.textContent = 'Play';
    });

    btnEl.textContent = 'Play';
    currentAudioPreview.play().catch(e => {
        console.warn("Audio preview could not play:", url, e);
        btnEl.textContent = 'Play';
    });
}

window.toggleAudioPreview = function (btnEl, layerIndex = 0) {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;

    const layer = getAudioLayer(slide, layerIndex);
    if (!layer || !layer.src) return;

    const playLabel = layerIndex === 0 ? 'Play' : 'Play';
    const stopLabel = layerIndex === 0 ? 'Stop' : 'Stop';

    if (currentAudioPreview && !currentAudioPreview.paused) {
        currentAudioPreview.pause();
        currentAudioPreview.currentTime = 0;
        btnEl.textContent = playLabel;
        return;
    }

    const url = typeof layer.src === 'string'
        ? resolveAudioPreviewUrl(layer.src, layerIndex)
        : URL.createObjectURL(layer.src);

    if (!url) {
        btnEl.textContent = playLabel;
        return;
    }

    currentAudioPreview = new Audio(url);
    currentAudioPreview.volume = Math.max(0, Math.min(1, Number(layer.volume ?? 1)));
    currentAudioPreview.addEventListener('ended', () => {
        btnEl.textContent = playLabel;
    });

    btnEl.textContent = stopLabel;
    currentAudioPreview.play().catch(e => {
        console.warn("Audio preview could not play:", url, e);
        btnEl.textContent = playLabel;
    });
}

// --- Actions ---
function addSlide() {
    state.slides.push(createEmptySlide());
    activeSlideIndex = state.slides.length - 1;
    markUnsaved(); // Adding a slide is an unsaved change
    renderAll();
}

function cloneSlide(slide) {
    if (typeof structuredClone === 'function') {
        return structuredClone(slide);
    }

    if (slide instanceof File) return slide;
    if (Array.isArray(slide)) return slide.map(cloneSlide);
    if (slide && typeof slide === 'object') {
        return Object.fromEntries(Object.entries(slide).map(([key, value]) => [key, cloneSlide(value)]));
    }
    return slide;
}

function duplicateCurrentSlide() {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;

    const duplicatedSlide = cloneSlide(slide);
    state.slides.splice(activeSlideIndex + 1, 0, duplicatedSlide);
    activeSlideIndex += 1;
    markUnsaved();
    renderAll();
}

function selectSlide(index) {
    activeSlideIndex = index;
    renderTimeline(); // update active class
    renderEditor();

    // Scroll the right panel back to the top so the preview is visible
    if (els.editorHeader && els.editorHeader.nextElementSibling) {
        els.editorHeader.nextElementSibling.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// --- Rendering ---
function renderAll() {
    renderSettings();
    renderTimeline();
    renderEditor();
    renderGlobalAudioLayers();
}

function renderSettings() {
    els.title.value = state.title;
    els.description.value = state.description;
    if (window.renderOpeningImagePreview) window.renderOpeningImagePreview();
    els.defDuration.value = state.defaultDuration;
}

function renderTimeline() {
    els.timeline.innerHTML = '';
    state.slides.forEach((slide, idx) => {
        const audioLayers = normalizeAudioLayersForSlide(slide).filter(layer => layer.src);
        const item = document.createElement('div');
        item.className = `slide-item ${idx === activeSlideIndex ? 'active' : ''}`;
        item.draggable = true;

        // Drag events
        item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', idx);
            item.style.opacity = '0.5';
        });
        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
        });

        item.addEventListener('click', () => selectSlide(idx));

        // Use background image for thumbnail, or fallback to frontend image if it exists
        const foregroundPreview = normalizeForegroundLayersForSlide(slide).find(layer => layer.src);
        const previewUrl = getObjectUrl(slide.bgImage) || getObjectUrl(foregroundPreview ? foregroundPreview.src : slide.fgImage);

        item.innerHTML = `
            <div class="slide-thumb"></div>
            <div class="slide-info">
                <div style="display:flex; align-items:center;">
                    <span class="slide-index">${idx + 1}</span>
                    <span class="slide-text-preview">${slide.text ? escapeHtml(slide.text) : '<i>Empty slide</i>'}</span>
                </div>
                <div class="slide-icons">
                    ${slide.audio ? '<span>Audio</span>' : ''}


                </div>
            </div>
        `;
        if (previewUrl) {
            item.querySelector('.slide-thumb').style.backgroundImage = `url("${String(previewUrl)
                .replace(/["\\\n\r\f]/g, '\\$&')}")`;
        }
        els.timeline.appendChild(item);
    });
}

function renderEditor() {
    const slide = state.slides[activeSlideIndex];
    if (!slide) {
        els.editorContent.style.display = 'none';
        return;
    }
    const audioLayers = normalizeAudioLayersForSlide(slide);
    const primaryAudio = audioLayers[0] || { src: null, volume: 1 };
    const foregroundLayers = normalizeForegroundLayersForSlide(slide);
    const primaryForeground = foregroundLayers[0] || { src: null, effect: null };

    els.editorContent.style.display = 'block';
    els.editorHeader.textContent = `Edit Slide ${activeSlideIndex + 1}`;

    els.slideText.value = slide.text;
    els.bgName.value = getFileName(slide.bgImage) || '';
    if (els.fgName) els.fgName.value = getFileName(primaryForeground.src) || '';
    els.audioName.value = getFileName(primaryAudio.src) || '';
    if (els.audioVolume) els.audioVolume.value = primaryAudio.volume != null ? primaryAudio.volume : 1;
    if (els.audioVolumeValue) els.audioVolumeValue.textContent = `${Math.round((primaryAudio.volume != null ? primaryAudio.volume : 1) * 100)}%`;

    // Toggle Play Audio button visibility
    const playAudioBtn = document.getElementById('playAudioBtn');
    if (playAudioBtn) {
        playAudioBtn.style.display = primaryAudio.src ? 'inline-block' : 'none';

        // Reset button state in case audio was playing on another slide
        playAudioBtn.textContent = 'Play';
    }

    renderAudioLayers();

    els.duration.value = slide.duration || '';
    els.transition.value = slide.transition || 'fade';
    renderTransitionDraft();

    els.bgEffect.value = slide.bgEffect ? slide.bgEffect.name : '';
    if (els.fgEffect) els.fgEffect.value = primaryForeground.effect ? primaryForeground.effect.name : '';

    // Enable or disable the Edit buttons
    const hasBg = !!slide.bgEffect;
    const editBgBtn = document.getElementById('editBgBtn');
    const jsonBgBtn = document.getElementById('jsonBgBtn');
    const clearBgBtn = document.getElementById('clearBgBtn');

    if (editBgBtn) editBgBtn.style.display = hasBg ? 'inline-block' : 'none';
    if (jsonBgBtn) jsonBgBtn.style.display = hasBg ? 'inline-block' : 'none';
    if (clearBgBtn) clearBgBtn.style.display = hasBg ? 'inline-block' : 'none';

    const hasFg = !!primaryForeground.effect;
    const editFgBtn = document.getElementById('editFgBtn');
    const jsonFgBtn = document.getElementById('jsonFgBtn');
    const clearFgBtn = document.getElementById('clearFgBtn');

    if (editFgBtn) editFgBtn.style.display = hasFg ? 'inline-block' : 'none';
    if (jsonFgBtn) jsonFgBtn.style.display = hasFg ? 'inline-block' : 'none';
    if (clearFgBtn) clearFgBtn.style.display = hasFg ? 'inline-block' : 'none';

    renderForegroundLayers();
    updatePreview();
}

function renderGlobalAudioLayers() {
    if (!els.globalAudioLayersList) return;
    const layers = normalizeGlobalAudioLayers();
    els.globalAudioLayersList.innerHTML = '';

    layers.forEach((layer, index) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid; gap:10px; min-width:0; overflow:hidden; padding:10px; border:1px solid var(--border-color); border-radius:var(--app-radius-sm); background:rgba(255,255,255,0.04);';
        row.innerHTML = `
            <div style="display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px;">
                <strong style="font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(layer.name || `Global Audio ${index + 1}`)}">${escapeHtml(layer.name || `Global Audio ${index + 1}`)}</strong>
                <button class="btn outline" type="button" data-global-audio-action="remove" data-global-audio-index="${index}" style="width:auto; padding:6px 10px;">Remove</button>
            </div>
            <div style="display:grid; gap:8px; min-width:0;">
                <input type="text" id="globalAudioLayerName-${index}" data-global-audio-action="name" data-global-audio-index="${index}" value="${escapeHtml(getFileName(layer.src) || '')}" placeholder="No file selected" title="${escapeHtml(layer.src || '')}" style="width:100%; min-width:0;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; min-width:0;">
                    <button class="btn outline" type="button" data-global-audio-action="upload" data-global-audio-index="${index}" style="width:100%; min-width:0;">Choose Audio</button>
                    <button class="btn outline" type="button" data-global-audio-action="browse" data-global-audio-index="${index}" style="width:100%; min-width:0;">Browse Lib</button>
                </div>
                <input type="file" id="globalAudioLayerInput-${index}" data-global-audio-action="file" data-global-audio-index="${index}" accept="audio/*" style="display:none">
            </div>
            <div style="display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:8px; min-width:0;">
                <label style="margin:0;">Volume</label>
                <input type="range" data-global-audio-action="volume" data-global-audio-index="${index}" min="0" max="1" step="0.05" value="${layer.volume}" style="width:100%; min-width:0;">
                <span style="min-width:40px; color:var(--text-muted); font-size:0.85rem;">${Math.round(layer.volume * 100)}%</span>
            </div>
            <div style="display:grid; gap:8px; min-width:0;">
                <label style="margin:0; display:flex; align-items:center; gap:6px;"><input type="checkbox" data-global-audio-action="all" data-global-audio-index="${index}" ${layer.allSlides ? 'checked' : ''}> All slides</label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; min-width:0;">
                    <input type="number" data-global-audio-action="start" data-global-audio-index="${index}" min="1" step="1" value="${layer.startSlide || 1}" ${layer.allSlides ? 'disabled' : ''} style="width:100%; min-width:0;" title="Start slide">
                    <input type="number" data-global-audio-action="end" data-global-audio-index="${index}" min="1" step="1" value="${layer.endSlide || ''}" ${layer.allSlides ? 'disabled' : ''} placeholder="End" style="width:100%; min-width:0;" title="End slide">
                </div>
                <label style="margin:0; display:flex; align-items:center; gap:6px;"><input type="checkbox" data-global-audio-action="loop" data-global-audio-index="${index}" ${layer.loop ? 'checked' : ''}> Loop</label>
            </div>
        `;
        els.globalAudioLayersList.appendChild(row);
    });
}

function handleGlobalAudioLayerInput(e) {
    const target = e.target;
    if (!target || !target.dataset || !target.dataset.globalAudioAction) return;
    const index = parseInt(target.dataset.globalAudioIndex, 10);
    if (!Number.isFinite(index)) return;

    const action = target.dataset.globalAudioAction;
    if (action === 'name') {
        setGlobalAudioLayerValue(index, { src: target.value.trim() || null });
    }
    if (action === 'volume') {
        const volume = parseFloat(target.value);
        const safeVolume = Number.isFinite(volume) ? volume : 1;
        setGlobalAudioLayerValue(index, { volume: safeVolume });
        const valueLabel = target.nextElementSibling;
        if (valueLabel) valueLabel.textContent = `${Math.round(safeVolume * 100)}%`;
    }
    if (action === 'start') {
        setGlobalAudioLayerValue(index, { startSlide: Math.max(1, parseInt(target.value, 10) || 1) });
    }
    if (action === 'end') {
        setGlobalAudioLayerValue(index, { endSlide: target.value ? Math.max(1, parseInt(target.value, 10) || 1) : null });
    }
}

function handleGlobalAudioLayerChange(e) {
    const target = e.target;
    if (!target || !target.dataset || !target.dataset.globalAudioAction) return;
    const index = parseInt(target.dataset.globalAudioIndex, 10);
    if (!Number.isFinite(index)) return;

    const action = target.dataset.globalAudioAction;
    if (action === 'file') {
        const file = target.files && target.files[0];
        if (!file) return;
        uploadGlobalAudioLayerFile(index, file).finally(() => {
            target.value = '';
        });
    }
    if (action === 'all') {
        setGlobalAudioLayerValue(index, { allSlides: target.checked });
        renderGlobalAudioLayers();
    }
    if (action === 'loop') {
        setGlobalAudioLayerValue(index, { loop: target.checked });
    }
}

function handleGlobalAudioLayerClick(e) {
    const btn = e.target.closest('[data-global-audio-action]');
    if (!btn) return;
    const index = parseInt(btn.dataset.globalAudioIndex, 10);
    if (!Number.isFinite(index)) return;

    const action = btn.dataset.globalAudioAction;
    if (action === 'upload') {
        window.chooseMediaForTarget(
            'audio',
            `globalAudioLayerName-${index}`,
            `globalAudioLayerInput-${index}`
        );
    }
    if (action === 'browse') {
        openMediaLibrary('audio', `globalAudioLayerName-${index}`);
    }
    if (action === 'remove') {
        const layers = normalizeGlobalAudioLayers();
        layers.splice(index, 1);
        markUnsaved();
        renderGlobalAudioLayers();
    }
}

async function uploadGlobalAudioLayerFile(index, file) {
    try {
        const { res, data, cancelled } = await postUploadWithConfirmation(file, false, 'audio');
        if (cancelled) return;
        if (res.ok && data.status === 'success') {
            const filename = data.filename || file.name;
            setGlobalAudioLayerValue(index, { src: `audio/${filename}` });
            renderGlobalAudioLayers();
        } else {
            alert(data.message || 'Could not read the selected file');
        }
    } catch (err) {
        console.error('File selection error:', err);
        alert('Could not read the selected file. Check console.');
    }
}

function renderAudioLayers() {
    const slide = state.slides[activeSlideIndex];
    if (!slide || !els.audioLayersList) return;

    const layers = normalizeAudioLayersForSlide(slide);
    els.audioLayersList.innerHTML = '';

    layers.slice(1).forEach((layer, offset) => {
        const index = offset + 1;
        const row = document.createElement('div');
        row.style.cssText = 'display:grid; gap:8px; padding:10px; border:1px solid var(--border-color); border-radius:12px; background:rgba(255,255,255,0.04);';
        row.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <strong style="font-size:0.9rem;">${escapeHtml(layer.name || `Audio ${index + 1}`)}</strong>
                <button class="btn outline" type="button" data-audio-action="remove" data-audio-index="${index}" style="width:auto; padding:6px 10px;">Remove</button>
            </div>
            <div style="display:flex; gap:8px;">
                <input type="text" id="audioLayerName-${index}" data-audio-action="name" data-audio-index="${index}" value="${escapeHtml(getFileName(layer.src) || '')}" placeholder="No file selected" style="flex:1;">
                <button class="btn outline" type="button" data-audio-action="upload" data-audio-index="${index}" style="width:auto;">Choose Audio</button>
                <button class="btn outline" type="button" data-audio-action="browse" data-audio-index="${index}" style="width:auto;">Browse Lib</button>
                <button class="btn outline" type="button" data-audio-action="play" data-audio-index="${index}" style="${layer.src ? '' : 'display:none;'} width:auto; padding:8px 12px;">Play</button>
                <input type="file" id="audioLayerInput-${index}" data-audio-action="file" data-audio-index="${index}" accept="audio/*" style="display:none">
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <label style="margin:0; min-width:58px;">Volume</label>
                <input type="range" data-audio-action="volume" data-audio-index="${index}" min="0" max="1" step="0.05" value="${layer.volume != null ? layer.volume : 1}" style="flex:1;">
                <span style="min-width:40px; color:var(--text-muted); font-size:0.85rem;">${Math.round((layer.volume != null ? layer.volume : 1) * 100)}%</span>
            </div>
        `;
        els.audioLayersList.appendChild(row);
    });
}

function renderForegroundLayers() {
    const slide = state.slides[activeSlideIndex];
    if (!slide || !els.foregroundLayersList) return;

    const layers = normalizeForegroundLayersForSlide(slide);
    els.foregroundLayersList.innerHTML = '';

    layers.forEach((layer, index) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid; gap:8px; padding:10px; border:1px solid var(--border-color); border-radius:var(--app-radius-sm); background:rgba(255,255,255,0.04);';
        row.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <strong style="font-size:0.9rem;">Foreground Layer ${index + 1}</strong>
                <div style="display:flex; gap:6px;">
                    <button class="btn outline" type="button" data-fg-action="up" data-fg-index="${index}" style="width:auto; padding:6px 10px;">Up</button>
                    <button class="btn outline" type="button" data-fg-action="down" data-fg-index="${index}" style="width:auto; padding:6px 10px;">Down</button>
                    <button class="btn outline" type="button" data-fg-action="remove" data-fg-index="${index}" style="width:auto; padding:6px 10px;">Remove</button>
                </div>
            </div>
            <div style="display:flex; gap:8px;">
                <input type="text" id="foregroundLayerName-${index}" data-fg-action="name" data-fg-index="${index}" value="${escapeHtml(getFileName(layer.src) || '')}" placeholder="No file selected" style="flex:1;">
                <button class="btn outline" type="button" data-fg-action="upload" data-fg-index="${index}" style="width:auto;">Choose Image</button>
                <button class="btn outline" type="button" data-fg-action="browse" data-fg-index="${index}" style="width:auto;">Browse Lib</button>
                <input type="file" id="foregroundLayerInput-${index}" data-fg-action="file" data-fg-index="${index}" accept="image/*" style="display:none">
            </div>
            <div class="file-wrapper">
                <input type="text" value="${escapeHtml(layer.effect ? layer.effect.name : '')}" placeholder="No effect" readonly>
                <button class="btn outline" type="button" data-fg-action="edit-effect" data-fg-index="${index}" style="${layer.effect ? '' : 'display:none;'} width:auto;">Edit</button>
                <button class="btn outline" type="button" data-fg-action="hub" data-fg-index="${index}" style="width:auto;">Hub</button>
                <button class="btn outline" type="button" data-fg-action="json-effect" data-fg-index="${index}" style="${layer.effect ? '' : 'display:none;'} width:auto; padding:8px 12px;">JSON</button>
                <button class="btn outline" type="button" data-fg-action="clear-effect" data-fg-index="${index}" style="${layer.effect ? '' : 'display:none;'} width:auto;">X</button>
            </div>
        `;
        els.foregroundLayersList.appendChild(row);
    });
}

function handleForegroundLayerInput(e) {
    const target = e.target;
    if (!target || !target.dataset || target.dataset.fgAction !== 'name') return;

    const index = parseInt(target.dataset.fgIndex, 10);
    if (!Number.isFinite(index)) return;
    setForegroundLayerValue(index, { src: target.value.trim() || null });
    updatePreview();
}

function handleForegroundLayerChange(e) {
    const target = e.target;
    if (!target || !target.dataset || target.dataset.fgAction !== 'file') return;

    const index = parseInt(target.dataset.fgIndex, 10);
    const file = target.files && target.files[0];
    if (!Number.isFinite(index) || !file) return;

    uploadForegroundLayerFile(index, file).finally(() => {
        target.value = '';
    });
}

function handleForegroundLayerClick(e) {
    const btn = e.target.closest('[data-fg-action]');
    if (!btn) return;

    const index = parseInt(btn.dataset.fgIndex, 10);
    const action = btn.dataset.fgAction;
    if (!Number.isFinite(index)) return;

    if (action === 'upload') {
        window.chooseMediaForTarget(
            'img',
            `foregroundLayerName-${index}`,
            `foregroundLayerInput-${index}`
        );
    }

    if (action === 'browse') {
        openMediaLibrary('img', `foregroundLayerName-${index}`);
    }

    if (action === 'hub') {
        openEffectsHub(`fg:${index}`);
    }

    if (action === 'edit-effect') {
        openEffectInHub(`fg:${index}`);
    }

    if (action === 'json-effect') {
        openEffectEditor(`fg:${index}`);
    }

    if (action === 'clear-effect') {
        clearEffect(`fg:${index}`);
    }

    if (action === 'remove' || action === 'up' || action === 'down') {
        const slide = state.slides[activeSlideIndex];
        if (!slide) return;
        const layers = normalizeForegroundLayersForSlide(slide);

        if (action === 'remove') {
            layers.splice(index, 1);
        } else if (action === 'up' && index > 0) {
            [layers[index - 1], layers[index]] = [layers[index], layers[index - 1]];
        } else if (action === 'down' && index < layers.length - 1) {
            [layers[index + 1], layers[index]] = [layers[index], layers[index + 1]];
        }

        const firstLayer = layers[0] || null;
        slide.fgImage = firstLayer ? firstLayer.src : null;
        slide.fgEffect = firstLayer ? firstLayer.effect : null;
        markUnsaved();
        renderEditor();
        renderTimeline();
    }
}

async function uploadForegroundLayerFile(index, file) {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;

    try {
        const { res, data, cancelled } = await postUploadWithConfirmation(file, false, 'img');
        if (cancelled) return;
        if (res.ok && data.status === 'success') {
            setForegroundLayerValue(index, { src: file });
            renderEditor();
            updatePreview();
        } else {
            alert(data.message || 'Could not read the selected file');
        }
    } catch (err) {
        console.error('File selection error:', err);
        alert('Could not read the selected file. Check console.');
    }
}

function handleAudioLayerInput(e) {
    const target = e.target;
    if (!target || !target.dataset || !target.dataset.audioAction) return;

    const index = parseInt(target.dataset.audioIndex, 10);
    if (!Number.isFinite(index)) return;

    if (target.dataset.audioAction === 'name') {
        const value = target.value.trim();
        setAudioLayerValue(index, { src: value || null });
    }

    if (target.dataset.audioAction === 'volume') {
        const volume = parseFloat(target.value);
        const safeVolume = Number.isFinite(volume) ? volume : 1;
        setAudioLayerValue(index, { volume: safeVolume });
        const valueLabel = target.nextElementSibling;
        if (valueLabel) valueLabel.textContent = `${Math.round(safeVolume * 100)}%`;
    }
}

function handleAudioLayerChange(e) {
    const target = e.target;
    if (!target || !target.dataset || target.dataset.audioAction !== 'file') return;

    const index = parseInt(target.dataset.audioIndex, 10);
    const file = target.files && target.files[0];
    if (!Number.isFinite(index) || !file) return;

    uploadAudioLayerFile(index, file).finally(() => {
        target.value = '';
    });
}

function handleAudioLayerClick(e) {
    const btn = e.target.closest('[data-audio-action]');
    if (!btn) return;

    const index = parseInt(btn.dataset.audioIndex, 10);
    const action = btn.dataset.audioAction;
    if (!Number.isFinite(index)) return;

    if (action === 'upload') {
        window.chooseMediaForTarget(
            index === 0 ? 'speech' : 'audio',
            `audioLayerName-${index}`,
            `audioLayerInput-${index}`
        );
    }

    if (action === 'browse') {
        openMediaLibrary('audio', `audioLayerName-${index}`);
    }

    if (action === 'play') {
        toggleAudioPreview(btn, index);
    }

    if (action === 'remove') {
        const slide = state.slides[activeSlideIndex];
        if (!slide) return;
        const layers = normalizeAudioLayersForSlide(slide);
        layers.splice(index, 1);
        slide.audio = layers[0] ? layers[0].src : null;
        markUnsaved();
        renderEditor();
        renderTimeline();
    }
}

async function uploadAudioLayerFile(index, file) {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;

    try {
        const { res, data, cancelled } = await postUploadWithConfirmation(file, false, index === 0 ? 'speech' : 'audio');
        if (cancelled) return;
        if (res.ok && data.status === 'success') {
            setAudioLayerValue(index, { src: file });
            renderEditor();
        } else {
            alert(data.message || 'Could not read the selected file');
        }
    } catch (err) {
        console.error('File selection error:', err);
        alert('Could not read the selected file. Check console.');
    }
}

function updatePreview() {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;

    const bgUrl = getObjectUrl(slide.bgImage);
    const foregroundLayers = normalizeForegroundLayersForSlide(slide);
    const foregroundUrls = foregroundLayers
        .map(layer => getObjectUrl(layer.src))
        .filter(Boolean);

    if (bgUrl || foregroundUrls.length) {
        els.previewPlaceholder.style.display = 'none';
    } else {
        els.previewPlaceholder.style.display = 'block';
    }

    if (bgUrl) {
        els.previewBg.src = bgUrl;
        els.previewBg.style.display = 'block';
    } else {
        els.previewBg.style.display = 'none';
        els.previewBg.src = '';
    }

    if (els.previewFg) {
        els.previewFg.style.display = 'none';
        els.previewFg.src = '';
    }

    const previewBox = els.previewPlaceholder ? els.previewPlaceholder.closest('.preview-box') : null;
    if (!previewBox) return;
    if (getComputedStyle(previewBox).position === 'static') {
        previewBox.style.position = 'relative';
    }

    previewBox.querySelectorAll('.preview-fg-layer').forEach(node => node.remove());
    foregroundUrls.forEach((url, index) => {
        const img = document.createElement('img');
        img.className = 'preview-fg-layer';
        img.src = url;
        img.style.cssText = `position:absolute; inset:0; object-fit:contain; width:100%; height:100%; z-index:${2 + index}; pointer-events:none;`;
        previewBox.appendChild(img);
    });
}

// --- Drag & Drop Reordering ---
function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    const draggedIdx = parseInt(e.dataTransfer.getData('text/plain'));
    if (isNaN(draggedIdx)) return;

    // Find closest slide-item
    const targetElement = e.target.closest('.slide-item');
    if (!targetElement) {
        // Drop at the end if not dropped over a specific element
        const item = state.slides.splice(draggedIdx, 1)[0];
        state.slides.push(item);
        if (activeSlideIndex === draggedIdx) activeSlideIndex = state.slides.length - 1;
        renderAll();
        return;
    }

    // Get index of target
    const items = Array.from(els.timeline.children);
    let targetIdx = items.indexOf(targetElement);

    if (targetIdx === -1 || targetIdx === draggedIdx) return;

    const item = state.slides.splice(draggedIdx, 1)[0];
    state.slides.splice(targetIdx, 0, item);

    // Update active index
    if (activeSlideIndex === draggedIdx) {
        activeSlideIndex = targetIdx;
    } else if (activeSlideIndex > draggedIdx && activeSlideIndex <= targetIdx) {
        activeSlideIndex--;
    } else if (activeSlideIndex < draggedIdx && activeSlideIndex >= targetIdx) {
        activeSlideIndex++;
    }

    markUnsaved(); // Reordering slides is an unsaved change
    renderAll();
}

// --- Transitions Hub Integration ---
function buildTransitionsHubUrl(mode = 'create') {
    const url = buildLocalAwareUrl('/studio/hubs/transitions-hub.html');
    url.searchParams.set('mode', mode);
    url.searchParams.set('slide', String(activeSlideIndex + 1));
    url.searchParams.set('v', String(Date.now()));
    return url;
}

window.openTransitionsHub = function () {
    if (!els.transitionsModal || !els.transitionsIframe) return;
    els.transitionsIframe.src = buildTransitionsHubUrl('create').toString();
    els.transitionsModal.classList.add('open');
};

window.openTransitionInHub = function () {
    if (!state.slides[activeSlideIndex]) return;
    const draft = normalizeTransitionDraft(state.slides[activeSlideIndex]);
    if (!draft.enabled) return;

    sessionStorage.setItem('transitionEditData', JSON.stringify(draft));
    els.transitionsIframe.src = buildTransitionsHubUrl('edit').toString();
    els.transitionsModal.classList.add('open');
};

window.openTransitionJsonEditor = function () {
    if (!state.slides[activeSlideIndex]) return;
    const draft = normalizeTransitionDraft(state.slides[activeSlideIndex]);
    if (!draft.enabled) return;
    alert(JSON.stringify(draft, null, 2));
};

window.clearTransitionDraft = function () {
    const slide = state.slides[activeSlideIndex];
    if (!slide) return;
    slide.transitionDraft = createDefaultTransitionDraft();
    markUnsaved();
    renderTransitionDraft();
};

window.closeTransitionsHub = function () {
    if (!els.transitionsModal || !els.transitionsIframe) return;
    els.transitionsModal.classList.remove('open');
    els.transitionsIframe.src = '';
    sessionStorage.removeItem('transitionEditData');
};

function handleTransitionMessage(event) {
    if (!event.data || event.data.type !== 'transition-config') return;
    const slide = state.slides[activeSlideIndex];
    if (!slide || !event.data.transition || typeof event.data.transition !== 'object') return;

    slide.transitionDraft = {
        ...createDefaultTransitionDraft(),
        ...event.data.transition,
        enabled: true
    };
    normalizeTransitionDraft(slide);
    markUnsaved();
    renderTransitionDraft();
    closeTransitionsHub();
}

// --- Effects Hub Integration ---
function buildEffectsHubImageUrl(src) {
    if (!src) return '';
    if (src instanceof File) return getObjectUrl(src) || '';
    if (typeof src !== 'string') return '';
    if (isDirectAssetUrl(src)) return src;
    return buildMediaPreviewUrl(IMG_BASE_URL, src);
}

function buildEffectsHubFetchUrl(src) {
    if (!src) return '';
    if (src instanceof File) return getObjectUrl(src) || '';
    if (typeof src !== 'string') return '';
    if (isDirectAssetUrl(src)) return src;
    return buildProjectAssetUrl(src, 'img') || getLocalAssetUrl(src, 'img') || buildMediaPreviewUrl(IMG_BASE_URL, src);
}

window.openEffectsHub = function (target) {
    activeEffectTarget = target; // 'bg' or 'fg'

    // Get the current slide's appropriate image
    let currentImage = null;

    if (state.slides[activeSlideIndex]) {
        currentImage = target === 'bg'
            ? state.slides[activeSlideIndex].bgImage
            : (getForegroundTargetLayer(target) || {}).src;
    }

    const imgName = getFileName(currentImage) || '';
    const imgUrl = buildEffectsHubImageUrl(currentImage || imgName);

    // Append it to the query string
    const url = buildLocalAwareUrl('/studio/hubs/effects-hub.html');
    if (new URLSearchParams(window.location.search).get('smokeEffects') === '1') {
        url.searchParams.set('smokeEffect', 'all');
    }

    if (imgName) {
        url.searchParams.set('img', imgName);
        if (imgUrl) url.searchParams.set('imgUrl', imgUrl);
    }

    els.iframe.src = url.toString();
    els.modal.classList.add('open');
};

window.openEffectInHub = async function (target) {
    if (!state.slides[activeSlideIndex]) return;

    activeEffectTarget = target;
    const foregroundLayer = target === 'bg' ? null : getForegroundTargetLayer(target);
    const effectData = target === 'bg' ? state.slides[activeSlideIndex].bgEffect : (foregroundLayer ? foregroundLayer.effect : null);

    if (!effectData) return; // Should be disabled anyway

    let effectJsonStr = null;

    if (typeof effectData === 'object' && effectData.json) {
        effectJsonStr = JSON.stringify(effectData.json);
    }

    if (!effectJsonStr) {
        alert("This effect does not have embedded JSON data in flow.json yet. Please recreate or re-save the effect.");
        return;
    }

    // Get the current slide's appropriate image
    let currentImage = target === 'bg'
        ? state.slides[activeSlideIndex].bgImage
        : (foregroundLayer ? foregroundLayer.src : null);
    let imgName = getFileName(currentImage) || '';
    let imgUrl = buildEffectsHubImageUrl(currentImage || imgName);

    // If there is no standard file but there is an active effect, try to pull the first image from its config
    if (!imgName && effectJsonStr) {
        try {
            const parsed = JSON.parse(effectJsonStr);
            if (parsed.config && parsed.config.imgSrc) {
                imgName = parsed.config.imgSrc.replace('img/', '');
            } else if (parsed.config && parsed.config.images && parsed.config.images[0]) {
                imgName = parsed.config.images[0].replace('img/', '');
            }
            imgUrl = buildEffectsHubImageUrl(currentImage || imgName);
        } catch (e) { }
    }

    // Set up Hub URL
    const url = buildLocalAwareUrl('/studio/hubs/effects-hub.html');

    if (imgName) {
        url.searchParams.set('img', imgName);
        if (imgUrl) url.searchParams.set('imgUrl', imgUrl);
    }

    // Tell the Hub it's coming into "edit" mode
    url.searchParams.set('mode', 'edit');

    // Store the JSON in sessionStorage to avoid massive URL parameters
    if (effectJsonStr) {
        try {
            const parsed = JSON.parse(effectJsonStr);
            if (parsed.config) {
                // If it needs specific multi-images, pre-fetch and convert them here in the parent window
                // prior to sending to the iframe hub, avoiding CORS/relative pathing snags across frames.
                let promises = [];

                const loadAsBlobUrl = async (path, targetKey) => {
                    if (!path) return;
                    try {
                        const targetUrl = buildEffectsHubFetchUrl(path);
                        if (!targetUrl) return;
                        const res = await fetch(targetUrl);
                        const blob = await res.blob();
                        parsed.config[targetKey] = URL.createObjectURL(blob);
                    } catch (err) {
                        console.error('Pre-fetch error for Edit Mode Image:', err);
                    }
                };

                // Morph, Slide, Wipe
                if (parsed.config.imgSrc) promises.push(loadAsBlobUrl(parsed.config.imgSrc, "preloadedData1"));
                if (parsed.config.imgSrc2) promises.push(loadAsBlobUrl(parsed.config.imgSrc2, "preloadedData2"));

                // Slideshow / frame arrays
                if (parsed.config.images && Array.isArray(parsed.config.images)) {
                    parsed.config.preloadedImages = [];
                    for (let i = 0; i < parsed.config.images.length; i++) {
                        let path = parsed.config.images[i];
                        let loadP = (async () => {
                            try {
                                const targetUrl = buildEffectsHubFetchUrl(path);
                                if (!targetUrl) return;
                                const res = await fetch(targetUrl);
                                const blob = await res.blob();
                                parsed.config.preloadedImages[i] = URL.createObjectURL(blob);
                            } catch (err) {
                                console.error('Slideshow Pre-fetch error:', err);
                            }
                        })();
                        promises.push(loadP);
                    }
                }

                if (parsed.config.frames && Array.isArray(parsed.config.frames)) {
                    parsed.config.preloadedFrames = [];
                    for (let i = 0; i < parsed.config.frames.length; i++) {
                        let path = parsed.config.frames[i];
                        let loadP = (async () => {
                            try {
                                const targetUrl = buildEffectsHubFetchUrl(path);
                                if (!targetUrl) return;
                                const res = await fetch(targetUrl);
                                const blob = await res.blob();
                                parsed.config.preloadedFrames[i] = URL.createObjectURL(blob);
                            } catch (err) {
                                console.error('Frame Animation Pre-fetch error:', err);
                            }
                        })();
                        promises.push(loadP);
                    }
                }

                await Promise.all(promises);
            }
            effectJsonStr = JSON.stringify(parsed);
        } catch (e) {
            console.error("Failed handling preloads for Edit mode", e);
        }

        sessionStorage.setItem('effectEditData', effectJsonStr);
    }

    els.iframe.src = url.toString();
    els.modal.classList.add('open');
};

window.closeEffectsHub = function (forceClose = false) {
    // Safety check: if there is an active effect loaded in the iframe, warn the user
    if (!forceClose && els.iframe.contentWindow && typeof els.iframe.contentWindow.hasActiveEffect === 'function') {
        if (els.iframe.contentWindow.hasActiveEffect()) {
            const confirmClose = window.confirm("Are you sure you want to close? Any unsaved effect settings will be lost.");
            if (!confirmClose) return; // Abort closing
        }
    }

    els.modal.classList.remove('open');
    els.iframe.src = '';
    activeEffectTarget = null;
    sessionStorage.removeItem('effectEditData');
};

window.closePlaybackModal = function () {
    const pbModal = document.getElementById('playback-modal');
    const pbIframe = document.getElementById('playback-iframe');

    if (pbModal && pbIframe) {
        pbIframe.src = ''; // Force unload player engine and audio
        pbModal.style.display = 'none';
    }
};

window.clearEffect = function (target) {
    if (!state.slides[activeSlideIndex]) return;
    if (target === 'bg') {
        state.slides[activeSlideIndex].bgEffect = null;
        els.bgEffect.value = '';

        const editBgBtn = document.getElementById('editBgBtn');
        const jsonBgBtn = document.getElementById('jsonBgBtn');
        const clearBgBtn = document.getElementById('clearBgBtn');
        if (editBgBtn) editBgBtn.style.display = 'none';
        if (jsonBgBtn) jsonBgBtn.style.display = 'none';
        if (clearBgBtn) clearBgBtn.style.display = 'none';

    } else if (target === 'fg') {
        setForegroundLayerValue(0, { effect: null });
        if (els.fgEffect) els.fgEffect.value = '';

        const editFgBtn = document.getElementById('editFgBtn');
        const jsonFgBtn = document.getElementById('jsonFgBtn');
        const clearFgBtn = document.getElementById('clearFgBtn');
        if (editFgBtn) editFgBtn.style.display = 'none';
        if (jsonFgBtn) jsonFgBtn.style.display = 'none';
        if (clearFgBtn) clearFgBtn.style.display = 'none';
    } else if (typeof target === 'string' && target.startsWith('fg:')) {
        setForegroundLayerValue(parseForegroundTarget(target), { effect: null });
        renderEditor();
    }
    markUnsaved();
    renderTimeline();
};

function base64ToFile(dataurl, filename) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

async function uploadMediaImmediately(file) {
    try {
        const { res, data, cancelled } = await postUploadWithConfirmation(file);
        if (cancelled) {
            return false;
        }
        return res.ok && data.status === 'success';
    } catch (err) {
        console.error('Failed instant upload of morph image', err);
        return false;
    }
}

async function handleEffectMessage(e) {
    // Only accept JSON messages that look like our effects
    if (!e.data || !e.data.engine) return;

    // The effect JSON sent by postMessage
    const effectData = e.data;

    // Extract potential raw image data sent from manual uploads inside the Effect Maker Hub (like Morph Maker)
    const raw1 = effectData.rawData1;
    const raw2 = effectData.rawData2;
    delete effectData.rawData1; // remove from json definition so it doesn't inflate the exported file
    delete effectData.rawData2;

    if (activeEffectTarget && state.slides[activeSlideIndex]) {
        // Derive a name using the engine and current time to ensure uniqueness
        const effectName = `${effectData.engine}-effect-${Date.now()}`;

        const effectObj = {
            name: effectName,
            json: effectData
        };

        if (activeEffectTarget === 'bg') {
            state.slides[activeSlideIndex].bgEffect = effectObj;
            els.bgEffect.value = effectName;

            // Re-show edit option buttons immediately
            const editBgBtn = document.getElementById('editBgBtn');
            const jsonBgBtn = document.getElementById('jsonBgBtn');
            const clearBgBtn = document.getElementById('clearBgBtn');
            if (editBgBtn) editBgBtn.style.display = 'inline-block';
            if (jsonBgBtn) jsonBgBtn.style.display = 'inline-block';
            if (clearBgBtn) clearBgBtn.style.display = 'inline-block';

        } else if (activeEffectTarget === 'fg' || (typeof activeEffectTarget === 'string' && activeEffectTarget.startsWith('fg:'))) {
            const foregroundIndex = parseForegroundTarget(activeEffectTarget);
            setForegroundLayerValue(foregroundIndex, { effect: effectObj });
            if (foregroundIndex === 0 && els.fgEffect) els.fgEffect.value = effectName;

            // Re-show edit option buttons immediately
            const editFgBtn = document.getElementById('editFgBtn');
            const jsonFgBtn = document.getElementById('jsonFgBtn');
            const clearFgBtn = document.getElementById('clearFgBtn');
            if (foregroundIndex === 0 && editFgBtn) editFgBtn.style.display = 'inline-block';
            if (foregroundIndex === 0 && jsonFgBtn) jsonFgBtn.style.display = 'inline-block';
            if (foregroundIndex === 0 && clearFgBtn) clearFgBtn.style.display = 'inline-block';
        }

        // If the Effect Maker supplied raw DataURI payloads (because the user manually picked them),
        // aggressively assign them to the timeline slide's primary input slots so they physically save to the server!
        if (raw1 && effectData.config && effectData.config.imgSrc) {
            const rawFilename = effectData.config.imgSrc.replace('img/', '');
            let fileObj;
            if (activeEffectTarget === 'bg') {
                fileObj = base64ToFile(raw1, rawFilename);
                state.slides[activeSlideIndex].bgImage = fileObj;
                els.bgName.value = rawFilename;
            } else {
                fileObj = base64ToFile(raw1, rawFilename);
                const foregroundIndex = parseForegroundTarget(activeEffectTarget);
                setForegroundLayerValue(foregroundIndex, { src: fileObj });
                if (foregroundIndex === 0 && els.fgName) els.fgName.value = rawFilename;
            }
            await uploadMediaImmediately(fileObj);
            updatePreview();
        }

        // If there's a second image (e.g. Morph End target) and we have a next slide, push it into the next slide!
        if (raw2 && effectData.config && effectData.config.imgSrc2) {
            const rawFilename2 = effectData.config.imgSrc2.replace('img/', '');
            if (state.slides[activeSlideIndex + 1]) {
                let fileObj2;
                if (activeEffectTarget === 'bg') {
                    fileObj2 = base64ToFile(raw2, rawFilename2);
                    state.slides[activeSlideIndex + 1].bgImage = fileObj2;
                } else {
                    fileObj2 = base64ToFile(raw2, rawFilename2);
                    const nextLayers = normalizeForegroundLayersForSlide(state.slides[activeSlideIndex + 1]);
                    const foregroundIndex = parseForegroundTarget(activeEffectTarget);
                    while (nextLayers.length <= foregroundIndex) {
                        nextLayers.push({ name: `Foreground ${nextLayers.length + 1}`, src: null, effect: null });
                    }
                    nextLayers[foregroundIndex].src = fileObj2;
                    state.slides[activeSlideIndex + 1].fgImage = nextLayers[0] ? nextLayers[0].src : null;
                }
                await uploadMediaImmediately(fileObj2);
                updatePreview();
            }
        }

        markUnsaved();
        renderTimeline();
        renderEditor(); // Force the Editor panel to re-check if effects exist and enable buttons!
    }

    const registryHubButton = Boolean(
        els.iframe
        && els.iframe.contentDocument
        && els.iframe.contentDocument.getElementById('manageRegistryBtn')
    );
    const promptBuilderHubButton = Boolean(
        els.iframe
        && els.iframe.contentDocument
        && els.iframe.contentDocument.getElementById('createEffectPromptBtn')
    );
    closeEffectsHub(true); // pass true to bypass the safety confirmation since we are saving!
    if (DESKTOP_MODE && new URLSearchParams(window.location.search).get('smokeEffects') === '1') {
        DESKTOP_BRIDGE.reportReady({
            surface: 'effects',
            workspaceCount: 0,
            projectCount: 1,
            registryHubButton,
            registryInterface: typeof DESKTOP_BRIDGE.openRegistryEditor === 'function',
            promptBuilderHubButton,
            promptBuilderInterface: typeof DESKTOP_BRIDGE.openEffectPromptBuilder === 'function'
        });
    }
}

// --- Effect JSON Editor Integration ---
let activeEditorTarget = null; // 'bg' or 'fg'

window.openEffectEditor = async function (target) {
    if (!state.slides[activeSlideIndex]) return;

    activeEditorTarget = target;
    const foregroundLayer = target === 'bg' ? null : getForegroundTargetLayer(target);
    const effectData = target === 'bg' ? state.slides[activeSlideIndex].bgEffect : (foregroundLayer ? foregroundLayer.effect : null);

    if (!effectData) {
        alert("Please add an effect first before editing it.");
        return;
    }

    let effectName = '';
    let effectJsonStr = '{\n  \n}'; // Default empty JSON object

    if (typeof effectData === 'object') {
        effectName = effectData.name || '';

        if (effectData.json) {
            // It's a modern effect with embedded JSON
            effectJsonStr = JSON.stringify(effectData.json, null, 2);
        }
    } else if (typeof effectData === 'string') {
        effectName = effectData;
    }

    if (!effectJsonStr.trim() || effectJsonStr === '{\n  \n}') {
        alert("This effect does not have embedded JSON data in flow.json yet. Please recreate or re-save the effect.");
        return;
    }

    els.editName.value = effectName;
    els.editJson.value = effectJsonStr;
    els.editError.style.display = 'none';

    els.editModal.style.display = 'flex';
};

window.closeEffectEditor = function () {
    els.editModal.style.display = 'none';
    activeEditorTarget = null;
    els.editName.value = '';
    els.editJson.value = '';
};

window.saveEffectEditor = function () {
    if (!activeEditorTarget) return;

    try {
        const parsedJson = JSON.parse(els.editJson.value);
        const effectName = els.editName.value.trim() || `edited-effect-${Date.now()}`;

        const newEffectObj = {
            name: effectName,
            json: parsedJson
        };

        if (activeEditorTarget === 'bg') {
            state.slides[activeSlideIndex].bgEffect = newEffectObj;
            els.bgEffect.value = effectName;
        } else if (activeEditorTarget === 'fg') {
            setForegroundLayerValue(0, { effect: newEffectObj });
            if (els.fgEffect) els.fgEffect.value = effectName;
        } else if (typeof activeEditorTarget === 'string' && activeEditorTarget.startsWith('fg:')) {
            setForegroundLayerValue(parseForegroundTarget(activeEditorTarget), { effect: newEffectObj });
            renderEditor();
        }

        markUnsaved();
        renderTimeline();
        closeEffectEditor();
    } catch (e) {
        els.editError.style.display = 'block';
    }
};

// --- Data Export & Saving ---


// Helper to safely extract filename from File object or string without losing query params
function getFileName(val) {
    if (!val) return '';
    if (typeof val === 'string') return val.replace(/^(?:img|speech|audio)\//i, '');
    if (val instanceof File) return val.name;
    return '';
}

function generateFinalJSON() {
    const obj = {
        title: state.title.trim(),
        schemaVersion: 2,
        defaultBeatSeconds: state.defaultDuration,
        slides: []
    };

    if (state.description.trim()) obj.description = state.description.trim();
    if (state.openingImage) obj.openingImage = getFileName(state.openingImage);
    const globalAudioLayers = normalizeGlobalAudioLayers()
        .filter(layer => layer.src)
        .map((layer, index) => ({
            name: layer.name || `Global Audio ${index + 1}`,
            src: mediaSrcForFolder(layer.src, 'audio'),
            volume: Math.max(0, Math.min(1, Number(layer.volume ?? 1))),
            allSlides: layer.allSlides !== false,
            startSlide: layer.allSlides === false ? Math.max(1, parseInt(layer.startSlide, 10) || 1) : null,
            endSlide: layer.allSlides === false && layer.endSlide ? Math.max(1, parseInt(layer.endSlide, 10) || 1) : null,
            loop: layer.loop !== false
        }));
    if (globalAudioLayers.length) obj.globalAudioLayers = globalAudioLayers;

    state.slides.forEach((s, idx) => {
        const beat = {};
        if (s.text) beat.text = s.text.trim();
        if (s.duration) beat.seconds = s.duration;
        if (s.transition && s.transition !== 'fade') beat.transition = s.transition;
        const transitionDraft = normalizeTransitionDraft(s);
        if (transitionDraft.enabled) {
            beat.transitionDraft = { ...transitionDraft };
        }

        const serializeEffect = (effect) => {
            if (!effect) return null;
            if (typeof effect === 'object' && effect.json) {
                return { name: effect.name, ...effect.json };
            }
            return typeof effect === 'string' ? { name: effect } : { name: effect.name };
        };

        beat.background = {
            src: s.bgImage ? getFileName(s.bgImage) : '',
            effect: serializeEffect(s.bgEffect)
        };

        beat.foregroundLayers = normalizeForegroundLayersForSlide(s)
            .filter(layer => layer.src || layer.effect)
            .map((layer, layerIndex) => ({
                name: layer.name || `Foreground ${layerIndex + 1}`,
                src: layer.src ? getFileName(layer.src) : '',
                effect: serializeEffect(layer.effect)
            }));

        beat.audioLayers = normalizeAudioLayersForSlide(s)
            .map((layer, originalIndex) => ({ layer, originalIndex }))
            .filter(({ layer }) => layer.src)
            .map(({ layer, originalIndex }) => ({
                name: layer.name || (originalIndex === 0 ? 'Speech' : `Audio ${originalIndex + 1}`),
                src: mediaSrcForFolder(layer.src, originalIndex === 0 ? 'speech' : 'audio'),
                volume: Math.max(0, Math.min(1, Number(layer.volume ?? 1)))
            }));

        if (s.bgEffect) {
            if (typeof s.bgEffect === 'object' && s.bgEffect.json) {
                beat.background.effect = { name: s.bgEffect.name, ...s.bgEffect.json };
            } else {
                beat.background.effect = serializeEffect(s.bgEffect);
            }
        }

        obj.slides.push(beat);
    });

    return obj;
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = ev => resolve(ev.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function getPortableMediaRef(src) {
    if (src instanceof File) return fileToDataUrl(src);
    const localFile = getLocalAssetFile(src, guessMediaFolder(src));
    if (localFile) return fileToDataUrl(localFile);
    return src;
}

function getRuntimeMediaRef(src, fallbackFolder = '') {
    if (!src) return '';
    if (src instanceof File) return getObjectUrl(src) || '';
    if (typeof src === 'string' && isDirectAssetUrl(src)) return src;
    const projectUrl = buildProjectAssetUrl(src, fallbackFolder || guessMediaFolder(src));
    if (projectUrl) return projectUrl;
    return getLocalAssetUrl(src, fallbackFolder || guessMediaFolder(src)) || src;
}

function normalizeRuntimeEffectAssets(input) {
    if (Array.isArray(input)) return input.map(normalizeRuntimeEffectAssets);
    if (input && typeof input === 'object') {
        const out = {};
        Object.entries(input).forEach(([key, value]) => {
            out[key] = normalizeRuntimeEffectAssets(value);
        });
        return out;
    }
    if (typeof input !== 'string') return input;

    const val = input.trim();
    if (!val || isDirectAssetUrl(val)) return input;
    if (!/\.(png|jpe?g|webp|gif|avif|bmp|svg|mp3|wav|ogg|m4a|aac|flac)(?:[?#].*)?$/i.test(val)) return input;

    return getRuntimeMediaRef(val, guessMediaFolder(val)) || input;
}

function normalizeRuntimeEffect(effect) {
    if (!effect || typeof effect !== 'object') return effect || null;
    const out = { ...effect };
    if (out.config && typeof out.config === 'object') {
        out.config = normalizeRuntimeEffectAssets(out.config);
    }
    return out;
}

function generateRuntimePreviewJSON() {
    const obj = generateFinalJSON();

    obj.openingImage = getRuntimeMediaRef(state.openingImage, 'img');

    const globalLayers = normalizeGlobalAudioLayers();
    if (Array.isArray(obj.globalAudioLayers)) {
        obj.globalAudioLayers.forEach((layer, index) => {
            layer.src = getRuntimeMediaRef(globalLayers[index] ? globalLayers[index].src : layer.src, 'audio');
        });
    }

    obj.slides.forEach((slideObj, index) => {
        const slideState = state.slides[index] || {};

        if (slideObj.background) {
            slideObj.background.src = getRuntimeMediaRef(slideState.bgImage, 'img');
            slideObj.background.effect = normalizeRuntimeEffect(slideObj.background.effect);
        }

        const foregroundLayers = normalizeForegroundLayersForSlide(slideState);
        if (Array.isArray(slideObj.foregroundLayers)) {
            slideObj.foregroundLayers.forEach((layer, layerIndex) => {
                layer.src = getRuntimeMediaRef(foregroundLayers[layerIndex] ? foregroundLayers[layerIndex].src : layer.src, 'img');
                layer.effect = normalizeRuntimeEffect(layer.effect);
            });
        }

        const audioLayers = normalizeAudioLayersForSlide(slideState).filter(layer => layer.src);
        if (Array.isArray(slideObj.audioLayers)) {
            slideObj.audioLayers.forEach((layer, layerIndex) => {
                layer.src = getRuntimeMediaRef(audioLayers[layerIndex] ? audioLayers[layerIndex].src : layer.src, layerIndex === 0 ? 'speech' : 'audio');
            });
        }
    });

    return obj;
}

function prepareLocalPlayerPreview() {
    try {
        sessionStorage.setItem(LOCAL_PREVIEW_STORAGE_KEY, JSON.stringify(generateRuntimePreviewJSON()));
    } catch (err) {
        console.error('Could not prepare local player preview', err);
    }
}

function createLocalPlayerPayload() {
    const flowData = DESKTOP_MODE
        ? generateRuntimePreviewJSON()
        : generateFinalJSON();
    const assets = [];
    const seen = new Map();
    const referencedKeys = collectReferencedAssetKeys(flowData);

    function addAsset(key, file) {
        const cleanKey = normalizeLocalAssetKey(key);
        if (!cleanKey || !file) return;
        const collisionKey = cleanKey.toLowerCase();
        const existing = seen.get(collisionKey);
        if (existing) {
            const sameFile = existing === file || (
                existing.name === file.name &&
                existing.size === file.size &&
                existing.lastModified === file.lastModified
            );
            if (!sameFile) {
                throw new Error(`Two different offline files use the same name: "${cleanKey}". Rename one of them before playing or exporting.`);
            }
            return;
        }
        seen.set(collisionKey, file);
        assets.push({ key: cleanKey, file });
    }

    referencedKeys.forEach(key => {
        const cleanKey = normalizeLocalAssetKey(key);
        const file = localAssetFiles.get(cleanKey) || localAssetFiles.get(cleanKey.toLowerCase());
        if (file) addAsset(cleanKey, file);

        const basename = cleanKey.split('/').pop();
        if (basename) {
            const basenameFile = localAssetFiles.get(basename) || localAssetFiles.get(basename.toLowerCase());
            if (basenameFile) addAsset(basename, basenameFile);
        }
    });

    if (state.openingImage instanceof File) {
        addAsset(`img/${state.openingImage.name}`, state.openingImage);
        addAsset(state.openingImage.name, state.openingImage);
    }

    state.slides.forEach(slide => {
        if (slide.bgImage instanceof File) {
            addAsset(`img/${slide.bgImage.name}`, slide.bgImage);
            addAsset(slide.bgImage.name, slide.bgImage);
        }

        normalizeForegroundLayersForSlide(slide).forEach(layer => {
            if (layer.src instanceof File) {
                addAsset(`img/${layer.src.name}`, layer.src);
                addAsset(layer.src.name, layer.src);
            }
        });

        normalizeAudioLayersForSlide(slide).forEach((layer, index) => {
            if (layer.src instanceof File) {
                const folder = index === 0 ? 'speech' : 'audio';
                addAsset(`${folder}/${layer.src.name}`, layer.src);
                addAsset(layer.src.name, layer.src);
            }
        });
    });

    normalizeGlobalAudioLayers().forEach(layer => {
        if (layer.src instanceof File) {
            addAsset(`audio/${layer.src.name}`, layer.src);
            addAsset(layer.src.name, layer.src);
        }
    });

    return {
        type: 'local-player-data',
        flowData,
        assets
    };
}

function collectReferencedAssetKeys(flowData) {
    const keys = new Set();

    function add(value, fallbackFolder = '') {
        if (typeof value !== 'string') return;
        const val = normalizeLocalAssetKey(value.split('?')[0].split('#')[0]);
        if (!val || isDirectAssetUrl(val)) return;
        if (!/\.(png|jpe?g|webp|gif|avif|bmp|svg|mp3|wav|ogg|m4a|aac|flac)$/i.test(val)) return;

        keys.add(val);
        if (!val.startsWith('img/') && !val.startsWith('speech/') && !val.startsWith('audio/') && fallbackFolder) {
            keys.add(`${fallbackFolder}/${val}`);
        }
    }

    function walk(value) {
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }

        if (value && typeof value === 'object') {
            Object.values(value).forEach(walk);
            return;
        }

        add(value, guessMediaFolder(value));
    }

    add(flowData.openingImage, 'img');
    if (Array.isArray(flowData.globalAudioLayers)) {
        flowData.globalAudioLayers.forEach(layer => add(layer && layer.src, 'audio'));
    }

    (flowData.slides || []).forEach(slide => {
        add(slide && slide.background && slide.background.src, 'img');
        walk(slide && slide.background && slide.background.effect);

        (slide.foregroundLayers || []).forEach(layer => {
            add(layer && layer.src, 'img');
            walk(layer && layer.effect);
        });

        (slide.audioLayers || []).forEach((layer, index) => {
            add(layer && layer.src, index === 0 ? 'speech' : 'audio');
        });
    });

    return keys;
}

function guessMediaFolder(src) {
    const val = String(src || '').toLowerCase();
    if (val.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(val)) return val.startsWith('audio/') ? 'audio' : 'speech';
    if (val.startsWith('speech/')) return 'speech';
    return 'img';
}

async function generatePortableJSON() {
    const obj = generateFinalJSON();

    obj.openingImage = await getPortableMediaRef(state.openingImage);

    const globalLayers = normalizeGlobalAudioLayers();
    if (obj.globalAudioLayers && globalLayers.length) {
        for (let i = 0; i < obj.globalAudioLayers.length; i++) {
            obj.globalAudioLayers[i].src = await getPortableMediaRef(globalLayers[i].src);
        }
    }

    for (let i = 0; i < obj.slides.length; i++) {
        const slideState = state.slides[i] || {};
        const slideObj = obj.slides[i];

        if (slideObj.background) {
            slideObj.background.src = await getPortableMediaRef(slideState.bgImage);
        }

        const foregroundLayers = normalizeForegroundLayersForSlide(slideState);
        if (Array.isArray(slideObj.foregroundLayers)) {
            for (let j = 0; j < slideObj.foregroundLayers.length; j++) {
                if (foregroundLayers[j]) {
                    slideObj.foregroundLayers[j].src = await getPortableMediaRef(foregroundLayers[j].src);
                }
            }
        }

        const audioLayers = normalizeAudioLayersForSlide(slideState).filter(layer => layer.src);
        if (Array.isArray(slideObj.audioLayers)) {
            for (let j = 0; j < slideObj.audioLayers.length; j++) {
                if (audioLayers[j]) {
                    slideObj.audioLayers[j].src = await getPortableMediaRef(audioLayers[j].src);
                }
            }
        }
    }

    return obj;
}

function desktopHasPendingMediaFiles() {
    if (state.openingImage instanceof File) return true;
    if (normalizeGlobalAudioLayers().some(layer => layer.src instanceof File)) return true;
    return state.slides.some(slide => (
        slide.bgImage instanceof File
        || normalizeForegroundLayersForSlide(slide).some(layer => layer.src instanceof File)
        || normalizeAudioLayersForSlide(slide).some(layer => layer.src instanceof File)
    ));
}

async function saveProject() {
    // Validate
    if (!state.title.trim()) {
        alert("Please provide a Project Title before saving.");
        return;
    }

    if (!state.openingImage && !DESKTOP_MODE) {
        alert("Please provide an Opening Image before saving.");
        return;
    }

    // Safety guard to prevent saving an empty project over an existing flow.json
    // Check if we only have 1 slide, and that slide has absolutely no data (empty text, no images, etc)
    if (state.slides.length === 0 || (state.slides.length === 1 &&
        !state.slides[0].text && !state.slides[0].bgImage &&
        normalizeForegroundLayersForSlide(state.slides[0]).every(layer => !layer.src && !layer.effect) && normalizeAudioLayersForSlide(state.slides[0]).every(layer => !layer.src) && !state.slides[0].duration)) {

        if (!confirm("This project appears completely empty. Are you sure you want to save and overwrite the existing timeline?")) {
            return;
        }
    }

    els.saveBtn.textContent = "Saving...";
    els.saveBtn.disabled = true;

    if (DESKTOP_MODE) {
        try {
            if (!DESKTOP_BRIDGE) throw new Error('The desktop bridge is unavailable.');
            if (desktopHasPendingMediaFiles()) {
                throw new Error(
                    'This project contains newly selected media that is not in its library. '
                    + 'Import it with a desktop Choose button before saving.'
                );
            }
            const finalJSON = generateFinalJSON();
            finalJSON.isPublished = !!activePublicationState.isPublished;
            if (activePublicationState.publishedAt) {
                finalJSON.publishedAt = activePublicationState.publishedAt;
            }
            const result = await DESKTOP_BRIDGE.saveProjectFlow(
                PROJECT_CONTEXT.workspaceId,
                PROJECT_CONTEXT.project,
                finalJSON,
                activeProjectRevision
            );
            activeProjectRevision = result.revision;
            els.saveStatus.textContent = "Saved to flow.json at " + new Date().toLocaleTimeString();
            setTimeout(() => els.saveStatus.textContent = '', 5000);
            clearUnsaved();
        } catch (err) {
            console.error(err);
            alert(err && err.message ? err.message : "Could not save this project.");
        } finally {
            els.saveBtn.textContent = "Save Slideshow";
            els.saveBtn.disabled = false;
        }
        return;
    }

    const finalJSON = generateFinalJSON();

    // Gather all files and effects
    const formData = new FormData();
    formData.append('json_data', JSON.stringify(finalJSON, null, 2));
    formData.append('title', state.title);
    formData.append('description', state.description);

    const mediaFiles = new Map();
    function addMediaFile(file, kind) {
        if (!(file instanceof File)) return;
        mediaFiles.set(`${kind}:${file.name}:${file.size}`, { file, kind });
    }

    addMediaFile(state.openingImage, 'img');
    normalizeGlobalAudioLayers().forEach(layer => {
        addMediaFile(layer.src, 'audio');
    });

    const effectsData = {};

    state.slides.forEach(s => {
        addMediaFile(s.bgImage, 'img');
        normalizeForegroundLayersForSlide(s).forEach(layer => {
            addMediaFile(layer.src, 'img');
        });
        normalizeAudioLayersForSlide(s).forEach((layer, layerIndex) => {
            addMediaFile(layer.src, layerIndex === 0 ? 'speech' : 'audio');
        });

        if (s.bgEffect && typeof s.bgEffect === 'object') {
            effectsData[s.bgEffect.name] = JSON.stringify(s.bgEffect.json, null, 2);
        }
        normalizeForegroundLayersForSlide(s).forEach(layer => {
            if (layer.effect && typeof layer.effect === 'object') {
                effectsData[layer.effect.name] = JSON.stringify(layer.effect.json, null, 2);
            }
        });
    });

    mediaFiles.forEach(({ file, kind }) => {
        formData.append('media[]', file, file.name);
        formData.append('media_kind[]', kind);
    });

    formData.append('effects_data', JSON.stringify(effectsData));

    formData.append('csrf_token', getCsrfToken());

    try {
        let res = await fetch(MAKER_ENDPOINT, { method: 'POST', body: formData });
        let data = await res.json();
        if (data.status === 'needs_confirmation') {
            if (!window.confirm(buildReplaceExistingMessage(data.files, data.message))) return;
            formData.set('replace_existing', '1');
            res = await fetch(MAKER_ENDPOINT, { method: 'POST', body: formData });
            data = await res.json();
        }
        if (!res.ok || data.status === 'error') {
            throw new Error(data.message || 'Could not save the project.');
        }
        els.saveStatus.textContent = "Saved " + new Date().toLocaleTimeString();
        setTimeout(() => els.saveStatus.textContent = '', 5000);
        clearUnsaved(); // Mark as saved!
    } catch (err) {
        console.error(err);
        alert(err && err.message ? err.message : "Error saving project. Check console.");
    } finally {
        els.saveBtn.textContent = "Save Slideshow";
        els.saveBtn.disabled = false;
    }
}

async function downloadJSONOnly() {
    if (!state.title.trim()) return alert("Please provide a Project Title.");
    const exportObj = DESKTOP_MODE ? await generatePortableJSON() : generateFinalJSON();
    const v = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([v], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json';
    a.click();
    URL.revokeObjectURL(url);
}

// --- Loading existing JSON ---
function handleOpenJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const obj = JSON.parse(ev.target.result);
            loadFromObject(obj);
        } catch (err) {
            alert('Invalid JSON file.');
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

function loadFromObject(obj) {
    if ((obj.schemaVersion || 0) !== 2) {
        alert('This editor now expects schemaVersion 2 flow.json. Please run the v2 converter first.');
        return;
    }

    state.title = obj.title || '';
    state.description = obj.description || '';
    state.openingImage = obj.openingImage || null;
    state.defaultDuration = obj.defaultBeatSeconds || 5;
    state.globalAudioLayers = Array.isArray(obj.globalAudioLayers)
        ? obj.globalAudioLayers.map((layer, index) => ({
            name: layer && layer.name ? layer.name : `Global Audio ${index + 1}`,
            src: layer ? (layer.src || null) : null,
            volume: Math.max(0, Math.min(1, Number(layer && layer.volume != null ? layer.volume : 1))),
            allSlides: layer ? layer.allSlides !== false : true,
            startSlide: layer && layer.startSlide ? Math.max(1, parseInt(layer.startSlide, 10) || 1) : 1,
            endSlide: layer && layer.endSlide ? Math.max(1, parseInt(layer.endSlide, 10) || 1) : null,
            loop: layer ? layer.loop !== false : true
        }))
        : [];

    state.slides = [];
    const arr = Array.isArray(obj.slides) ? obj.slides : [];

    if (arr.length === 0) {
        addSlide();
    } else {
        arr.forEach(s => {
            const background = (s.background && typeof s.background === 'object' && !Array.isArray(s.background)) ? s.background : {};
            const foregroundLayers = Array.isArray(s.foregroundLayers) ? s.foregroundLayers : [];
            const firstForeground = foregroundLayers[0] || {};
            const audioLayers = Array.isArray(s.audioLayers) ? s.audioLayers : [];
            const firstAudio = audioLayers[0] || {};
            const normalizeEditorEffect = effect => effect
                ? (typeof effect === 'string' ? { name: effect } : { name: effect.name, json: { ...effect } })
                : null;

            const simpleTransition = typeof s.transition === 'string' ? s.transition : 'fade';

            state.slides.push({
                text: s.text || "",
                bgImage: background.src || null,
                fgImage: firstForeground.src || null,
                foregroundLayers: foregroundLayers.map((layer, index) => ({
                    name: layer && layer.name ? layer.name : `Foreground ${index + 1}`,
                    src: layer ? (layer.src || null) : null,
                    effect: normalizeEditorEffect(layer ? layer.effect : null)
                })),
                audio: firstAudio.src || null,
                audioLayers: audioLayers.map((layer, index) => ({
                    name: layer && layer.name ? layer.name : (index === 0 ? 'Speech' : `Audio ${index + 1}`),
                    src: layer ? (layer.src || null) : null,
                    volume: Math.max(0, Math.min(1, Number(layer && layer.volume != null ? layer.volume : 1)))
                })),
                duration: s.seconds || null,
                bgEffect: normalizeEditorEffect(background.effect),
                fgEffect: normalizeEditorEffect(firstForeground.effect),
                transition: simpleTransition || "fade",
                transitionDraft: s.transitionDraft && typeof s.transitionDraft === 'object'
                    ? { ...createDefaultTransitionDraft(), ...s.transitionDraft }
                    : createDefaultTransitionDraft()
            });
        });
        activeSlideIndex = 0;
    }
    clearUnsaved(); // Clean slate when newly loaded
    renderAll();
}

function resetEditorStateForProjectLoad() {
    state = {
        title: '',
        description: '',
        openingImage: null,
        defaultDuration: 5,
        globalAudioLayers: [],
        slides: []
    };
    activeSlideIndex = 0;
    if (els.previewBg) els.previewBg.src = '';
    if (els.previewFg) els.previewFg.src = '';
    if (els.openImgPreview) els.openImgPreview.src = '';
}

function bindDesktopLibraryReturn() {
    const openBtn = document.getElementById('openProjectDashboardBtn');
    if (openBtn && DESKTOP_MODE) {
        openBtn.addEventListener('click', () => {
            if (DESKTOP_BRIDGE) DESKTOP_BRIDGE.closeCurrentWindow();
        });
    }
}

function applyDesktopEditorUi() {
    const saveModeNote = document.getElementById('editorSaveModeNote');
    const backButton = document.getElementById('openProjectDashboardBtn');
    if (backButton) backButton.textContent = 'Back to Library';
    if (els.exportBtn) {
        els.exportBtn.textContent = 'Export Portable ZIP';
        els.exportBtn.title = 'Export player.html, flow.json, and all project media.';
    }
    if (saveModeNote) {
        saveModeNote.textContent =
            'Save writes flow.json safely. Export creates a browser-playable ZIP that can also be re-imported.';
    }

    document.querySelectorAll('input[type="file"]').forEach(input => {
        input.disabled = true;
        input.title = 'Desktop imports use the protected native file picker.';
    });
    const mediaImportButton = document.getElementById('mediaLibImportBtn');
    if (mediaImportButton) mediaImportButton.style.display = 'inline-block';
    if (els.projectMediaBtn) els.projectMediaBtn.style.display = 'inline-block';

    window.addEventListener('beforeunload', event => {
        if (!unsavedChanges) return;
        event.preventDefault();
        event.returnValue = '';
    });
}

async function exportDesktopPortableProject() {
    if (
        !DESKTOP_BRIDGE
        || typeof DESKTOP_BRIDGE.exportPortableProject !== 'function'
    ) {
        alert('Portable slideshow export is unavailable.');
        return;
    }
    if (unsavedChanges) {
        alert('Save the slideshow before exporting the portable ZIP.');
        return;
    }
    els.exportBtn.disabled = true;
    const originalText = els.exportBtn.textContent;
    els.exportBtn.textContent = 'Preparing ZIP…';
    try {
        const result = await DESKTOP_BRIDGE.exportPortableProject(
            PROJECT_CONTEXT.workspaceId,
            PROJECT_CONTEXT.project
        );
        if (!result || result.cancelled) return;
        if (els.saveStatus) {
            els.saveStatus.textContent = `Exported ${result.filename}`;
            setTimeout(() => {
                if (els.saveStatus && els.saveStatus.textContent.includes(result.filename)) {
                    els.saveStatus.textContent = '';
                }
            }, 5000);
        }
    } catch (error) {
        console.error('Portable slideshow export failed:', error);
        alert(error && error.message ? error.message : 'Could not export the portable slideshow.');
    } finally {
        els.exportBtn.disabled = false;
        els.exportBtn.textContent = originalText;
    }
}

async function loadDesktopProject() {
    if (!DESKTOP_BRIDGE) {
        throw new Error('The desktop bridge is unavailable.');
    }
    if (!PROJECT_CONTEXT.workspaceId || !PROJECT_CONTEXT.project) {
        throw new Error('The editor did not receive a workspace and project.');
    }

    const [loaded, assetBase] = await Promise.all([
        DESKTOP_BRIDGE.loadProjectFlow(
            PROJECT_CONTEXT.workspaceId,
            PROJECT_CONTEXT.project
        ),
        DESKTOP_BRIDGE.getProjectAssetBase(
            PROJECT_CONTEXT.workspaceId,
            PROJECT_CONTEXT.project
        )
    ]);
    if (loaded.readOnly) {
        throw new Error('Copy this example into a local workspace before editing.');
    }

    activeProjectAssetBase = assetBase;
    activeProjectRevision = loaded.revision;
    activePublicationState = {
        isPublished: !!loaded.flow.isPublished,
        publishedAt: loaded.flow.publishedAt || null
    };
    resetEditorStateForProjectLoad();
    loadFromObject(loaded.flow);
    clearUnsaved();
    document.title = `${loaded.flow.title || PROJECT_CONTEXT.project} — Movement Editor`;
    if (els.saveStatus) {
        els.saveStatus.textContent = 'Loaded from the local project library';
        setTimeout(() => els.saveStatus.textContent = '', 4000);
    }
    const desktopParams = new URLSearchParams(window.location.search);
    if (desktopParams.get('smokePreview') === '1') {
        openPlaybackModal();
    } else if (desktopParams.get('smokeEffects') === '1') {
        openEffectsHub('bg');
    } else if (desktopParams.get('smokeMedia') === '1') {
        await openProjectMediaManager();
        DESKTOP_BRIDGE.reportReady({
            surface: 'editor',
            workspaceCount: 0,
            projectCount: 1,
            mediaWrite: typeof DESKTOP_BRIDGE.chooseProjectMedia === 'function',
            mediaManagement: typeof DESKTOP_BRIDGE.getProjectMediaOverview === 'function'
                && typeof DESKTOP_BRIDGE.removeUnusedProjectMedia === 'function',
            importExport: typeof DESKTOP_BRIDGE.exportPortableProject === 'function',
            mediaManagerRows: document.querySelectorAll('.media-usage-row').length
        });
    } else {
        DESKTOP_BRIDGE.reportReady({
            surface: 'editor',
            workspaceCount: 0,
            projectCount: 1,
            mediaWrite: typeof DESKTOP_BRIDGE.chooseProjectMedia === 'function',
            mediaManagement: typeof DESKTOP_BRIDGE.getProjectMediaOverview === 'function'
                && typeof DESKTOP_BRIDGE.removeUnusedProjectMedia === 'function',
            importExport: typeof DESKTOP_BRIDGE.exportPortableProject === 'function'
        });
    }
}


// --- Start ---
function boot() {
    init();

    if (DESKTOP_MODE) {
        applyDesktopEditorUi();
        loadDesktopProject().catch(err => {
            console.error('Failed to load desktop project', err);
            if (els.saveBtn) els.saveBtn.disabled = true;
            if (els.saveStatus) {
                els.saveStatus.textContent = err && err.message
                    ? err.message
                    : 'Could not load this desktop project.';
            }
        });
        return;
    }

    // Auto-load project if injected by PHP
    if (window.INITIAL_PROJECT_DATA && typeof window.INITIAL_PROJECT_DATA === 'object') {
        try {
            console.log("Auto-loading existing project...");
            loadFromObject(window.INITIAL_PROJECT_DATA);
        } catch (e) {
            console.error("Failed to parse INITIAL_PROJECT_DATA", e);
        }
    }
}

boot();


// --- Project-wide Media Manager ---
function bindProjectMediaManagerEvents() {
    if (els.projectMediaBtn) {
        els.projectMediaBtn.addEventListener('click', openProjectMediaManager);
    }
    const closeButton = document.getElementById('closeProjectMediaManagerBtn');
    const refreshButton = document.getElementById('refreshProjectMediaManagerBtn');
    const modal = document.getElementById('project-media-manager-modal');
    if (closeButton) closeButton.addEventListener('click', closeProjectMediaManager);
    if (refreshButton) refreshButton.addEventListener('click', () => refreshProjectMediaManager());
    if (modal) {
        modal.addEventListener('click', event => {
            if (event.target === modal) closeProjectMediaManager();
        });
    }
    document.querySelectorAll('[data-media-manager-import]').forEach(button => {
        button.addEventListener('click', async () => {
            const type = button.dataset.mediaManagerImport;
            button.disabled = true;
            try {
                const result = await chooseDesktopProjectMedia(type, '', false);
                if (!result || result.cancelled) return;
                await refreshProjectMediaManager(`Imported ${result.filename}.`);
            } catch (error) {
                console.error('Project media import failed:', error);
                alert(error && error.message ? error.message : 'Could not import the selected media file.');
            } finally {
                button.disabled = false;
            }
        });
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal && modal.classList.contains('open')) {
            closeProjectMediaManager();
        }
    });
}

async function openProjectMediaManager() {
    if (
        !DESKTOP_MODE
        || !DESKTOP_BRIDGE
        || typeof DESKTOP_BRIDGE.getProjectMediaOverview !== 'function'
    ) {
        alert('The project media manager is available in the desktop edition.');
        return;
    }
    const modal = document.getElementById('project-media-manager-modal');
    const title = document.getElementById('projectMediaManagerTitle');
    if (title) title.textContent = `${state.title || PROJECT_CONTEXT.project || 'Project'} · Media`;
    if (modal) modal.classList.add('open');
    await refreshProjectMediaManager();
}

function closeProjectMediaManager() {
    const modal = document.getElementById('project-media-manager-modal');
    if (modal) modal.classList.remove('open');
}

async function refreshProjectMediaManager(message = '') {
    const content = document.getElementById('projectMediaManagerContent');
    const status = document.getElementById('projectMediaManagerStatus');
    if (!content || !status) return;
    content.replaceChildren(createMediaManagerEmpty('Scanning the saved project…'));
    status.className = 'media-manager-status';
    status.textContent = message;
    try {
        currentProjectMediaOverview = await DESKTOP_BRIDGE.getProjectMediaOverview(
            PROJECT_CONTEXT.workspaceId,
            PROJECT_CONTEXT.project
        );
        renderProjectMediaManager(currentProjectMediaOverview);
        const notes = [];
        if (message) notes.push(message);
        if (unsavedChanges) {
            notes.push('Usage is based on the last saved flow.json. Save the slideshow before removing media.');
            status.classList.add('warning');
        } else {
            notes.push('Unused-file removal is recoverable and is checked against the current saved revision.');
        }
        status.textContent = notes.join(' ');
    } catch (error) {
        console.error('Project media scan failed:', error);
        content.replaceChildren(createMediaManagerEmpty(
            error && error.message ? error.message : 'Could not scan project media.'
        ));
        status.textContent = '';
    }
}

function createMediaManagerEmpty(message) {
    const empty = document.createElement('div');
    empty.className = 'media-empty';
    empty.textContent = message;
    return empty;
}

function formatMediaSize(size) {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createMediaSummaryCard(value, label) {
    const card = document.createElement('div');
    card.className = 'media-summary-card';
    const count = document.createElement('strong');
    count.textContent = String(value);
    const caption = document.createElement('span');
    caption.textContent = label;
    card.append(count, caption);
    return card;
}

function createMediaFileCard(item, options = {}) {
    const card = document.createElement('article');
    card.className = `media-file-card${options.missing ? ' missing' : ''}`;

    const preview = document.createElement('div');
    preview.className = 'media-file-preview';
    if (options.missing) {
        preview.textContent = 'Missing';
    } else if (item.type === 'img') {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = buildProjectAssetUrl(item.filename, 'img');
        image.addEventListener('error', () => {
            preview.replaceChildren();
            preview.textContent = 'No preview';
        }, { once: true });
        preview.appendChild(image);
    } else {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'none';
        audio.src = buildProjectAssetUrl(item.filename, item.type);
        preview.appendChild(audio);
    }

    const text = document.createElement('div');
    text.style.minWidth = '0';
    const name = document.createElement('div');
    name.className = 'media-file-name';
    name.textContent = item.filename;
    name.title = item.filename;
    const detail = document.createElement('div');
    detail.className = 'media-file-detail';
    const roles = (item.references || []).map(reference => reference.role);
    detail.textContent = options.missing
        ? `Referenced but not found${roles.length ? ` · ${roles.join(', ')}` : ''}`
        : (roles.length ? roles.join(', ') : (formatMediaSize(item.size) || 'Unused'));
    text.append(name, detail);
    card.append(preview, text);

    if (options.removable) {
        const removeButton = document.createElement('button');
        removeButton.className = 'btn outline media-file-remove';
        removeButton.type = 'button';
        removeButton.textContent = 'Remove';
        removeButton.disabled = unsavedChanges;
        removeButton.title = unsavedChanges
            ? 'Save the slideshow before removing unused media.'
            : 'Move this unused file to recoverable project media trash.';
        removeButton.addEventListener('click', () => {
            removeUnusedProjectMedia(item, removeButton);
        });
        card.appendChild(removeButton);
    }
    return card;
}

function appendMediaItems(container, items, options = {}) {
    if (items.length === 0) {
        container.appendChild(createMediaManagerEmpty(options.emptyMessage || 'None'));
        return;
    }
    const list = document.createElement('div');
    list.className = 'media-file-list';
    items.forEach(item => list.appendChild(createMediaFileCard(item, options)));
    container.appendChild(list);
}

function createMediaFolderColumn(type, items, options = {}) {
    const labels = { img: 'Images', speech: 'Speech', audio: 'Audio' };
    const column = document.createElement('div');
    column.className = options.usage ? 'media-usage-column' : 'media-folder-column';
    const heading = document.createElement('h4');
    heading.textContent = labels[type];
    column.appendChild(heading);
    appendMediaItems(column, items, options);
    return column;
}

function createMediaManagerSection(title, note = '') {
    const section = document.createElement('section');
    section.className = 'media-manager-section';
    const header = document.createElement('div');
    header.className = 'media-manager-section-head';
    const heading = document.createElement('h3');
    heading.textContent = title;
    header.appendChild(heading);
    if (note) {
        const caption = document.createElement('span');
        caption.textContent = note;
        header.appendChild(caption);
    }
    section.appendChild(header);
    return section;
}

function mediaItemsForReference(overview, type, predicate) {
    const existing = (overview.media[type] || []).flatMap(item => {
        const references = item.references.filter(predicate);
        return references.length ? [{ ...item, references }] : [];
    });
    const missing = (overview.missing[type] || []).flatMap(item => {
        const references = item.references.filter(predicate);
        return references.length ? [{ ...item, references, missing: true }] : [];
    });
    return { existing, missing };
}

function appendUsageColumn(row, overview, type, predicate) {
    const { existing, missing } = mediaItemsForReference(overview, type, predicate);
    const column = document.createElement('div');
    column.className = 'media-usage-column';
    const labels = { img: 'Images', speech: 'Speech', audio: 'Audio' };
    const heading = document.createElement('h4');
    heading.textContent = labels[type];
    column.appendChild(heading);
    const combined = [
        ...existing.map(item => ({ item, missing: false })),
        ...missing.map(item => ({ item, missing: true }))
    ];
    if (combined.length === 0) {
        column.appendChild(createMediaManagerEmpty('No linked files'));
    } else {
        const list = document.createElement('div');
        list.className = 'media-file-list';
        combined.forEach(entry => {
            list.appendChild(createMediaFileCard(entry.item, { missing: entry.missing }));
        });
        column.appendChild(list);
    }
    row.appendChild(column);
}

function createMediaUsageRow(overview, title, predicate) {
    const row = document.createElement('article');
    row.className = 'media-usage-row';
    const heading = document.createElement('div');
    heading.className = 'media-usage-row-title';
    const titleElement = document.createElement('h4');
    titleElement.textContent = title;
    heading.appendChild(titleElement);
    row.appendChild(heading);
    ['img', 'speech', 'audio'].forEach(type => appendUsageColumn(row, overview, type, predicate));
    return row;
}

function renderProjectMediaManager(overview) {
    const content = document.getElementById('projectMediaManagerContent');
    if (!content) return;
    content.replaceChildren();
    const mediaItems = Object.values(overview.media).flat();
    const missingItems = Object.values(overview.missing).flat();
    const unusedItems = mediaItems.filter(item => item.references.length === 0);
    const usedItems = mediaItems.filter(item => item.references.length > 0);

    const summary = document.createElement('div');
    summary.className = 'media-manager-summary';
    summary.append(
        createMediaSummaryCard(mediaItems.length, 'Files in project'),
        createMediaSummaryCard(usedItems.length, 'Files currently used'),
        createMediaSummaryCard(unusedItems.length, 'Unused files'),
        createMediaSummaryCard(missingItems.length, 'Missing references')
    );
    content.appendChild(summary);

    const unusedSection = createMediaManagerSection(
        'Unused Media',
        'Files not referenced by the saved slideshow'
    );
    const unusedColumns = document.createElement('div');
    unusedColumns.className = 'media-unused-columns';
    ['img', 'speech', 'audio'].forEach(type => {
        const items = overview.media[type].filter(item => item.references.length === 0);
        unusedColumns.appendChild(createMediaFolderColumn(type, items, {
            removable: true,
            emptyMessage: 'No unused files'
        }));
    });
    unusedSection.appendChild(unusedColumns);
    content.appendChild(unusedSection);

    if (missingItems.length > 0) {
        const missingSection = createMediaManagerSection(
            'Missing Referenced Media',
            'These names occur in flow.json but the project file is absent'
        );
        const missingColumns = document.createElement('div');
        missingColumns.className = 'media-unused-columns';
        ['img', 'speech', 'audio'].forEach(type => {
            missingColumns.appendChild(createMediaFolderColumn(type, overview.missing[type], {
                missing: true,
                emptyMessage: 'No missing references'
            }));
        });
        missingSection.appendChild(missingColumns);
        content.appendChild(missingSection);
    }

    const usageSection = createMediaManagerSection(
        'Media By Slide',
        'Opening, global, and slide-linked files in presentation order'
    );
    const rows = document.createElement('div');
    rows.className = 'media-usage-rows';
    const hasOpening = ['img', 'speech', 'audio'].some(type => (
        [...overview.media[type], ...overview.missing[type]]
            .some(item => item.references.some(reference => reference.scope === 'opening'))
    ));
    if (hasOpening) {
        rows.appendChild(createMediaUsageRow(
            overview,
            'Opening Image',
            reference => reference.scope === 'opening'
        ));
    }
    const hasGlobal = ['img', 'speech', 'audio'].some(type => (
        [...overview.media[type], ...overview.missing[type]]
            .some(item => item.references.some(reference => reference.scope === 'global'))
    ));
    if (hasGlobal) {
        rows.appendChild(createMediaUsageRow(
            overview,
            'Global Audio',
            reference => reference.scope === 'global'
        ));
    }
    for (let slideNumber = 1; slideNumber <= overview.slideCount; slideNumber += 1) {
        rows.appendChild(createMediaUsageRow(
            overview,
            `Slide ${slideNumber}`,
            reference => reference.scope === 'slide' && reference.slideNumber === slideNumber
        ));
    }
    if (!hasOpening && !hasGlobal && overview.slideCount === 0) {
        rows.appendChild(createMediaManagerEmpty('No slideshow media references yet.'));
    }
    usageSection.appendChild(rows);
    content.appendChild(usageSection);
}

async function removeUnusedProjectMedia(item, button) {
    if (
        !currentProjectMediaOverview
        || !DESKTOP_BRIDGE
        || typeof DESKTOP_BRIDGE.removeUnusedProjectMedia !== 'function'
    ) return;
    if (unsavedChanges) {
        alert('Save the slideshow before removing unused media.');
        return;
    }
    button.disabled = true;
    try {
        const result = await DESKTOP_BRIDGE.removeUnusedProjectMedia(
            PROJECT_CONTEXT.workspaceId,
            PROJECT_CONTEXT.project,
            item.type,
            item.filename,
            currentProjectMediaOverview.revision
        );
        if (!result || result.cancelled) {
            button.disabled = false;
            return;
        }
        desktopMediaVersion = Date.now();
        await refreshProjectMediaManager(`Moved ${result.filename} to recoverable project media trash.`);
        if (activeMediaLibFolder) await refreshDesktopMediaLibrary();
    } catch (error) {
        console.error('Unused media removal failed:', error);
        alert(error && error.message ? error.message : 'Could not remove the unused media file.');
        await refreshProjectMediaManager();
    }
}

// --- Media Library Server Selection ---
let activeMediaLibTarget = null;
let activeMediaLibType = null;
let activeMediaLibFolder = null;

function mediaFolderForTarget(type, inputId) {
    if (type === 'img') return 'img';
    const isAdditionalAudio = inputId.startsWith('globalAudioLayerName-')
        || (inputId.startsWith('audioLayerName-') && !inputId.endsWith('-0'));
    return isAdditionalAudio ? 'audio' : 'speech';
}

async function refreshDesktopMediaLibrary() {
    if (!DESKTOP_MODE || !activeMediaLibFolder) return;
    const files = await window.getMakerMediaList(activeMediaLibFolder);
    renderMediaLibGrid(files, activeMediaLibType);
}

window.openMediaLibrary = async function (type, inputId) {
    activeMediaLibType = type;
    activeMediaLibTarget = inputId;
    activeMediaLibFolder = mediaFolderForTarget(type, inputId);

    // Show Modal
    const modal = document.getElementById('media-library-modal');
    if (!modal) return;
    modal.style.display = 'block';

    const grid = document.getElementById('mediaLibGrid');
    const title = document.getElementById('mediaLibTitle');

    title.textContent = type === 'img' ? 'Select Existing Image' : 'Select Existing Audio';
    grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">Scanning Server Library...</div>';

    if (DESKTOP_MODE) {
        try {
            await refreshDesktopMediaLibrary();
        } catch (err) {
            grid.textContent = err && err.message ? err.message : 'Could not scan project media.';
            console.error('Desktop media library error:', err);
        }
        return;
    }

    try {
        const formData = new FormData();
        formData.append('action', 'list_media');
        formData.append('csrf_token', getCsrfToken());
        const res = await fetch(MAKER_ENDPOINT, { method: 'POST', body: formData });
        const data = await res.json();

        if (data.status === 'success') {
            const files = type === 'img' ? data.media.img : (type === 'audio' ? data.media.audio : data.media.speech);
            renderMediaLibGrid(files, type);
        } else {
            grid.innerHTML = '<div style="color:var(--danger)">Failed to load library.</div>';
        }
    } catch (err) {
        grid.innerHTML = '<div style="color:var(--danger)">Network error while scanning server.</div>';
        console.error("Media Lib Error:", err);
    }
};

window.importMediaIntoActiveLibrary = async function () {
    if (!DESKTOP_MODE || !activeMediaLibFolder) return;
    const grid = document.getElementById('mediaLibGrid');
    const importButton = document.getElementById('mediaLibImportBtn');
    if (importButton) importButton.disabled = true;
    if (grid) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">Importing media...</div>';
    }
    try {
        const result = await chooseDesktopProjectMedia(activeMediaLibFolder, '', false);
        await refreshDesktopMediaLibrary();
        if (result && !result.cancelled && grid) {
            const importedItem = [...grid.querySelectorAll('[data-media-filename]')]
                .find(item => item.dataset.mediaFilename === result.filename);
            if (importedItem) importedItem.style.borderColor = 'var(--primary)';
        }
    } catch (error) {
        console.error('Desktop media import failed:', error);
        if (grid) grid.textContent = error && error.message ? error.message : 'Could not import media.';
    } finally {
        if (importButton) importButton.disabled = false;
    }
};

window.renderMediaLibGrid = function (files, type) {
    const grid = document.getElementById('mediaLibGrid');
    grid.innerHTML = '';

    if (!files || !files.length) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">No files found in this folder.</div>';
        return;
    }

    files.forEach(filename => {
        const item = document.createElement('div');
        item.dataset.mediaFilename = filename;
        const itemH = type === 'img' ? '135px' : '60px';
        item.style.cssText = `height: ${itemH}; min-height: ${itemH}; ${`
            background: rgba(255,255,255,0.05); border: 1px solid var(--border-color);
            flex-shrink: 0; border-radius: var(--app-radius-sm); cursor: pointer;
            display: flex; flex-direction: column; overflow: hidden;
            transition: transform 0.1s, border-color 0.1s;
        ` }`;
        item.onmouseover = () => { item.style.transform = 'scale(1.03)'; item.style.borderColor = 'var(--primary)'; };
        item.onmouseout = () => { item.style.transform = 'scale(1)'; item.style.borderColor = 'var(--border-color)'; };
        item.onclick = () => selectMediaFromLib(filename);

        const previewBox = document.createElement('div');
        const boxH = type === 'img' ? '100px' : '30px';
        previewBox.style.cssText = `height: ${boxH}; min-height: ${boxH}; ${'flex-shrink: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; overflow: hidden;'}`;

        if (type === 'img') {
            const imgPath = buildProjectAssetUrl(filename, 'img') || IMG_BASE_URL + filename;
            previewBox.innerHTML = `<img src="${imgPath}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" onerror="this.onerror=null; this.src=''; this.alt='Missing';">`;
        } else {
            previewBox.innerHTML = `<div style="font-size: 1.2rem; margin-top: -4px; color: var(--primary);">🎵</div>`;
        }

        const label = document.createElement('div');
        label.style.cssText = 'padding: 8px; font-size: 0.75rem; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: rgba(0,0,0,0.2);';
        label.textContent = filename;
        label.title = filename;

        item.appendChild(previewBox);
        item.appendChild(label);
        grid.appendChild(item);
    });
}

window.selectMediaFromLib = function (filename) {
    const modal = document.getElementById('media-library-modal');
    if (modal) modal.style.display = 'none';

    const targetInput = document.getElementById(activeMediaLibTarget);

    if (targetInput) {
        targetInput.value = filename; // Visual text update

        // Update the actual State Model!
        const slide = state.slides[activeSlideIndex];

        if (activeMediaLibTarget === 'openingImageName') {
            state.openingImage = filename;
            if (typeof markUnsaved === 'function') markUnsaved();
            if (typeof renderTimeline === 'function') renderTimeline();
            if (typeof window.renderOpeningImagePreview === 'function') window.renderOpeningImagePreview();
        } else if (activeMediaLibTarget === 'editBgName') {
            slide.bgImage = filename;
            if (typeof markUnsaved === 'function') markUnsaved();
            if (typeof renderTimeline === 'function') renderTimeline();
            if (typeof updatePreview === 'function') updatePreview();
        } else if (activeMediaLibTarget === 'editFgName') {
            slide.fgImage = filename;
            setForegroundLayerValue(0, { src: filename, name: 'Foreground 1' });
            if (typeof markUnsaved === 'function') markUnsaved();
            if (typeof renderTimeline === 'function') renderTimeline();
            if (typeof updatePreview === 'function') updatePreview();
        } else if (activeMediaLibTarget === 'editAudioName') {
            slide.audio = `speech/${filename}`;
            setAudioLayerValue(0, { src: `speech/${filename}`, name: 'Speech' });
            if (typeof markUnsaved === 'function') markUnsaved();
            if (typeof renderTimeline === 'function') renderTimeline();
        } else if (activeMediaLibTarget && activeMediaLibTarget.startsWith('audioLayerName-')) {
            const index = parseInt(activeMediaLibTarget.replace('audioLayerName-', ''), 10);
            if (Number.isFinite(index)) {
                setAudioLayerValue(index, { src: `${index === 0 ? 'speech' : 'audio'}/${filename}` });
                renderEditor();
            }
        } else if (activeMediaLibTarget && activeMediaLibTarget.startsWith('globalAudioLayerName-')) {
            const index = parseInt(activeMediaLibTarget.replace('globalAudioLayerName-', ''), 10);
            if (Number.isFinite(index)) {
                setGlobalAudioLayerValue(index, { src: `audio/${filename}` });
                renderGlobalAudioLayers();
            }
        } else if (activeMediaLibTarget && activeMediaLibTarget.startsWith('foregroundLayerName-')) {
            const index = parseInt(activeMediaLibTarget.replace('foregroundLayerName-', ''), 10);
            if (Number.isFinite(index)) {
                setForegroundLayerValue(index, { src: filename });
                renderEditor();
                updatePreview();
            }
        }
    }
}
