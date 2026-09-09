const api = window.createMovementPlatformApi();

const elements = {
  views: Array.from(document.querySelectorAll('[data-view]')),
  routeButtons: Array.from(document.querySelectorAll('[data-route]')),
  appVersion: document.querySelector('#app-version'),
  workspaceSelect: document.querySelector('#workspace-select'),
  workspaceHelp: document.querySelector('#workspace-help'),
  openStorageButton: document.querySelector('#open-storage-button'),
  registryEditorButton: document.querySelector('#registry-editor-button'),
  effectPromptButton: document.querySelector('#effect-prompt-button'),
  transitionPromptButton: document.querySelector('#transition-prompt-button'),
  newWorkspaceButton: document.querySelector('#new-workspace-button'),
  firstRunWelcome: document.querySelector('#first-run-welcome'),
  createFirstWorkspaceButton: document.querySelector('#create-first-workspace-button'),
  playWelcomeExampleButton: document.querySelector('#play-welcome-example-button'),
  trashLibraryButton: document.querySelector('#trash-library-button'),
  importProjectButton: document.querySelector('#import-project-button'),
  newProjectButton: document.querySelector('#new-project-button'),
  librarySummary: document.querySelector('#library-summary'),
  selectionRequired: document.querySelector('#selection-required'),
  readonlyNote: document.querySelector('#readonly-note'),
  loadingState: document.querySelector('#loading-state'),
  projectGrid: document.querySelector('#project-grid'),
  emptyState: document.querySelector('#empty-state'),
  errorState: document.querySelector('#error-state'),
  projectTemplate: document.querySelector('#project-card-template'),
  toast: document.querySelector('#toast'),
  workspaceDialog: document.querySelector('#workspace-dialog'),
  workspaceForm: document.querySelector('#workspace-form'),
  projectDialog: document.querySelector('#project-dialog'),
  projectForm: document.querySelector('#project-form'),
  copyDialog: document.querySelector('#copy-dialog'),
  copyForm: document.querySelector('#copy-form'),
  renameDialog: document.querySelector('#rename-dialog'),
  renameForm: document.querySelector('#rename-form'),
  trashDialog: document.querySelector('#trash-dialog'),
  trashForm: document.querySelector('#trash-form'),
  trashProjectTitle: document.querySelector('#trash-project-title'),
  recoveryDialog: document.querySelector('#recovery-dialog'),
  recoverySummary: document.querySelector('#recovery-summary'),
  recoveryLoading: document.querySelector('#recovery-loading'),
  recoveryList: document.querySelector('#recovery-list'),
  recoveryEmpty: document.querySelector('#recovery-empty'),
  recoveryItemTemplate: document.querySelector('#recovery-item-template'),
  conceptSlideshowCards: Array.from(document.querySelectorAll('[data-concept-project]'))
};

const state = {
  workspaces: [],
  selectedWorkspace: null,
  projects: [],
  trashedProjects: [],
  pendingProject: null,
  workspaceContinuation: null,
  toastTimer: null
};

function setRoute(route) {
  const safeRoute = route === 'library' ? 'library' : route === 'concept' ? 'concept' : 'home';
  for (const view of elements.views) {
    view.hidden = view.dataset.view !== safeRoute;
  }
  for (const button of elements.routeButtons) {
    if (button.closest('.app-nav')) {
      button.toggleAttribute('aria-current', button.dataset.route === safeRoute);
      if (button.dataset.route === 'concept') {
        button.hidden = safeRoute === 'library';
      }
    }
  }
  document.title = safeRoute === 'library'
    ? 'Your Slideshows — Movement'
    : safeRoute === 'concept'
    ? 'The Medium — Early Formation'
    : 'Movement Timeline Studio';
  window.location.hash = safeRoute;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function errorMessage(error) {
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '');
}

function showFatalError(message) {
  elements.loadingState.hidden = true;
  elements.emptyState.hidden = true;
  elements.projectGrid.replaceChildren();
  elements.errorState.textContent = message;
  elements.errorState.hidden = false;
}

function showToast(message, isError = false) {
  if (state.toastTimer) window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('toast-error', isError);
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, isError ? 6500 : 4200);
}

