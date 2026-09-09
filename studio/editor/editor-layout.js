(() => {
    const workspace = document.getElementById('editorWorkspace');
    const settingsPanel = document.getElementById('projectSettingsPanel');
    const settingsContent = document.getElementById('projectSettingsContent');
    const timelinePanel = document.getElementById('slidesTimelinePanel');
    const toggle = document.getElementById('projectSettingsToggle');

    if (
        !workspace
        || !settingsPanel
        || !settingsContent
        || !timelinePanel
        || !toggle
    ) {
        return;
    }

    const setSettingsCollapsed = collapsed => {
        if (collapsed) {
            const timelineWidth = Math.round(timelinePanel.getBoundingClientRect().width);
            workspace.style.setProperty(
                '--timeline-column-width',
                `${Math.max(timelineWidth, 1)}px`
            );
        } else {
            workspace.style.removeProperty('--timeline-column-width');
        }

        workspace.classList.toggle('project-settings-collapsed', collapsed);
        settingsPanel.classList.toggle('is-collapsed', collapsed);
        settingsContent.inert = collapsed;
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute(
            'aria-label',
            collapsed ? 'Expand Project Settings' : 'Collapse Project Settings'
        );
        toggle.title = collapsed ? 'Expand Project Settings' : 'Collapse Project Settings';
    };

    toggle.addEventListener('click', () => {
        setSettingsCollapsed(!settingsPanel.classList.contains('is-collapsed'));
    });

    setSettingsCollapsed(false);
})();
