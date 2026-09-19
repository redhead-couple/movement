/**
 * MAKER ENGINE v1
 * Centralized logic for all Effect Makers.
 * Handles URL parameter parsing, Media Library integration,
 * Image selection, and standardized JSON exporting.
 */

// Global state required by older Canvas engines
window.imgData = '';
window.imgName = '';
window.img1Data = '';
window.name1 = '';
window.img2Data = '';
window.name2 = '';
window.currentImageName = '';
window.currentImageDataUrl = '';


document.addEventListener('DOMContentLoaded', () => {

    // --- Inject Global Media Library Modal ---
    if (!document.getElementById('media-library-modal')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="media-library-modal" style="display: none; position: fixed; inset: 0; background: rgba(10,7,6,0.94); z-index: 2500;">
                <div class="media-modal-content" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80%; max-width: 900px; max-height: 80vh; background: #1e293b; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #334155; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
                    <div class="media-modal-header" style="padding: 16px 20px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: white;" id="mediaLibTitle">Server Media Library</h3>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <button id="makerMediaImportBtn" type="button" style="display:none; background:#2563eb; color:white; border:none; border-radius:6px; padding:8px 12px; cursor:pointer;">Import New</button>
                            <button onclick="document.getElementById('media-library-modal').style.display='none'" class="media-modal-close" style="background: none; border: none; font-size: 1.5rem; color: #94a3b8; cursor: pointer;">&times;</button>
                        </div>
                    </div>
                    <div id="mediaLibGrid" style="padding: 20px; overflow-y: auto; flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; align-content: start; align-items: start;">
                        <!-- Items injected here -->
                    </div>
                </div>
            </div>
        `);
    }

    const params = new URLSearchParams(window.location.search);
    const prefilledImg = params.get('img');
    const prefilledUrl = params.get('imgUrl');
    const isEditMode = params.get('mode') === 'edit';
    const topWindow = window.top && window.top !== window ? window.top : null;
    const parentMediaResolver = topWindow && typeof topWindow.resolveMakerMediaUrl === 'function'
        ? topWindow.resolveMakerMediaUrl
        : null;
    const parentMediaList = topWindow && typeof topWindow.getMakerMediaList === 'function'
        ? topWindow.getMakerMediaList
        : null;
    const parentMediaImporter = topWindow && topWindow.PROJECT_CONTEXT?.desktopMode
        && typeof topWindow.importDesktopMediaForMaker === 'function'
        ? topWindow.importDesktopMediaForMaker
        : null;
    const isLocalMode = window.location.protocol === 'file:' || (!parentMediaList && !(topWindow && topWindow.MAKER_ENDPOINT));
    let editEffectData = null;
    let activeMakerMediaType = 'img';
    let activeMakerMediaInput = 'img1';

    function resolveMediaUrl(type, filename) {
        if (!filename) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(filename) || filename.startsWith('/') || filename.startsWith('//')) {
            return filename;
        }
        if (parentMediaResolver) return parentMediaResolver(type, filename);
        const relativeName = filename.replace(new RegExp(`^(?:\\./)?${type}/`, 'i'), '');
        if (type === 'img' && prefilledUrl && relativeName === prefilledImg) return prefilledUrl;
        const base = (topWindow && topWindow.IMG_BASE_URL) || '/img/';
        return base + relativeName.replace(/^\/+/, '');
    }

    function getMakerCsrfToken() {
        return (window.top && window.top.PROJECT_CONTEXT && window.top.PROJECT_CONTEXT.csrfToken)
            || (window.PROJECT_CONTEXT && window.PROJECT_CONTEXT.csrfToken)
            || '';
    }

    async function listMediaFiles(type) {
        if (parentMediaList) return parentMediaList(type);
        const formData = new FormData();
        formData.append('action', 'list_media');
        formData.append('csrf_token', getMakerCsrfToken());
        const endpoint = (topWindow && topWindow.MAKER_ENDPOINT) || '/json-maker.php';
        const res = await fetch(endpoint, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'Could not scan media.');
        return type === 'img' ? data.media.img : data.media.speech;
    }

    if (isEditMode) {
        const storedJson = sessionStorage.getItem('effectEditData');
        if (storedJson) {
            try {
                editEffectData = JSON.parse(storedJson);
            } catch (e) {
                console.error("Failed to parse edit JSON in Engine", e);
            }
        }
    }

    function getFilenameFromSource(src, fallback = '') {
        if (!src || typeof src !== 'string') return fallback;
        if (src.startsWith('data:')) return fallback || 'loaded-image';
        const cleanSrc = src.split('?')[0].split('#')[0];
        const parts = cleanSrc.split('/');
        return parts[parts.length - 1] || fallback;
    }

    function applyResolvedImage(dataUrl, dataTarget, nameTarget) {
        window[dataTarget] = dataUrl;
        if (dataTarget === 'img1Data') {
            window.imgData = window.currentImageDataUrl = dataUrl;
        }
    }

    function applyImageSource(src, inputEl, dataTarget, nameTarget, labelTag, labelColor, explicitFilename = '') {
        if (!src) return Promise.resolve(false);

        const filename = explicitFilename || getFilenameFromSource(src, window[nameTarget] || '');
        src = resolveMediaUrl('img', src);
        // Edit hydration can start a preview before the fetch below finishes.
        // Make its source project-aware immediately, including preloaded blob URLs.
        applyResolvedImage(src, dataTarget, nameTarget);
        if (filename) {
            window[nameTarget] = filename;
            if (nameTarget === 'name1') {
                window.imgName = window.currentImageName = filename;
            }
            renderOverrideLabel(filename, labelTag, labelColor, inputEl);
        }

        if (src.startsWith('data:')) {
            applyResolvedImage(src, dataTarget, nameTarget);
            return Promise.resolve(true);
        }

        return fetch(src)
            .then(res => res.blob())
            .then(blob => {
                return new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        applyResolvedImage(ev.target.result, dataTarget, nameTarget);
                        resolve(true);
                    };
                    reader.readAsDataURL(blob);
                });
            })
            .catch(err => {
                console.error("Failed to preload image:", err);
                applyResolvedImage(src, dataTarget, nameTarget);
                return true;
            });
    }

    // Auto-detect standard single-image input
    const img1Input = document.getElementById('img1Input') || document.getElementById('imgInput');

    if (img1Input) {
        if (parentMediaImporter) {
            bindDesktopImageImport(img1Input, 'img1Data', 'name1');
        } else {
            img1Input.addEventListener('change', (e) => handleImageUpload(e, img1Input, 'img1Data', 'name1'));
        }

        const editConfig = editEffectData && editEffectData.config ? editEffectData.config : null;
        const savedImg1Src = editConfig ? (editConfig.preloadedData1 || editConfig.imgSrc || '') : '';
        const savedImg1Name = editConfig ? getFilenameFromSource(editConfig.imgSrc || '', prefilledImg || '') : '';
        const hasSavedImg1 = !!savedImg1Src;
        const initialImg1Src = hasSavedImg1
            ? savedImg1Src
            : (prefilledUrl || (prefilledImg ? 'img/' + prefilledImg : ''));
        const initialImg1Label = hasSavedImg1 ? 'Saved in effect' : 'Linked to slide';
        const initialImg1Color = hasSavedImg1 ? '#3b82f6' : '#10b981';
        const initialImg1Name = hasSavedImg1 ? savedImg1Name : prefilledImg;

        if (initialImg1Src) {
            applyImageSource(initialImg1Src, img1Input, 'img1Data', 'name1', initialImg1Label, initialImg1Color, initialImg1Name)
                .then(() => {
                    if (window.MakerAPI && window.MakerAPI.onImageLoaded) window.MakerAPI.onImageLoaded();
                    triggerCanvasRun();
                });
        }
    }

    // Support for 2nd Image Input in Dual-Makers
    const img2Input = document.getElementById('img2Input');
    if (img2Input) {
        if (parentMediaImporter) {
            bindDesktopImageImport(img2Input, 'img2Data', 'name2');
        } else {
            img2Input.addEventListener('change', (e) => handleImageUpload(e, img2Input, 'img2Data', 'name2'));
        }

        const editConfig = editEffectData && editEffectData.config ? editEffectData.config : null;
        const savedImg2Src = editConfig ? (editConfig.preloadedData2 || editConfig.imgSrc2 || '') : '';
        const savedImg2Name = editConfig ? getFilenameFromSource(editConfig.imgSrc2 || '', '') : '';
        if (savedImg2Src) {
            applyImageSource(savedImg2Src, img2Input, 'img2Data', 'name2', 'Saved in effect', '#3b82f6', savedImg2Name)
                .then(() => triggerCanvasRun());
        }
    }

    // Support for infinite Images in Slideshow Maker
    const slideshowInput = document.getElementById('slideshowInput');
    if (slideshowInput) {
        if (parentMediaImporter) {
            bindDesktopLibraryImport(slideshowInput, 'slideshow');
        } else {
            slideshowInput.addEventListener('change', (e) => handleImageUpload(e, slideshowInput, 'slideshow', 'slideshow'));
        }
    }
    if (parentMediaImporter) {
        bindDesktopLibraryImport(document.getElementById('slideshowFilesInput'), 'slideshow');
        bindDesktopLibraryImport(document.getElementById('framesInput'), 'frames');
    }


    // --- File selection ---
    function bindDesktopImageImport(inputEl, dataTarget, nameTarget) {
        inputEl.addEventListener('click', async event => {
            event.preventDefault();
            try {
                const result = await parentMediaImporter('img');
                if (!result || result.cancelled) return;
                await applyImageSource(
                    result.url,
                    inputEl,
                    dataTarget,
                    nameTarget,
                    result.disposition === 'replaced' ? 'Replaced in project' : 'Imported to project',
                    '#10b981',
                    result.filename
                );
                if (window.MakerAPI && window.MakerAPI.onImageLoaded) window.MakerAPI.onImageLoaded();
                triggerCanvasRun();
            } catch (error) {
                console.error('Desktop maker media import failed:', error);
                alert(error && error.message ? error.message : 'Could not import the selected image.');
            }
        });
    }

    function bindDesktopLibraryImport(inputEl, inputId) {
        if (!inputEl) return;
        inputEl.addEventListener('click', async event => {
            event.preventDefault();
            try {
                const result = await parentMediaImporter('img');
                if (!result || result.cancelled) return;
                window.selectMediaFromLib(result.filename, inputId);
            } catch (error) {
                console.error('Desktop maker media import failed:', error);
                alert(error && error.message ? error.message : 'Could not import the selected image.');
            }
        }, true);
    }

    function handleImageUpload(e, inputEl, dataTarget, nameTarget) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('action', 'upload_media');
        formData.append('file', file);
        formData.append('csrf_token', getMakerCsrfToken());

        const endpoint = (window.top && window.top.MAKER_ENDPOINT) || '/json-maker.php';
        if (isLocalMode || !endpoint || endpoint === '/json-maker.php') {
            applyLocalUpload(file, inputEl, dataTarget, nameTarget);
            return;
        }
        fetch(endpoint, { method: 'POST', body: formData })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    const filename = data.filename;

                    if (dataTarget === 'slideshow') {
                        if (typeof window.localImages !== 'undefined') {
                            const r = new FileReader();
                            r.onload = ev => {
                                window.localImages.push(ev.target.result);
                                window.fileNames.push(filename);
                                if (typeof window.buildList === 'function') window.buildList();
                                triggerCanvasRun();
                            };
                            r.readAsDataURL(file);
                        }
                        return;
                    }

                    window[nameTarget] = filename;
                    if (nameTarget === 'name1') window.imgName = window.currentImageName = filename;

                    const r = new FileReader();
                    r.onload = ev => {
                        window[dataTarget] = ev.target.result;
                        if (dataTarget === 'img1Data') window.imgData = window.currentImageDataUrl = ev.target.result;
                        triggerCanvasRun();
                    };
                    r.readAsDataURL(file);

                    renderOverrideLabel(filename, 'Custom Override', '#3b82f6', inputEl);
                } else {
                    alert(data.message || 'Could not read the selected file');
                }
            })
            .catch(err => {
                console.error('File selection error', err);
                alert('Could not read the selected file.');
            });
    }

    function applyLocalUpload(file, inputEl, dataTarget, nameTarget) {
        const filename = file.name;

        if (dataTarget === 'slideshow') {
            if (typeof window.localImages !== 'undefined') {
                const r = new FileReader();
                r.onload = ev => {
                    window.localImages.push(ev.target.result);
                    window.fileNames.push(filename);
                    if (typeof window.buildList === 'function') window.buildList();
                    triggerCanvasRun();
                };
                r.readAsDataURL(file);
            }
            return;
        }

        window[nameTarget] = filename;
        if (nameTarget === 'name1') window.imgName = window.currentImageName = filename;

        const r = new FileReader();
        r.onload = ev => {
            window[dataTarget] = ev.target.result;
            if (dataTarget === 'img1Data') window.imgData = window.currentImageDataUrl = ev.target.result;
            triggerCanvasRun();
        };
        r.readAsDataURL(file);

        renderOverrideLabel(filename, 'Local image', '#3b82f6', inputEl);
    }

    function renderOverrideLabel(filename, tag, color, inputEl) {
        let overrideId = 'overrideLabel';
        if (inputEl && inputEl.id === 'img2Input') overrideId = 'overrideLabel2';

        let lbl = document.getElementById(overrideId);
        if (!lbl) {
            const overrideContainer = inputEl && inputEl.id === 'img2Input'
                ? document.getElementById('overrideContainer2')
                : (document.getElementById('overrideContainer1') || document.getElementById('overrideContainer'));

            if (overrideContainer) {
                overrideContainer.innerHTML = `<div id="${overrideId}" style="width:100%; font-size:0.85rem; color:${color}; margin-top:8px;"></div>`;
            } else if (inputEl && inputEl.parentNode) {
                inputEl.parentNode.insertAdjacentHTML('beforeend', `<div id="${overrideId}" style="width:100%; font-size:0.85rem; color:${color}; margin-top:8px;"></div>`);
            }
            lbl = document.getElementById(overrideId);
        }

        if (lbl) {
            lbl.style.color = color;
            lbl.innerHTML = `✔ ${tag}: <br><strong style="color:white; word-break:break-all;">${filename}</strong>`;
        }
    }


    // --- Media Library Modal ---
    window.openMediaLibrary = async function (type, inputId = 'img1') {
        activeMakerMediaType = type;
        activeMakerMediaInput = inputId;
        let modal = document.getElementById('media-library-modal');
        if (!modal) {
            console.error("Maker Engine: No media-library-modal found in DOM.");
            return;
        }
        modal.style.display = 'block';
        const grid = document.getElementById('mediaLibGrid');
        if (!grid) return;
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 40px;">Scanning Server Library...</div>';

        try {
            const files = await listMediaFiles(type);
            grid.innerHTML = '';
            if (!files || !files.length) {
                grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 40px;">No files found in this folder.</div>';
                return;
            }
            files.forEach(filename => {
                const item = document.createElement('div');
                const itemH = type === 'img' ? '135px' : '60px';
                item.style.cssText = `
                         background: rgba(255,255,255,0.05); border: 1px solid #334155;
                         height: ${itemH}; min-height: ${itemH}; flex-shrink: 0;
                         border-radius: 6px; cursor: pointer;
                         display: flex; flex-direction: column; overflow: hidden;
                         transition: transform 0.1s, border-color 0.1s;
                     `;
                item.onmouseover = () => { item.style.transform = 'scale(1.03)'; item.style.borderColor = '#10b981'; };
                item.onmouseout = () => { item.style.transform = 'scale(1)'; item.style.borderColor = '#334155'; };
                item.onclick = () => selectMediaFromLib(filename, inputId);

                const previewBox = document.createElement('div');
                const boxH = type === 'img' ? '100px' : '30px';
                previewBox.style.cssText = `height: ${boxH}; min-height: ${boxH}; flex-shrink: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; overflow: hidden;`;

                if (type === 'img') {
                    const imgPath = resolveMediaUrl('img', filename);
                    previewBox.innerHTML = `<img src="${imgPath}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy">`;
                } else {
                    previewBox.innerHTML = `<div style="font-size: 1.2rem; margin-top: -4px; color: #2563eb;">🎵</div>`;
                }

                const label = document.createElement('div');
                label.style.cssText = 'color: white; padding: 8px; font-size: 0.75rem; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: rgba(0,0,0,0.2);';
                label.textContent = filename;
                label.title = filename;

                item.appendChild(previewBox);
                item.appendChild(label);
                grid.appendChild(item);
            });
        } catch (err) {
            grid.innerHTML = '<div style="color:#ef4444">Network error while scanning server.</div>';
            console.error("Media Lib Error:", err);
        }
    };

    const makerImportButton = document.getElementById('makerMediaImportBtn');
    if (makerImportButton && parentMediaImporter) {
        makerImportButton.style.display = 'inline-block';
        makerImportButton.addEventListener('click', async () => {
            makerImportButton.disabled = true;
            try {
                const result = await parentMediaImporter(activeMakerMediaType);
                if (!result || result.cancelled) return;
                await window.openMediaLibrary(activeMakerMediaType, activeMakerMediaInput);
            } catch (error) {
                console.error('Desktop maker media import failed:', error);
                alert(error && error.message ? error.message : 'Could not import the selected media file.');
            } finally {
                makerImportButton.disabled = false;
            }
        });
    }

    window.selectMediaFromLib = function (filename, inputId = 'img1') {
        let modal = document.getElementById('media-library-modal');
        if (modal) modal.style.display = 'none';

        if (inputId === 'frames' && typeof window.handleFrameLibrarySelection === 'function') {
            window.handleFrameLibrarySelection(filename);
            return;
        }

        const fileUrl = resolveMediaUrl('img', filename);

        if (inputId === 'slideshow') {
            if (typeof window.localImages !== 'undefined') {
                fetch(fileUrl).then(r => r.blob()).then(b => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        window.localImages.push(ev.target.result);
                        window.fileNames.push(filename);
                        if (typeof window.buildList === 'function') window.buildList();
                        triggerCanvasRun();
                    };
                    reader.readAsDataURL(b);
                });
            }
            return;
        }

        const dataTarget = inputId === 'img2' ? 'img2Data' : 'img1Data';
        const nameTarget = inputId === 'img2' ? 'name2' : 'name1';
        const inputEl = inputId === 'img2'
            ? document.getElementById('img2Input')
            : (document.getElementById('img1Input') || document.getElementById('imgInput'));

        window[nameTarget] = filename;
        if (nameTarget === 'name1') window.imgName = window.currentImageName = filename;

        // Trigger override UI
        renderOverrideLabel(filename, 'Custom Target', '#3b82f6', inputEl);

        fetch(fileUrl)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onload = ev => {
                    window[dataTarget] = ev.target.result;
                    if (dataTarget === 'img1Data') window.imgData = window.currentImageDataUrl = ev.target.result;
                    triggerCanvasRun();
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                console.error("Failed to fetch library image:", err);
                triggerCanvasRun();
            });
    };


    // --- Canvas Trigger Proxy ---
    function triggerCanvasRun() {
        if (typeof window.run === 'function') window.run();
        else if (typeof window.runPreview === 'function') window.runPreview();
        else if (typeof window.MakerAPI?.run === 'function') window.MakerAPI.run();
    }


    // --- Export Logic ---
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (!window.MakerAPI || !window.MakerAPI.getExportJSON) {
                console.error("MakerEngine: No MakerAPI exporter configured on this page.");
                return;
            }

            // Check if we are running inside an iframe
            if (window.parent && window.parent !== window) {
                const def = window.MakerAPI.getExportJSON();
                window.parent.postMessage(def, '*');
            } else {
                let fname = document.getElementById('filename')?.value || 'effect.json';
                if (!fname.endsWith('.json')) fname += '.json';

                const def = window.MakerAPI.getExportJSON();
                const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = fname;
                a.click();
            }
        });
    }

    // Global Hub Apply Listener
    window.addEventListener('message', (e) => {
        if (e.data === 'trigger_apply' && downloadBtn) {
            downloadBtn.click();
        }
    });


    // --- Edit Mode Rehydration ---
    // If the Hub opens an effect for editing, it stores it in sessionStorage.
    // We parse it and pass config to MakerAPI to reset local sliders.
    if (isEditMode && editEffectData && editEffectData.config) {
        const effectData = editEffectData;

        // 1. Auto-Hydrate DOM elements that match config keys
        Object.keys(effectData.config).forEach(k => {
            const el = document.getElementById(k);
            if (el) {
                el.value = effectData.config[k];
                el.dispatchEvent(new Event('input'));
                el.dispatchEvent(new Event('change'));
            }
        });

        // 1b. Slideshow Custom Rehydration
        if (effectData.config.images && Array.isArray(effectData.config.images)) {
            if (typeof window.fileNames !== 'undefined' && typeof window.localImages !== 'undefined') {
                effectData.config.images.forEach((img, i) => {
                    const cleanedName = img.replace('img/', '');
                    window.fileNames.push(cleanedName);

                    if (effectData.config.preloadedImages && effectData.config.preloadedImages[i]) {
                        window.localImages.push(effectData.config.preloadedImages[i]);
                    } else {
                        // Fallback to static path if preloader failed
                        window.localImages.push(resolveMediaUrl('img', img));
                    }
                });
                if (typeof window.buildList === 'function') window.buildList();
            }
        }

        // 2. Optional Manual Override API
        if (window.MakerAPI && window.MakerAPI.loadEditConfig) {
            window.MakerAPI.loadEditConfig(effectData.config);
        }
        triggerCanvasRun();
    }

});