function userWorkspaces() {
  return state.workspaces.filter(workspace => !workspace.readOnly);
}

function fillWorkspaceSelect() {
  elements.workspaceSelect.replaceChildren();
  if (!state.selectedWorkspace) {
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = 'Choose a workspace…';
    elements.workspaceSelect.append(prompt);
  }

  for (const workspace of state.workspaces) {
    const option = document.createElement('option');
    option.value = workspace.id;
    option.textContent = workspace.readOnly
      ? `${workspace.name} — read-only (${workspace.projectCount})`
      : `${workspace.name} (${workspace.projectCount})`;
    option.selected = workspace.id === state.selectedWorkspace?.id;
    elements.workspaceSelect.append(option);
  }
}

function describeLibrary() {
  if (!state.selectedWorkspace) {
    elements.librarySummary.textContent = 'Choose which local workspace you want to open.';
    return;
  }
  const count = state.projects.length;
  elements.librarySummary.textContent = `${count} ${
    count === 1 ? 'slideshow' : 'slideshows'
  } in ${state.selectedWorkspace.name}`;
}

async function loadThumbnail(card, project, workspaceId) {
  try {
    const source = await api.getProjectThumbnail(workspaceId, project.id);
    if (!source || !card.isConnected) return;
    const image = card.querySelector('img');
    image.src = source;
    image.alt = `Opening image for ${project.title}`;
  } catch {
    // A missing or unreadable image leaves the deliberate placeholder visible.
  }
}

function createProjectCard(project) {
  const card = elements.projectTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.projectId = project.id;
  card.classList.toggle('project-card-readonly', project.readOnly);
  card.querySelector('h2').textContent = project.title;
  card.querySelector('.project-description').textContent = project.description
    || `Project folder: ${project.id}`;
  card.querySelector('.slide-count').textContent = `${project.slideCount} ${
    project.slideCount === 1 ? 'slide' : 'slides'
  }`;
  card.querySelector('.project-status').textContent = project.status;
  card.querySelector('.project-access').textContent = project.readOnly ? 'Example' : 'Local';

  const validity = card.querySelector('.validity-mark');
  if (!project.valid) {
    validity.textContent = 'Check';
    validity.classList.add('invalid');
    validity.title = 'This flow needs attention';
  }

  if (project.openingImage) {
    void loadThumbnail(card, project, state.selectedWorkspace.id);
  }
  return card;
}

function renderProjects() {
  const firstRun = userWorkspaces().length === 0;
  const showingFirstRunExamples = firstRun && state.selectedWorkspace?.readOnly;
  elements.projectGrid.replaceChildren();
  elements.loadingState.hidden = true;
  elements.errorState.hidden = true;
  elements.selectionRequired.hidden = Boolean(state.selectedWorkspace);
  elements.firstRunWelcome.hidden = !showingFirstRunExamples;
  elements.readonlyNote.hidden = !state.selectedWorkspace?.readOnly || showingFirstRunExamples;
  elements.emptyState.hidden = !state.selectedWorkspace || state.projects.length > 0;
  elements.newProjectButton.disabled = (
    (!state.selectedWorkspace || state.selectedWorkspace.readOnly) && !firstRun
  );
  elements.playWelcomeExampleButton.disabled = !showingFirstRunExamples || state.projects.length === 0;
  elements.trashLibraryButton.disabled = !state.selectedWorkspace || state.selectedWorkspace.readOnly;
  elements.importProjectButton.disabled = !state.selectedWorkspace || state.selectedWorkspace.readOnly;
  elements.trashLibraryButton.textContent = state.trashedProjects.length
    ? `Trash (${state.trashedProjects.length})`
    : 'Trash';
  elements.trashLibraryButton.title = state.selectedWorkspace?.readOnly
    ? 'Bundled examples do not use workspace trash.'
    : 'Restore complete slideshows removed from this workspace.';
  elements.newProjectButton.title = state.selectedWorkspace?.readOnly
    ? firstRun
      ? 'Create your first workspace, then continue directly to a new slideshow.'
      : 'Choose a local workspace before creating a slideshow.'
    : '';
  elements.importProjectButton.title = state.selectedWorkspace?.readOnly
    ? 'Choose a local workspace before importing a portable slideshow.'
    : 'Import a portable slideshow ZIP into this workspace.';

  if (!state.selectedWorkspace) {
    describeLibrary();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const project of state.projects) {
    fragment.append(createProjectCard(project));
  }
  elements.projectGrid.append(fragment);
  describeLibrary();
}

