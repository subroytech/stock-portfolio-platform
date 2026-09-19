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
| 📡 API Call Ledger | https://claude.ai/code/artifact/f511c572-6ade-4228-8b45-499463f14dad | No single source file — synthesized directly from the backend's service/controller code. A summary table plus one detail card per usage feature, showing its exact FMP/Finnhub call formula, which endpoints it hits, and whether it's day-cached or always-live |

**The Markdown files (in this repo) are the source of truth.** The Artifacts are a
presentation layer published on top of them and don't update automatically — if the
underlying `.md` file changes meaningfully, ask Claude to regenerate and redeploy the
matching Artifact (redeploying reuses the same link above; it never creates a new one). The
API Call Ledger has no single source file, so it needs a manual re-synthesis from the current
code any time the underlying FMP/Finnhub call logic changes meaningfully.

*Published 2026-08-15. API Call Ledger added 2026-09-07. All 5 refreshed 2026-09-12.*
