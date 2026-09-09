# Movement Timeline Studio Authoring Kit

This is the no-installer, source-visible Windows edition of Movement Timeline
Studio. Extract the complete ZIP before using it, then start
`Movement Timeline Studio.exe`.

Movement is the project/medium; Early Formation is the website and umbrella
brand; Redhead Couple is the maintainer and publisher.

The current source candidate is Movement Public Alpha 0.1, version
`0.1.0-alpha.1`, with planned tag `v0.1.0-alpha.1`. The actual kit version is in
`resources/app/package.json`. The planned repository is
https://github.com/redhead-couple/movement; it and its GitHub release have not
yet been published. This Windows Alpha build is unsigned, so Windows may show
a SmartScreen or unknown-publisher warning.

The editable application source is in:

```text
resources/app/
```

Open that directory in your code editor or AI coding environment. Effects and
transitions are intentionally left unpacked:

```text
resources/app/effects/
resources/app/transitions/
```

Read `resources/app/docs/DESKTOP_AUTHORING_KIT.md` before adding an engine. It
explains the required maker, engine, registry, testing, and restart workflow.

Projects are stored in the visible `workspace/` folder beside the application.
On first launch there is no user workspace: the complete bundled Examples
workspace opens read-only, and the application offers to create `My Workspace`
when the user is ready. Keep backups of important projects and custom engines
before replacing this extracted folder.

This kit does not require an installer, PHP, MySQL, Node.js, or internet access
for normal use. The included test files are reference material: the packaged
`package.json` has no `npm test` script, and the kit lacks inputs needed by the
full suite. Use a full source checkout for automated testing. Restart and check
your changes in the kit's maker, editor, and player when editing its source.