async function refreshLibrary(preferredWorkspaceId = state.selectedWorkspace?.id) {
  state.workspaces = await api.listWorkspaces();
  state.selectedWorkspace = preferredWorkspaceId
    ? state.workspaces.find(workspace => workspace.id === preferredWorkspaceId) || null
    : null;
  if (state.selectedWorkspace) {
    [state.projects, state.trashedProjects] = await Promise.all([
      api.listProjects(state.selectedWorkspace.id),
      state.selectedWorkspace.readOnly
        ? Promise.resolve([])
        : api.listTrashedProjects(state.selectedWorkspace.id)
    ]);
  } else {
    state.projects = [];
    state.trashedProjects = [];
  }
  fillWorkspaceSelect();
  renderProjects();
  if (elements.recoveryDialog.open) renderRecoveryProjects();
}

async function selectWorkspace(workspaceId) {
  elements.loadingState.hidden = false;
  elements.errorState.hidden = true;
  elements.emptyState.hidden = true;
  try {
    const selected = await api.selectWorkspace(workspaceId);
    await refreshLibrary(selected.id);
  } catch (error) {
    showFatalError(errorMessage(error));
  }
}

function resetDialog(dialog) {
  const error = dialog.querySelector('.dialog-error');
  if (error) {
    error.textContent = '';
    error.hidden = true;
  }
  for (const button of dialog.querySelectorAll('button')) button.disabled = false;
}

function openDialog(dialog) {
  resetDialog(dialog);
  dialog.showModal();
  window.setTimeout(() => {
    const field = dialog.querySelector('input, select');
    if (field) field.focus();
  }, 0);
}

function openWorkspaceDialog(continuation = null) {
  state.workspaceContinuation = continuation;
  elements.workspaceForm.reset();
  elements.workspaceForm.elements.name.value = userWorkspaces().length === 0
    ? 'My Workspace'
    : '';
  openDialog(elements.workspaceDialog);
  window.setTimeout(() => elements.workspaceForm.elements.name.select(), 0);
}

function openNewProjectFlow() {
  if (userWorkspaces().length === 0) {
    openWorkspaceDialog('new-project');
    return;
  }
  if (!state.selectedWorkspace || state.selectedWorkspace.readOnly) return;
  openDialog(elements.projectDialog);
}

function playWelcomeExample() {
  const example = state.selectedWorkspace?.readOnly ? state.projects[0] : null;
  if (!example) return;
  elements.playWelcomeExampleButton.disabled = true;
  api.openProjectPlayer(state.selectedWorkspace.id, example.id)
    .catch(error => showToast(errorMessage(error), true))
    .finally(() => {
      elements.playWelcomeExampleButton.disabled = false;
    });
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function showDialogError(dialog, error) {
  const output = dialog.querySelector('.dialog-error');
  output.textContent = errorMessage(error);
  output.hidden = false;
}

function setDialogBusy(dialog, busy) {
  for (const button of dialog.querySelectorAll('button')) button.disabled = busy;
}

async function handleWorkspaceSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setDialogBusy(elements.workspaceDialog, true);
  try {
    const created = await api.createWorkspace(new FormData(form).get('name'));
    const continuation = state.workspaceContinuation;
    state.workspaceContinuation = null;
    closeDialog(elements.workspaceDialog);
    form.reset();
    await refreshLibrary(created.id);
    if (continuation === 'new-project') {
      openDialog(elements.projectDialog);
    } else if (continuation === 'copy-example' && state.pendingProject) {
      prepareCopyDialog(state.pendingProject);
    }
    showToast(`Workspace “${created.name}” is ready.`);
  } catch (error) {
    setDialogBusy(elements.workspaceDialog, false);
    showDialogError(elements.workspaceDialog, error);
  }
}

