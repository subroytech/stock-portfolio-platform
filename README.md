# Stock Portfolio Platform

Multi-user rebuild of the Stock Portfolio Dashboard. See `backend/` for the Node.js/Express API and `frontend/` (placeholder until Phase 3) for the client.

Rebuild plan: see `Architecture.md` in the original `CreateStockPortfolioViewWOSkill` project for the full phased plan. This repo currently implements Phase 0 (foundations) and Phase 1 (backend API + data model).

## Backend

```
cd backend
npm install
cp .env.example .env   # fill in FMP/Finnhub keys; DATABASE_URL can stay blank until Aiven is provisioned
npm run dev
```

## Status

- Phase 0/1 in progress — DB-dependent endpoints (`/portfolios`, `/health`) are blocked until an Aiven Postgres instance exists. See migration files in `backend/src/db/migrations/`.
