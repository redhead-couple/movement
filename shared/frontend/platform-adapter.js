(function exposePlatformAdapter(globalObject) {
  function createMovementPlatformApi() {
    const desktop = globalObject.movementDesktop;
    if (!desktop) return null;

    return Object.freeze({
      getRuntimeContext: () => desktop.getRuntimeContext(),
      openProjectStorage: () => desktop.openProjectStorage(),
      openDeveloperFiles: () => desktop.openDeveloperFiles(),
      openRegistryEditor: type => desktop.openRegistryEditor(type),
      openEffectPromptBuilder: () => desktop.openEffectPromptBuilder(),
      openTransitionPromptBuilder: () => desktop.openTransitionPromptBuilder(),
      copyGeneratedPrompt: prompt => desktop.copyGeneratedPrompt(prompt),
      saveGeneratedPrompt: (prompt, suggestedName) => (
        desktop.saveGeneratedPrompt(prompt, suggestedName)
      ),
      listRegistries: () => desktop.listRegistries(),
      saveRegistry: (type, registry, expectedRevision) => (
        desktop.saveRegistry(type, registry, expectedRevision)
      ),
      listWorkspaces: () => desktop.listWorkspaces(),
      listProjects: workspaceId => desktop.listProjects(workspaceId),
      selectWorkspace: workspaceId => desktop.selectWorkspace(workspaceId),
      createWorkspace: name => desktop.createWorkspace(name),
      createProject: (workspaceId, title) => desktop.createProject(workspaceId, title),
      loadProjectFlow: (workspaceId, projectId) => (
        desktop.loadProjectFlow(workspaceId, projectId)
      ),
      saveProjectFlow: (workspaceId, projectId, flow, expectedRevision) => (
        desktop.saveProjectFlow(workspaceId, projectId, flow, expectedRevision)
      ),
      copyExample: (exampleId, targetWorkspaceId) => (
        desktop.copyExample(exampleId, targetWorkspaceId)
      ),
      duplicateProject: (workspaceId, projectId) => (
        desktop.duplicateProject(workspaceId, projectId)
      ),
      renameProject: (workspaceId, projectId, title) => (
        desktop.renameProject(workspaceId, projectId, title)
      ),
      moveProjectToTrash: (workspaceId, projectId) => (
        desktop.moveProjectToTrash(workspaceId, projectId)
      ),
      listTrashedProjects: workspaceId => (
        desktop.listTrashedProjects(workspaceId)
      ),
      restoreProjectFromTrash: (workspaceId, trashId) => (
        desktop.restoreProjectFromTrash(workspaceId, trashId)
      ),
      deleteTrashedProject: (workspaceId, trashId) => (
        desktop.deleteTrashedProject(workspaceId, trashId)
      ),
      exportPortableProject: (workspaceId, projectId) => (
        desktop.exportPortableProject(workspaceId, projectId)
      ),
      importPortableProject: workspaceId => (
        desktop.importPortableProject(workspaceId)
      ),
      chooseProjectMedia: (workspaceId, projectId, type) => (
        desktop.chooseProjectMedia(workspaceId, projectId, type)
      ),
      getProjectMediaOverview: (workspaceId, projectId) => (
        desktop.getProjectMediaOverview(workspaceId, projectId)
      ),
      removeUnusedProjectMedia: (workspaceId, projectId, type, filename, expectedRevision) => (
        desktop.removeUnusedProjectMedia(
          workspaceId,
          projectId,
          type,
          filename,
          expectedRevision
        )
      ),
      openProjectEditor: (workspaceId, projectId) => (
        desktop.openProjectEditor(workspaceId, projectId)
      ),
      openProjectPlayer: (workspaceId, projectId) => (
        desktop.openProjectPlayer(workspaceId, projectId)
      ),
      closeCurrentWindow: () => desktop.closeCurrentWindow(),
      onLibraryRefresh: callback => desktop.onLibraryRefresh(callback),
      onRegistryChanged: callback => desktop.onRegistryChanged(callback),
      onRegistryTypeRequested: callback => desktop.onRegistryTypeRequested(callback),
      getProjectThumbnail: (workspaceId, projectId) => (
        desktop.getProjectThumbnail(workspaceId, projectId)
      ),
      reportReady: details => desktop.reportReady(details)
    });
  }

  Object.defineProperty(globalObject, 'createMovementPlatformApi', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: createMovementPlatformApi
  });
})(window);