async function handleProjectSubmit(event) {
  event.preventDefault();
  if (!state.selectedWorkspace || state.selectedWorkspace.readOnly) return;
  const form = event.currentTarget;
  setDialogBusy(elements.projectDialog, true);
  try {
    const project = await api.createProject(
      state.selectedWorkspace.id,
      new FormData(form).get('title')
    );
    closeDialog(elements.projectDialog);
    form.reset();
    await refreshLibrary(state.selectedWorkspace.id);
    showToast(`“${project.title}” was created with a protected schema-v2 flow.`);
  } catch (error) {
    setDialogBusy(elements.projectDialog, false);
    showDialogError(elements.projectDialog, error);
  }
}

function prepareCopyDialog(project) {
  state.pendingProject = project;
  const select = elements.copyForm.elements.workspaceId;
  select.replaceChildren();
  for (const workspace of userWorkspaces()) {
    const option = document.createElement('option');
    option.value = workspace.id;
    option.textContent = workspace.name;
    select.append(option);
  }
  if (userWorkspaces().length === 0) {
    showToast('Create your workspace, then choose where to copy the example.');
    openWorkspaceDialog('copy-example');
    return;
  }
  openDialog(elements.copyDialog);
}

async function handleCopySubmit(event) {
  event.preventDefault();
  if (!state.pendingProject) return;
  const targetWorkspaceId = new FormData(event.currentTarget).get('workspaceId');
  setDialogBusy(elements.copyDialog, true);
  try {
    const copied = await api.copyExample(state.pendingProject.id, targetWorkspaceId);
    await api.selectWorkspace(targetWorkspaceId);
    closeDialog(elements.copyDialog);
    await refreshLibrary(targetWorkspaceId);
    showToast(`Editable copy “${copied.title}” was created.`);
  } catch (error) {
    setDialogBusy(elements.copyDialog, false);
    showDialogError(elements.copyDialog, error);
  }
}

function prepareRenameDialog(project) {
  state.pendingProject = project;
  elements.renameForm.elements.title.value = project.title;
  openDialog(elements.renameDialog);
  elements.renameForm.elements.title.select();
}

async function handleRenameSubmit(event) {
  event.preventDefault();
  if (!state.pendingProject || !state.selectedWorkspace) return;
  setDialogBusy(elements.renameDialog, true);
  try {
    const renamed = await api.renameProject(
      state.selectedWorkspace.id,
      state.pendingProject.id,
      new FormData(event.currentTarget).get('title')
    );
    closeDialog(elements.renameDialog);
    await refreshLibrary(state.selectedWorkspace.id);
    showToast(`Slideshow renamed to “${renamed.title}”.`);
  } catch (error) {
    setDialogBusy(elements.renameDialog, false);
    showDialogError(elements.renameDialog, error);
  }
}

function prepareTrashDialog(project) {
  state.pendingProject = project;
  elements.trashProjectTitle.textContent = project.title;
  openDialog(elements.trashDialog);
}

async function handleTrashSubmit(event) {
  event.preventDefault();
  if (!state.pendingProject || !state.selectedWorkspace) return;
  setDialogBusy(elements.trashDialog, true);
  try {
    await api.moveProjectToTrash(state.selectedWorkspace.id, state.pendingProject.id);
    const title = state.pendingProject.title;
    closeDialog(elements.trashDialog);
    await refreshLibrary(state.selectedWorkspace.id);
    showToast(`“${title}” was moved to recoverable workspace trash.`);
  } catch (error) {
    setDialogBusy(elements.trashDialog, false);
    showDialogError(elements.trashDialog, error);
  }
}

function formatRecoveryDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown removal date';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function renderRecoveryProjects() {
  elements.recoveryList.replaceChildren();
  const count = state.trashedProjects.length;
  elements.recoveryLoading.hidden = true;
  elements.recoveryEmpty.hidden = count > 0;
  elements.recoverySummary.textContent = count
    ? `${count} recoverable ${count === 1 ? 'slideshow' : 'slideshows'} in ${state.selectedWorkspace.name}. Restore one or remove it permanently.`
    : 'Restore a complete slideshow with its flow, images, speech, audio, and backups.';

  const fragment = document.createDocumentFragment();
  for (const item of state.trashedProjects) {
    const row = elements.recoveryItemTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.trashId = item.trashId;
    row.querySelector('.recovery-item-title').textContent = item.title;
    row.querySelector('.recovery-item-meta').textContent = `${item.slideCount} ${
      item.slideCount === 1 ? 'slide' : 'slides'
    } · Removed ${formatRecoveryDate(item.removedAt)}`;
    row.querySelector('.recovery-item-description').textContent = item.description
      || `Original project folder: ${item.originalProjectId}`;
    row.querySelector('.recovery-conflict').hidden = !item.conflict;
    fragment.append(row);
  }
  elements.recoveryList.append(fragment);
}

