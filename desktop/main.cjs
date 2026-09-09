const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  screen,
  session,
  shell
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const {
  getPortableStorageLocationLabel,
  getStorageLocationLabel,
  prepareWritableStorageRoot,
  resolvePackagedStorageRoot,
  resolvePortableStorageRoot
} = require('./services/storage-location-service.cjs');
const { createRegistryService } = require('./services/registry-service.cjs');
const { createWorkspaceService } = require('./services/workspace-service.cjs');
const {
  loadWindowState,
  saveWindowState
} = require('./services/window-state-service.cjs');

const APP_ID = 'org.movement.timelinestudio';
const APP_TITLE = 'Movement Timeline Studio';
const APP_SCHEME = 'movement-app';
const PROJECT_SCHEME = 'movement-project';
const APPLICATION_ROOT = path.resolve(__dirname, '..');
const APP_VERSION = app.getVersion();
const APP_ICON_ICO_PATH = path.join(APPLICATION_ROOT, 'desktop', 'assets', 'movement-icon.ico');
const APP_ICON_PNG_PATH = path.join(APPLICATION_ROOT, 'desktop', 'assets', 'movement-icon.png');
const UI_PATH = path.join(__dirname, '..', 'shared', 'frontend', 'index.html');
const EDITOR_PATH = path.join(__dirname, '..', 'studio', 'editor', 'json-maker.html');
const PLAYER_PATH = path.join(__dirname, '..', 'studio', 'player', 'local-player.html');
const REGISTRY_EDITOR_PATH = path.join(
  __dirname,
  '..',
  'studio',
  'authoring',
  'registry-editor.html'
);
const EFFECT_PROMPT_BUILDER_PATH = path.join(
  __dirname,
  '..',
  'studio',
  'authoring',
  'effect-prompt-builder.html'
);
const TRUSTED_RENDERER_PATHS = new Set(
  [
    UI_PATH,
    EDITOR_PATH,
    PLAYER_PATH,
    REGISTRY_EDITOR_PATH,
    EFFECT_PROMPT_BUILDER_PATH
  ].map(path.normalize)
);
const SMOKE_TEST = process.env.MOVEMENT_ELECTRON_SMOKE_TEST === '1';
const SMOKE_SURFACE = [
  'editor',
  'player',
  'preview',
  'effects',
  'registry',
  'prompt-builder',
  'transition-prompt-builder'
].includes(
  process.env.MOVEMENT_ELECTRON_SMOKE_SURFACE
)
  ? process.env.MOVEMENT_ELECTRON_SMOKE_SURFACE
  : 'library';

let mainWindow = null;
let workspaceService = null;
let registryService = null;
let projectStorageRoot = null;
let projectStorageDetails = null;
let developerFilesRoot = null;
let registryEditorWindow = null;
let effectPromptBuilderWindow = null;
let transitionPromptBuilderWindow = null;
const childWindows = new Set();
const appProtocolStats = { served: new Set(), notFound: 0 };
const projectProtocolStats = { requests: 0, served: 0, notFound: 0 };
let smokeFailureTimer = null;

