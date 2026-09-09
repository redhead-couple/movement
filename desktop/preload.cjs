const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = Object.freeze({
  getRuntimeContext: () => ipcRenderer.invoke('runtime:get-context'),
  openProjectStorage: () => ipcRenderer.invoke('runtime:open-project-storage'),
  openDeveloperFiles: () => ipcRenderer.invoke('runtime:open-developer-files'),
  openRegistryEditor: type => ipcRenderer.invoke('runtime:open-registry-editor', type),
  openEffectPromptBuilder: () => ipcRenderer.invoke('runtime:open-effect-prompt-builder'),
  openTransitionPromptBuilder: () => ipcRenderer.invoke('runtime:open-transition-prompt-builder'),
  copyGeneratedPrompt: prompt => ipcRenderer.invoke('prompt:copy', prompt),
  saveGeneratedPrompt: (prompt, suggestedName) => (
    ipcRenderer.invoke('prompt:save', prompt, suggestedName)
  ),
  listRegistries: () => ipcRenderer.invoke('registry:list'),
  saveRegistry: (type, registry, expectedRevision) => (
    ipcRenderer.invoke('registry:save', type, registry, expectedRevision)
  ),
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  listProjects: workspaceId => ipcRenderer.invoke('workspace:list-projects', workspaceId),
  selectWorkspace: workspaceId => ipcRenderer.invoke('workspace:select', workspaceId),
  createWorkspace: name => ipcRenderer.invoke('workspace:create', name),
  createProject: (workspaceId, title) => (
    ipcRenderer.invoke('project:create', workspaceId, title)
  ),
  loadProjectFlow: (workspaceId, projectId) => (
    ipcRenderer.invoke('project:load-flow', workspaceId, projectId)
  ),
  saveProjectFlow: (workspaceId, projectId, flow, expectedRevision) => (
    ipcRenderer.invoke(
      'project:save-flow',
      workspaceId,
      projectId,
      flow,
      expectedRevision
    )
  ),
  copyExample: (exampleId, targetWorkspaceId) => (
    ipcRenderer.invoke('project:copy-example', exampleId, targetWorkspaceId)
  ),
  duplicateProject: (workspaceId, projectId) => (
    ipcRenderer.invoke('project:duplicate', workspaceId, projectId)
  ),
  renameProject: (workspaceId, projectId, title) => (
    ipcRenderer.invoke('project:rename', workspaceId, projectId, title)
  ),
  moveProjectToTrash: (workspaceId, projectId) => (
    ipcRenderer.invoke('project:trash', workspaceId, projectId)
  ),
  listTrashedProjects: workspaceId => (
    ipcRenderer.invoke('project:list-trash', workspaceId)
  ),
  restoreProjectFromTrash: (workspaceId, trashId) => (
    ipcRenderer.invoke('project:restore-trash', workspaceId, trashId)
  ),
  deleteTrashedProject: (workspaceId, trashId) => (
    ipcRenderer.invoke('project:delete-trash', workspaceId, trashId)
  ),
  exportPortableProject: (workspaceId, projectId) => (
    ipcRenderer.invoke('project:export-portable', workspaceId, projectId)
  ),
  importPortableProject: workspaceId => (
    ipcRenderer.invoke('project:import-portable', workspaceId)
  ),
  listProjectMedia: (workspaceId, projectId, type) => (
    ipcRenderer.invoke('project:list-media', workspaceId, projectId, type)
  ),
  getProjectMediaOverview: (workspaceId, projectId) => (
    ipcRenderer.invoke('project:get-media-overview', workspaceId, projectId)
  ),
  chooseProjectMedia: (workspaceId, projectId, type) => (
    ipcRenderer.invoke('project:choose-media', workspaceId, projectId, type)
  ),
  removeUnusedProjectMedia: (workspaceId, projectId, type, filename, expectedRevision) => (
    ipcRenderer.invoke(
      'project:remove-unused-media',
      workspaceId,
      projectId,
      type,
      filename,
      expectedRevision
    )
  ),
  getProjectAssetBase: (workspaceId, projectId) => (
    ipcRenderer.invoke('project:get-asset-base', workspaceId, projectId)
  ),
  getProjectThumbnail: (workspaceId, projectId) => (
    ipcRenderer.invoke('project:get-thumbnail', workspaceId, projectId)
  ),
  openProjectEditor: (workspaceId, projectId) => (
    ipcRenderer.invoke('runtime:open-editor', workspaceId, projectId)
  ),
  openProjectPlayer: (workspaceId, projectId) => (
    ipcRenderer.invoke('runtime:open-player', workspaceId, projectId)
  ),
  closeCurrentWindow: () => ipcRenderer.send('runtime:close-window'),
  onLibraryRefresh: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('library:refresh', listener);
    return () => ipcRenderer.removeListener('library:refresh', listener);
  },
  onRegistryChanged: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, details) => callback(details);
    ipcRenderer.on('registry:changed', listener);
    return () => ipcRenderer.removeListener('registry:changed', listener);
  },
  onRegistryTypeRequested: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, details) => callback(details);
    ipcRenderer.on('registry:select-type', listener);
    return () => ipcRenderer.removeListener('registry:select-type', listener);
  },
  reportReady: details => ipcRenderer.send('runtime:renderer-ready', details)
});

contextBridge.exposeInMainWorld('movementDesktop', desktopApi);
