# Spec 053 — Remove code plugins (issue #101)

**Goal:** one way to extend agents. Nobody uses code plugins; ready-made tools come from MCP tool services and the
quick commands plugins were used for become built-in settings (spec 054). Fewer moving parts, no code loaded from the
server's disk per agent.

- The `plugins/` folder, the plugin loader and agent hooks (`tools`, `role`, `onMessage`, `init`) are gone; the router
  no longer asks a hook for a role or a reply, and no `local__…` tools are offered to the model.
- The agent field `plugins` is gone. Agents saved by an older version still carry it: it is dropped quietly on the
  next save or import (no "Ignored unknown field" warning), nothing else changes.
- Panel: no Plugins field, no `/api/plugins`, no "Missing plugins" note; AI helper and its visual diff, admin MCP,
  mobile app and the agent view (`localTools`, `missingPlugins`) no longer mention plugins.
- Docker image and docs no longer copy or describe plugins; the constitution's principle II reads "Agents as Data".

**Release:** 2.16.0 (with spec 054), `releases.json` note: not breaking in practice (single-owner installs, nobody
uses plugins); anyone with a custom plugin moves its tools to an MCP tool service.

**Tests:** `test/platform.test.js` (#101: old `plugins` field dropped without warnings; no `local__` tools).