if (SMOKE_TEST) {
  app.disableHardwareAcceleration();
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: PROJECT_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const ROOT_APP_RESOURCES = new Set([
  'studio/hubs/effects-hub.html',
  'studio/authoring/effect-prompt-builder.html',
  'studio/authoring/effect-prompt-template.js',
  'effects/registry.json',
  'effects/effect-media.js',
  'studio/editor/json-maker.html',
  'studio/editor/editor-layout.css',
  'studio/editor/editor-layout.js',
  'studio/editor/json-maker-logic.js',
  'studio/player/local-player.html',
  'studio/maker/maker-engine.js',
  'studio/maker/maker-scroll-guard.css',
  'studio/maker/maker-scroll-guard.js',
  'studio/maker/maker-theme.css',
  'studio/player/player-runtime.js',
  'studio/authoring/registry-editor.html',
  'studio/hubs/transitions-hub.html',
  'studio/authoring/transition-prompt-template.js',
  'transitions/registry.json'
]);
const MEDIA_DIALOG_FILTERS = Object.freeze({
  img: [
    { name: 'Supported images', extensions: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'] }
  ],
  speech: [
    { name: 'Supported audio', extensions: ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'] }
  ],
  audio: [
    { name: 'Supported audio', extensions: ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav'] }
  ]
});

function isWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isAllowedAppResource(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (ROOT_APP_RESOURCES.has(normalized)) return true;
  if (/^[a-z0-9-]+-maker\.html$/i.test(normalized)) return true;
  if (/^assets\/app\.css$/i.test(normalized)) return true;
  if (/^img\/bg_wanaka\.webp$/i.test(normalized)) return true;
  if (/^effects\/[a-z0-9-]+-(?:engine\.js|maker\.html)$/i.test(normalized)) return true;
  if (/^transitions\/[a-z0-9-]+-(?:engine\.js|maker\.html)$/i.test(normalized)) return true;
  return /^shared\/frontend\/(?:index\.html|(?:app|project-library)\.css|(?:app|creator-tools|platform-adapter)\.js)$/i.test(normalized);
}

function resolveAppResource(candidate) {
  const parsed = candidate instanceof URL ? candidate : new URL(candidate);
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== 'ui') {
    throw new Error('Unknown application resource.');
  }

  const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const relativePath = parts.join('/');
  const resourcePath = path.resolve(APPLICATION_ROOT, ...parts);
  if (!relativePath || !isWithinRoot(APPLICATION_ROOT, resourcePath) || !isAllowedAppResource(relativePath)) {
    throw new Error('Application resource is not allowed.');
  }
  return { relativePath, resourcePath };
}

function buildAppUrl(filePath, query = {}) {
  if (!isWithinRoot(APPLICATION_ROOT, filePath)) {
    throw new Error('Application page is outside the application root.');
  }
  const relativePath = path.relative(APPLICATION_ROOT, filePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');
  const url = new URL(`${APP_SCHEME}://ui/${relativePath}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function isTrustedRendererUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === `${APP_SCHEME}:`) {
      const { resourcePath } = resolveAppResource(parsed);
      return TRUSTED_RENDERER_PATHS.has(path.normalize(resourcePath));
    }
    return parsed.protocol === 'file:'
      && TRUSTED_RENDERER_PATHS.has(path.normalize(fileURLToPath(parsed)));
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event) {
  const senderUrl = event.senderFrame && event.senderFrame.url;
  if (!senderUrl || !isTrustedRendererUrl(senderUrl)) {
    throw new Error('Rejected IPC request from an untrusted renderer.');
  }
}

function getRuntimeContext() {
  return {
    edition: 'desktop',
    application: {
      name: APP_TITLE,
      version: APP_VERSION
    },
    storage: projectStorageDetails,
    currentWorkspace: workspaceService.getCurrentWorkspace(),
    capabilities: {
      authentication: false,
      workspaceSelection: true,
      workspaceWrite: true,
      projectWrite: true,
      projectFlowWrite: true,
      recoverableDeletion: true,
      recoveryInterface: true,
      mediaWrite: true,
      mediaManagement: true,
      importExport: true,
      registryManagement: true,
      effectPromptBuilder: true,
      transitionPromptBuilder: true,
      publishing: false
    }
  };
}

function registerIpcHandlers() {
  ipcMain.handle('runtime:get-context', event => {
    assertTrustedIpcSender(event);
    return getRuntimeContext();
  });

  ipcMain.handle('runtime:open-project-storage', async event => {
    assertTrustedIpcSender(event);
    if (!projectStorageRoot) {
      throw new Error('The project library is not available.');
    }

    const openError = await shell.openPath(projectStorageRoot);
    if (openError) {
      throw new Error(`Windows could not open the project library: ${openError}`);
    }
    return { opened: true };
  });

  ipcMain.handle('runtime:open-developer-files', async event => {
    assertTrustedIpcSender(event);
    if (!developerFilesRoot) {
      throw new Error('The application files are not available.');
    }
    const openError = await shell.openPath(developerFilesRoot);
    if (openError) {
      throw new Error(`Windows could not open the application files: ${openError}`);
    }
    return { opened: true };
  });

  ipcMain.handle('runtime:open-registry-editor', (event, type) => {
    assertTrustedIpcSender(event);
    const safeType = type === 'transitions' ? 'transitions' : 'effects';
    createRegistryEditorWindow(safeType);
    return { opened: true, type: safeType };
  });

  ipcMain.handle('runtime:open-effect-prompt-builder', event => {
    assertTrustedIpcSender(event);
    createEffectPromptBuilderWindow();
    return { opened: true };
  });

  ipcMain.handle('runtime:open-transition-prompt-builder', event => {
    assertTrustedIpcSender(event);
    createTransitionPromptBuilderWindow();
    return { opened: true };
  });

  ipcMain.handle('prompt:copy', (event, prompt) => {
    assertTrustedIpcSender(event);
    const safePrompt = String(prompt || '');
    if (!safePrompt.trim()) throw new Error('Generate a prompt before copying it.');
    if (Buffer.byteLength(safePrompt, 'utf8') > 1024 * 1024) {
      throw new Error('The generated prompt is too large to copy.');
    }
    clipboard.writeText(safePrompt);
    return { copied: true };
  });

  ipcMain.handle('prompt:save', async (event, prompt, suggestedName) => {
    assertTrustedIpcSender(event);
    const safePrompt = String(prompt || '');
    if (!safePrompt.trim()) throw new Error('Generate a prompt before saving it.');
    if (Buffer.byteLength(safePrompt, 'utf8') > 1024 * 1024) {
      throw new Error('The generated prompt is too large to save.');
    }
    const safeName = String(suggestedName || 'movement-effect-prompt')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'movement-effect-prompt';
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(ownerWindow || undefined, {
      title: 'Save effect prompt',
      defaultPath: `${safeName.replace(/\.md$/i, '')}.md`,
      filters: [{ name: 'Markdown document', extensions: ['md'] }],
      properties: ['showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    const targetPath = result.filePath.toLowerCase().endsWith('.md')
      ? result.filePath
      : `${result.filePath}.md`;
    fs.writeFileSync(targetPath, safePrompt, { encoding: 'utf8' });
    return { cancelled: false, filename: path.basename(targetPath) };
  });

  ipcMain.handle('registry:list', event => {
    assertTrustedIpcSender(event);
    return registryService.listRegistries();
  });

  ipcMain.handle('registry:save', (event, type, registry, expectedRevision) => {
    assertTrustedIpcSender(event);
    const result = registryService.saveRegistry(
      String(type || ''),
      registry,
      String(expectedRevision || '')
    );
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('registry:changed', { type: String(type || '') });
      }
    }
    return result;
  });

  ipcMain.handle('workspace:list', event => {
    assertTrustedIpcSender(event);
    return workspaceService.listWorkspaces();
  });

  ipcMain.handle('workspace:list-projects', (event, workspaceId) => {
    assertTrustedIpcSender(event);
    return workspaceService.listProjects(String(workspaceId || ''));
  });

  ipcMain.handle('workspace:select', (event, workspaceId) => {
    assertTrustedIpcSender(event);
    return workspaceService.selectWorkspace(String(workspaceId || ''));
  });

  ipcMain.handle('workspace:create', (event, name) => {
    assertTrustedIpcSender(event);
    return workspaceService.createWorkspace(String(name || ''));
  });

  ipcMain.handle('project:create', (event, workspaceId, title) => {
    assertTrustedIpcSender(event);
    return workspaceService.createProject(
      String(workspaceId || ''),
      String(title || '')
    );
  });

  ipcMain.handle('project:load-flow', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    return workspaceService.loadProjectFlow(
      String(workspaceId || ''),
      String(projectId || '')
    );
  });

  ipcMain.handle(
    'project:save-flow',
    (event, workspaceId, projectId, flow, expectedRevision) => {
      assertTrustedIpcSender(event);
      return workspaceService.saveProjectFlow(
        String(workspaceId || ''),
        String(projectId || ''),
        flow,
        expectedRevision ? String(expectedRevision) : null
      );
    }
  );

  ipcMain.handle('project:copy-example', (event, exampleId, targetWorkspaceId) => {
    assertTrustedIpcSender(event);
    return workspaceService.copyExample(
      String(exampleId || ''),
      String(targetWorkspaceId || '')
    );
  });

  ipcMain.handle('project:duplicate', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    return workspaceService.duplicateProject(
      String(workspaceId || ''),
      String(projectId || '')
    );
  });

  ipcMain.handle('project:rename', (event, workspaceId, projectId, title) => {
    assertTrustedIpcSender(event);
    return workspaceService.renameProject(
      String(workspaceId || ''),
      String(projectId || ''),
      String(title || '')
    );
  });

  ipcMain.handle('project:trash', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    return workspaceService.moveProjectToTrash(
      String(workspaceId || ''),
      String(projectId || '')
    );
  });

  ipcMain.handle('project:list-trash', (event, workspaceId) => {
    assertTrustedIpcSender(event);
    return workspaceService.listTrashedProjects(String(workspaceId || ''));
  });

  ipcMain.handle('project:restore-trash', async (event, workspaceId, trashId) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const safeTrashId = String(trashId || '');
    const entry = workspaceService.listTrashedProjects(safeWorkspaceId)
      .find(item => item.trashId === safeTrashId);
    if (!entry) throw new Error('Trashed slideshow not found.');

    let restoreAsCopy = false;
    if (entry.conflict) {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options = {
        type: 'warning',
        title: 'Slideshow name already exists',
        message: `"${entry.title}" cannot return to its original project folder.`,
        detail: 'Restore it as a separate copy with a unique folder name, or cancel. The existing slideshow will not be changed.',
        buttons: ['Restore as Copy', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      };
      const choice = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options);
      if (choice.response !== 0) return { cancelled: true };
      restoreAsCopy = true;
    }

    return workspaceService.restoreProjectFromTrash(
      safeWorkspaceId,
      safeTrashId,
      restoreAsCopy
    );
  });

  ipcMain.handle('project:delete-trash', async (event, workspaceId, trashId) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const safeTrashId = String(trashId || '');
    const entry = workspaceService.listTrashedProjects(safeWorkspaceId)
      .find(item => item.trashId === safeTrashId);
    if (!entry) throw new Error('Trashed slideshow not found.');

    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      type: 'warning',
      title: 'Delete slideshow forever?',
      message: `Delete “${entry.title}” forever?`,
      detail: 'Its flow, images, speech, audio, and backups cannot be recovered.',
      buttons: ['Cancel', 'Delete Forever'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    };
    const choice = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (choice.response !== 1) return { deleted: false, cancelled: true };

    return workspaceService.deleteTrashedProject(safeWorkspaceId, safeTrashId);
  });

  ipcMain.handle('project:export-portable', async (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const safeProjectId = String(projectId || '');
    workspaceService.loadProjectFlow(safeWorkspaceId, safeProjectId);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Export Portable Slideshow',
      buttonLabel: 'Export',
      defaultPath: path.join(app.getPath('downloads'), `${safeProjectId}.zip`),
      filters: [{ name: 'Portable slideshow ZIP', extensions: ['zip'] }]
    };
    const selection = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { cancelled: true };
    return workspaceService.exportPortableProject(
      safeWorkspaceId,
      safeProjectId,
      selection.filePath
    );
  });

  ipcMain.handle('project:import-portable', async (event, workspaceId) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Import Portable Slideshow',
      buttonLabel: 'Inspect and Import',
      properties: ['openFile'],
      filters: [{ name: 'Portable slideshow ZIP', extensions: ['zip'] }]
    };
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };

    const inspection = workspaceService.inspectPortableProject(
      safeWorkspaceId,
      selection.filePaths[0]
    );
    let importAsCopy = false;
    if (inspection.conflict) {
      const conflictOptions = {
        type: 'warning',
        title: 'Slideshow already exists',
        message: `“${inspection.title}” conflicts with a project already in this workspace.`,
        detail: 'Import it as a new copy with a unique project name, or cancel. The existing project will not be changed.',
        buttons: ['Import as Copy', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      };
      const choice = owner
        ? await dialog.showMessageBox(owner, conflictOptions)
        : await dialog.showMessageBox(conflictOptions);
      if (choice.response !== 0) return { cancelled: true };
      importAsCopy = true;
    }

    return workspaceService.importPortableProject(
      safeWorkspaceId,
      selection.filePaths[0],
      importAsCopy
    );
  });

  ipcMain.handle('project:get-thumbnail', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    return workspaceService.getProjectThumbnail(
      String(workspaceId || ''),
      String(projectId || '')
    );
  });

  ipcMain.handle('project:list-media', (event, workspaceId, projectId, type) => {
    assertTrustedIpcSender(event);
    return workspaceService.listProjectMedia(
      String(workspaceId || ''),
      String(projectId || ''),
      String(type || '')
    );
  });

  ipcMain.handle('project:get-media-overview', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    return workspaceService.getProjectMediaOverview(
      String(workspaceId || ''),
      String(projectId || '')
    );
  });

  ipcMain.handle(
    'project:remove-unused-media',
    async (event, workspaceId, projectId, type, filename, expectedRevision) => {
      assertTrustedIpcSender(event);
      const safeWorkspaceId = String(workspaceId || '');
      const safeProjectId = String(projectId || '');
      const safeType = String(type || '');
      const safeFilename = String(filename || '');
      const overview = workspaceService.getProjectMediaOverview(safeWorkspaceId, safeProjectId);
      if (overview.readOnly) {
        throw new Error('Copy this example into a local workspace before removing media.');
      }
      const item = overview.media[safeType]
        && overview.media[safeType].find(candidate => candidate.filename === safeFilename);
      if (!item) throw new Error('The project media file was not found.');
      if (item.references.length > 0) {
        throw new Error('This file is used by the slideshow and cannot be removed.');
      }

      const owner = BrowserWindow.fromWebContents(event.sender);
      const options = {
        type: 'warning',
        title: 'Remove unused media',
        message: `Move “${safeFilename}” out of this project’s media library?`,
        detail: 'The file is not referenced by the saved slideshow. It will be moved to recoverable project media trash.',
        buttons: ['Cancel', 'Move to Project Trash'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      };
      const choice = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options);
      if (choice.response !== 1) return { cancelled: true };

      return workspaceService.moveUnusedProjectMediaToTrash(
        safeWorkspaceId,
        safeProjectId,
        safeType,
        safeFilename,
        expectedRevision ? String(expectedRevision) : null
      );
    }
  );

  ipcMain.handle('project:choose-media', async (event, workspaceId, projectId, requestedType) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const safeProjectId = String(projectId || '');
    const type = String(requestedType || '');
    if (!MEDIA_DIALOG_FILTERS[type]) throw new Error('Unknown media type.');
    const loaded = workspaceService.loadProjectFlow(safeWorkspaceId, safeProjectId);
    if (loaded.readOnly) {
      throw new Error('Copy this example into a local workspace before importing media.');
    }

    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: type === 'img' ? 'Import an image' : 'Import an audio file',
      buttonLabel: 'Import',
      properties: ['openFile'],
      filters: MEDIA_DIALOG_FILTERS[type]
    };
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };

    let result = workspaceService.importProjectMedia(
      safeWorkspaceId,
      safeProjectId,
      type,
      selection.filePaths[0],
      false
    );
    if (result.status !== 'needs_confirmation') return result;

    const choiceOptions = {
      type: 'warning',
      title: 'Media file already exists',
      message: `“${result.filename}” already exists in this project.`,
      detail: 'Use the existing project file, replace it with the selected file, or cancel the import.',
      buttons: ['Use Existing', 'Replace', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    };
    const choice = owner
      ? await dialog.showMessageBox(owner, choiceOptions)
      : await dialog.showMessageBox(choiceOptions);
    if (choice.response === 2) return { cancelled: true };
    if (choice.response === 0) {
      return { ...result, status: 'success', disposition: 'existing' };
    }

    result = workspaceService.importProjectMedia(
      safeWorkspaceId,
      safeProjectId,
      type,
      selection.filePaths[0],
      true
    );
    return result;
  });

  ipcMain.handle('project:get-asset-base', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const safeProjectId = String(projectId || '');
    workspaceService.loadProjectFlow(safeWorkspaceId, safeProjectId);
    return `${PROJECT_SCHEME}://asset/${encodeURIComponent(safeWorkspaceId)}/${
      encodeURIComponent(safeProjectId)
    }/`;
  });

  ipcMain.handle('runtime:open-editor', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const safeProjectId = String(projectId || '');
    const loaded = workspaceService.loadProjectFlow(safeWorkspaceId, safeProjectId);
    if (loaded.readOnly) {
      throw new Error('Copy this example into a local workspace before editing.');
    }
    createEditorWindow(safeWorkspaceId, safeProjectId);
    return { opened: true };
  });

  ipcMain.handle('runtime:open-player', (event, workspaceId, projectId) => {
    assertTrustedIpcSender(event);
    const safeWorkspaceId = String(workspaceId || '');
    const safeProjectId = String(projectId || '');
    workspaceService.loadProjectFlow(safeWorkspaceId, safeProjectId);
    createPlayerWindow(safeWorkspaceId, safeProjectId);
    return { opened: true };
  });

  ipcMain.on('runtime:close-window', event => {
    assertTrustedIpcSender(event);
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target && target !== mainWindow) {
      target.once('closed', () => {
        setImmediate(focusMainWindow);
      });
      target.close();
    }
  });

  ipcMain.on('runtime:renderer-ready', (event, details) => {
    assertTrustedIpcSender(event);
    if (!SMOKE_TEST) return;

    const workspaceCount = Number(details && details.workspaceCount) || 0;
    const projectCount = Number(details && details.projectCount) || 0;
    const surface = String(details && details.surface || 'library').replace(/[^a-z-]/gi, '');
    if (surface !== SMOKE_SURFACE) return;
    if (details && details.error) {
      console.error(`ELECTRON_SMOKE_TEST_FAILED ${surface} ${String(details.error)}`);
      app.exit(1);
      return;
    }
    if (appProtocolStats.notFound > 0) {
      console.error(
        `ELECTRON_SMOKE_TEST_FAILED ${surface} had ${appProtocolStats.notFound} missing application resources`
      );
      app.exit(1);
      return;
    }
    if (surface === 'library' && !appProtocolStats.served.has('img/bg_wanaka.webp')) {
      console.error('ELECTRON_SMOKE_TEST_FAILED library did not load the homepage hero image');
      app.exit(1);
      return;
    }
    if (
      surface === 'library'
      && !(
        details
        && details.importExport
        && details.recoveryInterface
        && details.recoveryButton
        && details.registryInterface
        && details.promptBuilderInterface
      )
    ) {
      console.error('ELECTRON_SMOKE_TEST_FAILED library write bridge is unavailable');
      app.exit(1);
      return;
    }
    if (
      surface === 'library'
      && !(
        details
        && details.storageInterface
        && details.storageWritable
        && details.storageLabel === projectStorageDetails.label
        && Boolean(details.storagePackaged) === app.isPackaged
      )
    ) {
      console.error('ELECTRON_SMOKE_TEST_FAILED project storage location is unavailable');
      app.exit(1);
      return;
    }
    if (
      surface === 'library'
      && (
        details.applicationVersion !== APP_VERSION
        || !String(details.versionLabel || '').includes(APP_VERSION)
      )
    ) {
      console.error('ELECTRON_SMOKE_TEST_FAILED application version is not visible');
      app.exit(1);
      return;
    }
    if (
      surface === 'editor'
      && !(details && details.mediaWrite && details.mediaManagement && details.importExport)
    ) {
      console.error('ELECTRON_SMOKE_TEST_FAILED editor media bridge is unavailable');
      app.exit(1);
      return;
    }
    if (
      surface === 'effects'
      && !(
        details
        && details.registryHubButton
        && details.registryInterface
        && details.promptBuilderHubButton
        && details.promptBuilderInterface
      )
    ) {
      console.error('ELECTRON_SMOKE_TEST_FAILED Effects Hub developer controls are unavailable');
      app.exit(1);
      return;
    }
    if (
      surface === 'registry'
      && !(
        details
        && details.registryLoaded
        && details.registryCleanList
        && details.experimentalCategories
        && Boolean(details.registryWritable) === registryService.listRegistries().writable
      )
    ) {
      console.error('ELECTRON_SMOKE_TEST_FAILED registry editor did not load its catalogs');
      app.exit(1);
      return;
    }
    if (
      ['prompt-builder', 'transition-prompt-builder'].includes(surface)
      && !(
        details
        && details.registryLoaded
        && details.experimentalCategory
        && details.parameterCount >= 20
        && details.improvementInterface
        && details.promptGenerated
        && details.copyInterface
        && details.saveInterface
        && details.builderKind === (
          surface === 'transition-prompt-builder' ? 'transition' : 'effect'
        )
      )
    ) {
      console.error(`ELECTRON_SMOKE_TEST_FAILED ${surface} did not initialize`);
      app.exit(1);
      return;
    }
    if (surface === 'editor' && Number(details && details.mediaManagerRows) < 1) {
      console.error('ELECTRON_SMOKE_TEST_FAILED project media manager did not render slideshow rows');
      app.exit(1);
      return;
    }
    if (['editor', 'player', 'preview', 'effects'].includes(surface) && projectProtocolStats.served === 0) {
      console.error(`ELECTRON_SMOKE_TEST_FAILED ${surface} did not load project media`);
      app.exit(1);
      return;
    }
    console.log(
      `ELECTRON_SMOKE_TEST_OK edition=desktop surface=${surface} workspaces=${
        workspaceCount
      } projects=${projectCount} media=${projectProtocolStats.served}${
        surface === 'library' ? ` trash=${Number(details && details.trashCount) || 0}` : ''
      }${surface === 'library' ? ` version=${APP_VERSION}` : ''
      }${surface === 'library' ? ` storage=${app.isPackaged ? 'packaged' : 'development'}` : ''}`
    );
    if (smokeFailureTimer) {
      clearTimeout(smokeFailureTimer);
      smokeFailureTimer = null;
    }
    app.exit(0);
  });
}

function protectWebContents(contents) {
  if (SMOKE_TEST) {
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      console.error(
        `RENDERER_LOAD_FAILED code=${errorCode} main=${isMainFrame} url=${validatedUrl} ${errorDescription}`
      );
    });
  }

  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') {
        void shell.openExternal(parsed.href);
      }
    } catch {
      // Invalid URLs are denied below.
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, destination) => {
    if (!isTrustedRendererUrl(destination)) event.preventDefault();
  });
}

function createMainWindow() {
  const stateFile = path.join(app.getPath('userData'), 'main-window-state.json');
  const savedState = loadWindowState(
    stateFile,
    screen.getAllDisplays().map(display => display.workArea)
  );
  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    ...(Number.isInteger(savedState.x) && Number.isInteger(savedState.y)
      ? { x: savedState.x, y: savedState.y }
      : {}),
    minWidth: 840,
    minHeight: 640,
    show: false,
    backgroundColor: '#24211f',
    title: APP_TITLE,
    icon: APP_ICON_ICO_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });

  if (!Number.isInteger(savedState.x) || !Number.isInteger(savedState.y)) {
    mainWindow.center();
  }

  protectWebContents(mainWindow.webContents);

  mainWindow.once('ready-to-show', () => {
    if (savedState.maximized) mainWindow.maximize();
    if (!SMOKE_TEST) mainWindow.show();
  });

  mainWindow.on('close', () => {
    try {
      saveWindowState(stateFile, {
        ...mainWindow.getNormalBounds(),
        maximized: mainWindow.isMaximized()
      });
    } catch (error) {
      console.warn(`Unable to save the Library window state: ${error.message}`);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(buildAppUrl(UI_PATH));
}

function createChildWindow(options, filePath, query) {
  const child = new BrowserWindow({
    ...options,
    parent: mainWindow || undefined,
    show: false,
    backgroundColor: '#181615',
    icon: APP_ICON_ICO_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });
  childWindows.add(child);
  protectWebContents(child.webContents);
  child.webContents.on('will-prevent-unload', event => {
    const isRegistryEditor = filePath === REGISTRY_EDITOR_PATH;
    const response = dialog.showMessageBoxSync(child, {
      type: 'warning',
      title: isRegistryEditor ? 'Unsaved registry changes' : 'Unsaved slideshow changes',
      message: isRegistryEditor
        ? 'The Registry Editor has unsaved changes.'
        : 'This slideshow has unsaved changes.',
      detail: isRegistryEditor
        ? 'Stay in the Registry Editor to save them, or discard the changes and close the window.'
        : 'Stay in the editor to save them, or discard the changes and close the window.',
      buttons: [isRegistryEditor ? 'Stay in Registry Editor' : 'Stay in editor', 'Discard changes'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (response === 1) event.preventDefault();
  });
  child.once('ready-to-show', () => {
    if (!SMOKE_TEST) child.show();
  });
  child.on('closed', () => {
    childWindows.delete(child);
    if (
      filePath === EDITOR_PATH
      && mainWindow
      && !mainWindow.isDestroyed()
      && !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send('library:refresh');
    }
  });
  void child.loadURL(buildAppUrl(filePath, query));
  return child;
}

function createEditorWindow(workspaceId, projectId, query = {}) {
  const editor = createChildWindow(
    {
      width: 1500,
      height: 920,
      minWidth: 1100,
      minHeight: 700,
      title: 'Edit Slideshow — Movement'
    },
    EDITOR_PATH,
    { desktop: '1', workspaceId, projectId, ...query }
  );
  if (SMOKE_TEST && query.smokeEffects === '1') {
    smokeFailureTimer = setTimeout(async () => {
      if (editor.isDestroyed() || editor.webContents.isDestroyed()) return;
      let details = 'Effects Hub state could not be inspected.';
      try {
        details = await editor.webContents.executeJavaScript(`
          (() => {
            const hubFrame = document.getElementById('effects-iframe');
            const hubDocument = hubFrame && hubFrame.contentDocument;
            const makerFrame = hubDocument && hubDocument.getElementById('toolFrame');
            return JSON.stringify({
              editorUrl: window.location.href,
              hubUrl: hubFrame ? hubFrame.src : '',
              hubTitle: hubDocument ? hubDocument.title : '',
              hubButtons: hubDocument ? hubDocument.querySelectorAll('.effect-btn').length : -1,
              hubMessage: hubDocument && hubDocument.getElementById('navList')
                ? hubDocument.getElementById('navList').textContent.trim()
                : '',
              makerUrl: makerFrame ? makerFrame.src : '',
              makerTitle: makerFrame && makerFrame.contentDocument
                ? makerFrame.contentDocument.title
                : '',
              makerReady: !!(makerFrame && makerFrame.contentWindow && makerFrame.contentWindow.MakerAPI)
            });
          })()
        `);
      } catch (error) {
        details = error && error.message ? error.message : String(error);
      }
      console.error(`ELECTRON_SMOKE_TEST_FAILED effects timed out ${details}`);
      app.exit(1);
    }, 20000);
  }
  return editor;
}

function createPlayerWindow(workspaceId, projectId) {
  return createChildWindow(
    {
      width: 1280,
      height: 820,
      minWidth: 760,
      minHeight: 560,
      title: 'Play Slideshow — Movement'
    },
    PLAYER_PATH,
    { desktop: '1', workspaceId, projectId }
  );
}

function createRegistryEditorWindow(type = 'effects') {
  const safeType = type === 'transitions' ? 'transitions' : 'effects';
  if (registryEditorWindow && !registryEditorWindow.isDestroyed()) {
    registryEditorWindow.show();
    registryEditorWindow.focus();
    registryEditorWindow.webContents.send('registry:select-type', { type: safeType });
    return registryEditorWindow;
  }

  registryEditorWindow = createChildWindow(
    {
      width: 1280,
      height: 860,
      minWidth: 820,
      minHeight: 620,
      title: 'Registry Editor — Movement'
    },
    REGISTRY_EDITOR_PATH,
    { desktop: '1', type: safeType }
  );
  registryEditorWindow.on('closed', () => {
    registryEditorWindow = null;
  });
  return registryEditorWindow;
}

function createEffectPromptBuilderWindow(query = {}) {
  if (effectPromptBuilderWindow && !effectPromptBuilderWindow.isDestroyed()) {
    effectPromptBuilderWindow.show();
    effectPromptBuilderWindow.focus();
    return effectPromptBuilderWindow;
  }

  effectPromptBuilderWindow = createChildWindow(
    {
      width: 1260,
      height: 900,
      minWidth: 820,
      minHeight: 660,
      title: 'Design a New Effect — Movement'
    },
    EFFECT_PROMPT_BUILDER_PATH,
    { desktop: '1', ...query }
  );
  effectPromptBuilderWindow.on('closed', () => {
    effectPromptBuilderWindow = null;
  });
  return effectPromptBuilderWindow;
}

function createTransitionPromptBuilderWindow(query = {}) {
  if (transitionPromptBuilderWindow && !transitionPromptBuilderWindow.isDestroyed()) {
    transitionPromptBuilderWindow.show();
    transitionPromptBuilderWindow.focus();
    return transitionPromptBuilderWindow;
  }

  transitionPromptBuilderWindow = createChildWindow(
    {
      width: 1260,
      height: 900,
      minWidth: 820,
      minHeight: 660,
      title: 'Design a New Transition — Movement'
    },
    EFFECT_PROMPT_BUILDER_PATH,
    { desktop: '1', kind: 'transition', ...query }
  );
  transitionPromptBuilderWindow.on('closed', () => {
    transitionPromptBuilderWindow = null;
  });
  return transitionPromptBuilderWindow;
}

async function handleProjectProtocol(request) {
  projectProtocolStats.requests += 1;
  try {
    const requestedUrl = new URL(request.url);
    if (requestedUrl.host !== 'asset') throw new Error('Unknown project resource.');
    const parts = requestedUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 4) throw new Error('Incomplete project resource.');
    const [workspaceId, projectId, ...assetParts] = parts;
    const assetPath = workspaceService.resolveProjectAssetPath(
      workspaceId,
      projectId,
      assetParts.join('/')
    );
    projectProtocolStats.served += 1;
    return net.fetch(pathToFileURL(assetPath).href, { headers: request.headers });
  } catch {
    projectProtocolStats.notFound += 1;
    return new Response('Project resource not found.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
}

async function handleAppProtocol(request) {
  try {
    const { relativePath, resourcePath } = resolveAppResource(request.url);
    const response = await net.fetch(pathToFileURL(resourcePath).href, { headers: request.headers });
    if (!response.ok) throw new Error('Application resource could not be read.');
    appProtocolStats.served.add(relativePath);
    return response;
  } catch {
    appProtocolStats.notFound += 1;
    return new Response('Application resource not found.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
}

app.setName(APP_TITLE);
app.setAppUserModelId(APP_ID);
app.setAboutPanelOptions({
  applicationName: APP_TITLE,
  applicationVersion: APP_VERSION,
  version: APP_VERSION,
  iconPath: APP_ICON_PNG_PATH
});
if (SMOKE_TEST) {
  app.setPath('userData', path.join(app.getPath('temp'), `${APP_ID}-smoke-${process.pid}`));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const applicationRoot = app.getAppPath();
    const isPackaged = app.isPackaged;
    const isAuthoringKit = isPackaged && fs.existsSync(path.join(
      applicationRoot,
      'distribution',
      'desktop-authoring-kit.manifest.json'
    ));
    const storageRoot = isPackaged
      ? isAuthoringKit
        ? resolvePortableStorageRoot(process.execPath)
        : resolvePackagedStorageRoot(app.getPath('documents'), APP_TITLE)
      : path.join(applicationRoot, 'private-data', 'slidedeck');
    projectStorageRoot = prepareWritableStorageRoot(storageRoot);
    projectStorageDetails = Object.freeze({
      label: isAuthoringKit
        ? getPortableStorageLocationLabel()
        : getStorageLocationLabel(isPackaged, APP_TITLE),
      packaged: isPackaged,
      writable: true
    });
    developerFilesRoot = /\.asar(?:[\\/]|$)/i.test(applicationRoot)
      ? path.dirname(applicationRoot)
      : applicationRoot;

    workspaceService = createWorkspaceService({
      examplesRoot: path.join(applicationRoot, 'examples'),
      storageRoot: projectStorageRoot
    });
    registryService = createRegistryService({
      applicationRoot,
      forceReadOnly: /\.asar(?:[\\/]|$)/i.test(applicationRoot)
    });

    protocol.handle(APP_SCHEME, handleAppProtocol);
    protocol.handle(PROJECT_SCHEME, handleProjectProtocol);

    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);

    registerIpcHandlers();
    if (SMOKE_SURFACE === 'registry') {
      createRegistryEditorWindow('effects');
    } else if (SMOKE_SURFACE === 'prompt-builder') {
      createEffectPromptBuilderWindow({ smoke: '1' });
    } else if (SMOKE_SURFACE === 'transition-prompt-builder') {
      createTransitionPromptBuilderWindow({ smoke: '1' });
    } else if (
      SMOKE_SURFACE === 'editor'
      || SMOKE_SURFACE === 'player'
      || SMOKE_SURFACE === 'preview'
      || SMOKE_SURFACE === 'effects'
    ) {
      const currentWorkspace = workspaceService.getCurrentWorkspace();
      const projects = currentWorkspace
        ? workspaceService.listProjects(currentWorkspace.id)
        : [];
      if (!currentWorkspace || projects.length === 0) {
        throw new Error(`No project is available for the ${SMOKE_SURFACE} smoke test.`);
      }
      if (SMOKE_SURFACE === 'editor' || SMOKE_SURFACE === 'preview' || SMOKE_SURFACE === 'effects') {
        createEditorWindow(
          currentWorkspace.id,
          projects[0].id,
          SMOKE_SURFACE === 'preview'
            ? { smokePreview: '1' }
            : (
              SMOKE_SURFACE === 'effects'
                ? { smokeEffects: '1' }
                : { smokeMedia: '1' }
            )
        );
      } else {
        createPlayerWindow(currentWorkspace.id, projects[0].id);
      }
    } else {
      createMainWindow();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch(error => {
    dialog.showErrorBox(
      'Project library unavailable',
      error && error.message
        ? error.message
        : 'Movement Timeline Studio could not prepare its project library.'
    );
    app.exit(1);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