async function refreshRecoveryProjects() {
  if (!state.selectedWorkspace || state.selectedWorkspace.readOnly) return;
  elements.recoveryLoading.hidden = false;
  elements.recoveryList.replaceChildren();
  elements.recoveryEmpty.hidden = true;
  const error = elements.recoveryDialog.querySelector('.dialog-error');
  error.hidden = true;
  try {
    state.trashedProjects = await api.listTrashedProjects(state.selectedWorkspace.id);
    renderProjects();
    renderRecoveryProjects();
  } catch (loadError) {
    elements.recoveryLoading.hidden = true;
    showDialogError(elements.recoveryDialog, loadError);
  }
}

function openRecoveryDialog() {
  if (!state.selectedWorkspace || state.selectedWorkspace.readOnly) return;
  openDialog(elements.recoveryDialog);
  void refreshRecoveryProjects();
}

async function restoreTrashedProject(item, button) {
  if (!state.selectedWorkspace) return;
  const row = button.closest('[data-trash-id]');
  const actionButtons = row?.querySelectorAll('[data-recovery-action]') || [button];
  actionButtons.forEach(actionButton => { actionButton.disabled = true; });
  try {
    const restored = await api.restoreProjectFromTrash(
      state.selectedWorkspace.id,
      item.trashId
    );
    if (!restored || restored.cancelled) return;
    await refreshLibrary(state.selectedWorkspace.id);
    showToast(
      restored.restoredAsCopy
        ? `“${restored.title}” was restored as a separate copy.`
        : `“${restored.title}” was restored to the library.`
    );
  } catch (error) {
    showDialogError(elements.recoveryDialog, error);
  } finally {
    actionButtons.forEach(actionButton => { actionButton.disabled = false; });
  }
}

async function deleteTrashedProject(item, button) {
  if (!state.selectedWorkspace) return;
  const row = button.closest('[data-trash-id]');
  const actionButtons = row?.querySelectorAll('[data-recovery-action]') || [button];
  actionButtons.forEach(actionButton => { actionButton.disabled = true; });
  try {
    const result = await api.deleteTrashedProject(
      state.selectedWorkspace.id,
      item.trashId
    );
    if (!result || result.cancelled) return;
    await refreshLibrary(state.selectedWorkspace.id);
    showToast(`“${result.title || item.title}” was permanently deleted.`);
  } catch (error) {
    showDialogError(elements.recoveryDialog, error);
  } finally {
    actionButtons.forEach(actionButton => { actionButton.disabled = false; });
  }
}

async function duplicateProject(project, button) {
  if (!state.selectedWorkspace) return;
  button.disabled = true;
  try {
    const duplicate = await api.duplicateProject(state.selectedWorkspace.id, project.id);
    await refreshLibrary(state.selectedWorkspace.id);
    showToast(`Duplicate “${duplicate.title}” was created.`);
  } catch (error) {
    button.disabled = false;
    showToast(errorMessage(error), true);
  }
}

async function exportPortableProject(project, button) {
  if (!state.selectedWorkspace) return;
  button.disabled = true;
  try {
    const result = await api.exportPortableProject(state.selectedWorkspace.id, project.id);
    if (!result || result.cancelled) return;
    showToast(`Portable slideshow “${result.filename}” was exported.`);
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    button.disabled = false;
  }
}

async function importPortableProject() {
  if (!state.selectedWorkspace || state.selectedWorkspace.readOnly) return;
  elements.importProjectButton.disabled = true;
  try {
    const imported = await api.importPortableProject(state.selectedWorkspace.id);
    if (!imported || imported.cancelled) return;
    await refreshLibrary(state.selectedWorkspace.id);
    showToast(
      imported.importedAsCopy
        ? `Portable slideshow imported as “${imported.title}”.`
        : `Portable slideshow “${imported.title}” was imported.`
    );
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    elements.importProjectButton.disabled = false;
  }
}

