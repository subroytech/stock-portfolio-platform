# Stock Portfolio Platform

Multi-user rebuild of the Stock Portfolio Dashboard. See `backend/` for the Node.js/Express API and `frontend/` (placeholder until Phase 3) for the client.

Rebuild plan: see `Architecture.md` in the original `CreateStockPortfolioViewWOSkill` project for the full phased plan. This repo currently implements Phase 0 (foundations) and Phase 1 (backend API + data model).

## Backend

```
cd backend
npm install
cp .env.example .env   # fill in FMP/Finnhub keys and DATABASE_URL (CockroachDB Cloud connection string)
npm run dev
```

## Status

- Phase 0/1 in progress — DB schema is provisioned and migrated on CockroachDB Cloud (`npm run migrate` in `backend/`, see `backend/src/db/migrations/`). `/portfolios` and `/health` endpoints themselves aren't built yet.
