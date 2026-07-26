# scripts/

## `dev-restart.ps1`

Restarts all three local dev servers for this repo in one shot:

| Service | Port | URL |
|---|---|---|
| Frontend (React/Vite) | 3000 | http://localhost:3000 |
| Backend (Express) | 4000 | http://localhost:4000 |
| Analysis-service (FastAPI) | 8000 | http://localhost:8000/docs |

### What it does

1. Finds whatever's currently listening on ports 3000/4000/8000 and stops it —
   **by port, not by process name**, so it never touches unrelated Node/Python
   processes elsewhere on your machine.
2. Starts all three fresh in the background.
3. Writes each service's output to `scripts/logs/*.log` (already covered by
   the repo's root `*.log` gitignore rule — nothing to commit there).

### How to run it

Open PowerShell, `cd` to the repo root, then:

```powershell
.\scripts\dev-restart.ps1
```

**If PowerShell blocks it** ("execution of scripts is disabled on this
system" — Windows' default policy for unsigned local scripts), either:

- Run it once with: `powershell -ExecutionPolicy Bypass -File .\scripts\dev-restart.ps1`
- Or allow local scripts permanently for your user (one-time, standard for a
  dev machine): `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### After running

Give it a few seconds to boot, then check:

```powershell
curl http://localhost:3000/
curl http://localhost:4000/analysis/health   # 401 is expected here without a login cookie
curl http://localhost:8000/health
```

If a service didn't come up, check its log — e.g.
`scripts\logs\backend.err.log` — for the actual startup error.

### Requirements

- `backend/.env` must exist with a real `DATABASE_URL` (backend fails to
  start without one — see `backend/.env.example`).
- Poetry must be installed for `analysis-service` (the script falls back to
  `%APPDATA%\Python\Python314\Scripts\poetry.exe` if `poetry` isn't on PATH,
  matching how it was installed via `pip install --user poetry` on this
  machine — adjust that fallback path if Poetry is set up differently on
  yours).