async function openProjectStorage() {
  elements.openStorageButton.disabled = true;
  try {
    await api.openProjectStorage();
    showToast('Project files opened.');
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    elements.openStorageButton.disabled = false;
  }
}

async function openRegistryEditor() {
  elements.registryEditorButton.disabled = true;
  try {
    await api.openRegistryEditor('effects');
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    elements.registryEditorButton.disabled = false;
  }
}

async function openEffectPromptBuilder() {
  elements.effectPromptButton.disabled = true;
  try {
    await api.openEffectPromptBuilder();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    elements.effectPromptButton.disabled = false;
  }
}

async function openTransitionPromptBuilder() {
  elements.transitionPromptButton.disabled = true;
  try {
    await api.openTransitionPromptBuilder();
  } catch (error) {
    showToast(errorMessage(error), true);
  } finally {
    elements.transitionPromptButton.disabled = false;
  }
}

async function initialize() {
  if (!api) {
    showFatalError(
      'The desktop bridge is unavailable. Start this page through the Movement desktop app.'
    );
    return;
  }

  try {
    const [context, workspaces] = await Promise.all([
      api.getRuntimeContext(),
      api.listWorkspaces()
    ]);
    state.workspaces = workspaces;
    state.selectedWorkspace = context.currentWorkspace;
    if (context.application && context.application.version) {
      elements.appVersion.textContent = `Desktop v${context.application.version}`;
      elements.appVersion.title = `${context.application.name} version ${context.application.version}`;
    }
    if (context.storage && context.storage.label) {
      elements.workspaceHelp.textContent = (
        `Project files: ${context.storage.label}. Examples cannot be edited.`
      );
      elements.openStorageButton.title = `Open ${context.storage.label}`;
    }
    for (const card of elements.conceptSlideshowCards) {
      const image = card.querySelector('[data-concept-thumbnail]');
      api.getProjectThumbnail('examples', card.dataset.conceptProject)
        .then(source => {
          if (source && image) image.src = source;
        })
        .catch(() => {});
    }
    if (state.selectedWorkspace) {
      [state.projects, state.trashedProjects] = await Promise.all([
        api.listProjects(state.selectedWorkspace.id),
        state.selectedWorkspace.readOnly
          ? Promise.resolve([])
          : api.listTrashedProjects(state.selectedWorkspace.id)
      ]);
    }
    fillWorkspaceSelect();
    renderProjects();
    api.reportReady({
      workspaceCount: state.workspaces.length,
      projectCount: state.projects.length,
      importExport: typeof api.exportPortableProject === 'function'
        && typeof api.importPortableProject === 'function',
      recoveryInterface: typeof api.listTrashedProjects === 'function'
        && typeof api.restoreProjectFromTrash === 'function'
        && typeof api.deleteTrashedProject === 'function',
      recoveryButton: Boolean(elements.trashLibraryButton),
      trashCount: state.trashedProjects.length,
      applicationVersion: context.application && context.application.version,
      versionLabel: elements.appVersion.textContent,
      storageInterface: typeof api.openProjectStorage === 'function',
      storageLabel: context.storage && context.storage.label,
      storageWritable: Boolean(context.storage && context.storage.writable),
      storagePackaged: Boolean(context.storage && context.storage.packaged),
      registryInterface: typeof api.openRegistryEditor === 'function'
        && typeof api.listRegistries === 'function'
        && typeof api.saveRegistry === 'function',
      promptBuilderInterface: typeof api.openEffectPromptBuilder === 'function'
        && typeof api.openTransitionPromptBuilder === 'function'
    });
  } catch (error) {
    showFatalError(errorMessage(error));
  }
}

for (const button of elements.routeButtons) {
  button.addEventListener('click', () => setRoute(button.dataset.route));
  button.addEventListener('pointerup', () => button.blur());
}

for (const closeButton of document.querySelectorAll('[data-close-dialog]')) {
  closeButton.addEventListener('click', () => closeDialog(closeButton.closest('dialog')));
}

elements.workspaceSelect.addEventListener('change', event => {
  if (event.target.value) void selectWorkspace(event.target.value);
});

