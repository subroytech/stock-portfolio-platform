# 0. Published Artifacts

The three technical docs in this folder (`01-Environment-Details.md`,
`02-Functional-Code-Workflow.md`, `03-Test-Details.md`) plus a couple of other repo docs
also exist as **shareable, visually designed web pages** ("Artifacts") — same content,
easier to read, with real diagrams instead of ASCII art.

**These links are private by default.** Only share them (via each page's own share menu)
with people you intend to show.

| Artifact | Link | Covers |
|---|---|---|
| 📘 Platform Field Guide | https://claude.ai/code/artifact/da3b9b71-fbc4-4926-9f88-926d8dfdce12 | This folder's 3 docs — Environment, Code Workflow, Testing |
| 🔑 Access & Roles Reference | https://claude.ai/code/artifact/d4f88692-b9b2-4b43-975d-8cfbf31e6cde | `User Manual.md` — the 5-role permission matrix, API-key fallback logic |
| 🗄️ Database Atlas | https://claude.ai/code/artifact/057df93c-4919-40ae-8c87-6a15c4b0f787 | `backend/src/db/SCHEMA.md` — entity-relationship diagrams + every table's columns |
| 🗺️ Rebuild Roadmap | https://claude.ai/code/artifact/40a820e7-6ffe-46bf-940e-c4a90a923d01 | `Architecture.md` — the original shortcomings, target architecture, build timeline |

**The Markdown files (in this repo) are the source of truth.** The Artifacts are a
presentation layer published on top of them and don't update automatically — if the
underlying `.md` file changes meaningfully, ask Claude to regenerate and redeploy the
matching Artifact (redeploying reuses the same link above; it never creates a new one).

*Published 2026-08-15.*