elements.openStorageButton.addEventListener('click', () => void openProjectStorage());
elements.registryEditorButton.addEventListener('click', () => void openRegistryEditor());
elements.effectPromptButton.addEventListener('click', () => void openEffectPromptBuilder());
elements.transitionPromptButton.addEventListener(
  'click',
  () => void openTransitionPromptBuilder()
);
elements.newWorkspaceButton.addEventListener('click', () => openWorkspaceDialog());
elements.createFirstWorkspaceButton.addEventListener('click', () => openWorkspaceDialog());
elements.playWelcomeExampleButton.addEventListener('click', playWelcomeExample);
elements.trashLibraryButton.addEventListener('click', openRecoveryDialog);
elements.importProjectButton.addEventListener('click', () => void importPortableProject());
elements.newProjectButton.addEventListener('click', openNewProjectFlow);
elements.workspaceDialog.addEventListener('close', () => {
  const continuation = state.workspaceContinuation;
  state.workspaceContinuation = null;
  if (continuation === 'copy-example') state.pendingProject = null;
});
elements.workspaceForm.addEventListener('submit', event => void handleWorkspaceSubmit(event));
elements.projectForm.addEventListener('submit', event => void handleProjectSubmit(event));
elements.copyForm.addEventListener('submit', event => void handleCopySubmit(event));
elements.renameForm.addEventListener('submit', event => void handleRenameSubmit(event));
elements.trashForm.addEventListener('submit', event => void handleTrashSubmit(event));
elements.recoveryList.addEventListener('click', event => {
  const button = event.target.closest('[data-recovery-action]');
  if (!button) return;
  const row = button.closest('[data-trash-id]');
  const item = state.trashedProjects.find(candidate => candidate.trashId === row?.dataset.trashId);
  if (!item) return;
  if (button.dataset.recoveryAction === 'restore') {
    void restoreTrashedProject(item, button);
  } else if (button.dataset.recoveryAction === 'delete') {
    void deleteTrashedProject(item, button);
  }
});

elements.projectGrid.addEventListener('click', event => {
  const actionButton = event.target.closest('[data-project-action]');
  if (!actionButton) return;
  const card = actionButton.closest('[data-project-id]');
  const project = state.projects.find(item => item.id === card?.dataset.projectId);
  if (!project) return;

  switch (actionButton.dataset.projectAction) {
    case 'copy':
      prepareCopyDialog(project);
      break;
    case 'edit':
      actionButton.disabled = true;
      api.openProjectEditor(state.selectedWorkspace.id, project.id)
        .catch(error => showToast(errorMessage(error), true))
        .finally(() => {
          actionButton.disabled = false;
        });
      break;
    case 'play':
      actionButton.disabled = true;
      api.openProjectPlayer(state.selectedWorkspace.id, project.id)
        .catch(error => showToast(errorMessage(error), true))
        .finally(() => {
          actionButton.disabled = false;
        });
      break;
    case 'export':
      void exportPortableProject(project, actionButton);
      break;
    case 'rename':
      prepareRenameDialog(project);
      break;
    case 'duplicate':
      void duplicateProject(project, actionButton);
      break;
    case 'trash':
      prepareTrashDialog(project);
      break;
    default:
      break;
  }
});

function launchConceptSlideshow(projectId, triggerButton) {
  if (!api) return;
  if (triggerButton) triggerButton.disabled = true;
  api.openProjectPlayer('examples', projectId)
    .catch(error => showToast(errorMessage(error), true))
    .finally(() => {
      if (triggerButton) triggerButton.disabled = false;
    });
}

for (const card of elements.conceptSlideshowCards) {
  for (const button of card.querySelectorAll('[data-concept-play]')) {
    button.addEventListener('click', () => {
      launchConceptSlideshow(card.dataset.conceptProject, button);
    });
  }
}

api?.onLibraryRefresh(() => {
  refreshLibrary().catch(error => showToast(errorMessage(error), true));
});

window.addEventListener('hashchange', () => {
  const route = window.location.hash.replace(/^#/, '');
  if (route === 'home' || route === 'library' || route === 'concept') setRoute(route);
});

setRoute(window.location.hash.replace(/^#/, ''));
void initialize();
