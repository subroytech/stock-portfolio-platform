# 4. REST API Reference

**Status: compiled 2026-10-04, verified directly against the current route and controller
source files (not inferred from the frontend or from memory).**

This is a complete, endpoint-by-endpoint reference for every backend route: HTTP method, full
path, auth/permission gate, request shape, and response shape. It answers a different question
than the published **📡 API Call Ledger** Artifact (`00-Published-Artifacts.md`) — the Ledger
covers only the 7 features that make outbound FMP/Finnhub calls, and for each one shows the
*external* call formula/cost and caching behavior, never this app's own HTTP method/path/request/
response contract. This document has almost no content overlap with it: a route like
`POST /auth/login` appears here in full detail but never in the Ledger at all, since it makes no
outbound API call.

**Total: 97 routes across 19 files** in `backend/src/routes/`. (A past count of "79" in this
project's own notes was written before several rounds of feature work since — Flex Quota,
Candlestick Charts, Candlestick Pattern Q&A, Usage Audit, Run History, and others all added
routes afterward. This document reflects the current, actual count.)

## Conventions used below

- **Base URL**: every path below is relative to the backend's origin (e.g. `http://localhost:4000`
  in local dev) — there is no shared `/api` prefix.
- **`requireAuth`**: the caller must have a valid session cookie (set at login). Checked at the
  `app.use(...)` mount level for every route file **except** `auth.routes.ts`, which is mounted
  with no blanket `requireAuth` — its own public routes (signup, login, forgot-password, etc.)
  apply it per-route instead, or not at all.
- **`requirePermission('x:y')`**: beyond being logged in, the caller's *resolved* permissions
  (from their role(s), looked up live — never a hardcoded role-name check) must include this
  exact permission key. See `User Manual.md` for which roles hold which permissions by default.
- **`rateLimiters`**: a generic IP/user-based throttle applied to every route file at the mount
  level, on top of any feature-specific rate limit noted per-route below (e.g. Candlestick
  refresh, Candlestick Pattern Q&A's Ask).
- **Error shapes**: a non-2xx response is `{ error: string }` (or a validation-specific shape),
  produced by the central `errorHandler` middleware mapping a typed, thrown Error class to an
  HTTP status. The "Notes" line under each route lists only the status codes actually backed by
  a real thrown error in that route's own controller — not a hypothetical/generic list.
- Optional fields are marked `optional`; everything else is required unless stated otherwise.

---

## 1. Authentication & Session — `auth.routes.ts`, mounted at `/auth`

The only route file with any public (non-`requireAuth`) routes.

**`POST /auth/signup`** — Gate: public (no requireAuth)
- Request: `email` (string), `password` (string), `firstName` (string), `lastName` (string),
  `securityAnswers` (array, exactly 5 entries, each `{questionId: string, answer: string}`,
  answer 1–20 chars)
- Response: `201` — the resolved session object: `{ ...user (id, email, status, firstName,
  lastName), roles: string[], permissions: string[], impersonating: false,
  newSupportTicketCount?: number }`. Sets an httpOnly auth cookie.
- Notes: `400` invalid email/missing names/password policy violation/wrong `securityAnswers`
  count or shape; `409` if email already exists; `400` via invalid question selection. Account is
  created `status: 'pending'` with no role assigned.

**`POST /auth/login`** — Gate: public
- Request: `email` (string), `password` (string)
- Response: resolved session object, same shape as signup's response. Sets auth cookie.
- Notes: `400` missing/wrong-type fields; `401` invalid credentials. Fires a fire-and-forget
  daily usage-aggregation sweep after responding.

**`POST /auth/logout`** — Gate: public
- Request: none
- Response: `{ success: true }`. Clears the auth cookie.

**`GET /auth/me`** — Gate: requireAuth (applied per-route)
- Request: none (uses the session's own user id)
- Response: resolved session object, same shape as signup's response.
- Notes: `401` if the id from the token no longer resolves to a real user.

**`GET /auth/security-questions`** — Gate: public
- Request: none
- Response: `{ questions: [...] }` — the full active question catalog (for the Registration form).

**`GET /auth/security-questions/mine`** — Gate: requireAuth
- Request: none
- Response: `{ questions: [...] }` — id+text only, the caller's own currently-saved 5 questions.

**`PUT /auth/security-questions`** — Gate: requireAuth
- Request: `currentPassword` (string), `securityAnswers` (array, exactly 5,
  `{questionId: string, answer: string}`, 1–20 chars each)
- Response: `{ success: true }`
- Notes: `400` on bad shape/count, wrong current password (deliberately not `401` — see the
  wrong-password-shouldn't-log-you-out fix in `02-Functional-Code-Workflow.md`), or invalid
  question selection.

**`POST /auth/change-password`** — Gate: requireAuth
- Request: `currentPassword` (string), `newPassword` (string)
- Response: `{ success: true }`
- Notes: `400` missing fields, wrong current password, policy violation, or reuse of one of the
  last 5 passwords; `401` only if the session's own password hash can't be found at all.

**`POST /auth/forgot-password/start`** — Gate: public
- Request: `email` (string)
- Response: `{ challengeToken: string, questions: [...] }` — 3 randomly-chosen questions from the
  account's saved 5.
- Notes: `400` invalid email; `404` if no account with that email, or the account has no saved
  security answers (deliberately not anti-enumeration-safe — see `User Manual.md`).

**`POST /auth/forgot-password/verify`** — Gate: public
- Request: `challengeToken` (string), `answers` (array, exactly 3, `{questionId, answer}`)
- Response: `{ resetToken: string }`
- Notes: `400` missing/wrong-count fields, expired/invalid challenge token, mismatched question
  ids, or one or more wrong answers (generic message, never reveals which).

**`POST /auth/forgot-password/reset`** — Gate: public
- Request: `resetToken` (string), `newPassword` (string)
- Response: `{ success: true }`
- Notes: `400` missing fields, expired/invalid reset token, policy violation, or reuse of a last-5
  password; `404` if the account no longer exists.

**`POST /auth/impersonate`** — Gate: requireAuth + `requirePermission('users:impersonate')`
- Request: `userId` (string)
- Response: resolved session object for the **target** user, `impersonating: true`. Sets a
  shorter-lived auth cookie carrying the admin's own id as `impersonatedBy`.
- Notes: `400` missing `userId`; `409` if already impersonating someone; `404` unknown target;
  `403` if the target itself holds any Admin Console permission (no impersonating another admin).

**`POST /auth/stop-impersonating`** — Gate: requireAuth
- Request: none (uses the session's own `impersonatedBy`)
- Response: resolved session object for the **original** admin, `impersonating: false`. Resets
  the cookie to normal (7-day) length.
- Notes: `400` if not currently impersonating.

---

## 2. API Keys — `userSubscription.routes.ts`, mounted at `/subscriptions`

**`GET /subscriptions`** — Gate: requireAuth + `requirePermission('api_keys:manage_own')`
- Request: none
- Response: `{ subscriptions: [{ provider, maskedKey: string, planTier: string|null, status,
  renewalDate: string|null, createdAt, updatedAt }] }`

**`PUT /subscriptions/:provider`** — Gate: requireAuth + `requirePermission('api_keys:manage_own')`
- Request: param `provider` (must be `fmp`, `finnhub`, or `anthropic`); body `apiKey` (string),
  `planTier` (string, optional), `status` (string, optional, default `active`), `renewalDate`
  (string, optional)
- Response: `{ subscription: { provider, maskedKey, planTier, status, renewalDate, createdAt,
  updatedAt } }` — the raw key is never echoed back, only the masked form.
- Notes: `400` unknown provider or missing/empty `apiKey`.

**`DELETE /subscriptions/:provider`** — Gate: requireAuth + `requirePermission('api_keys:manage_own')`
- Request: param `provider` (string)
- Response: `{ success: true }`
- Notes: `404` if no subscription exists for that user/provider.

---

## 3. Portfolios — Legacy & Flex — `portfolio.routes.ts`, mounted at `/portfolios`

**`GET /portfolios/`** — Gate: requireAuth
- Request: none
- Response: `{ portfolios: [{ id, name, broker: string|null, createdAt, updatedAt,
  uploadTemplateId: string|null, flexTemplateStatus: 'Flex'|'Flex-Err'|null }] }`

**`POST /portfolios/`** — Gate: requireAuth
- Request: `name` (string), `broker` (string|null, optional)
- Response: `201` — the created portfolio summary (same shape as the list above).
- Notes: `400` missing/blank name; `409` duplicate portfolio name for that user.

**`POST /portfolios/flex`** — Gate: requireAuth + `requirePermission('portfolio_upload:flex')`
- Request: `name` (required unless `dryRun`), `broker` (optional), either `uploadTemplateId`
  (string) or `columnMapping` (object), plus `headerRowIndex`, `dataStartColumnIndex`,
  `footerMarkerColumnIndex`, `footerMarkerText`, `cashConfig`, `filename`, `content` (required),
  `dryRun` (boolean)
- Response (`dryRun: true`, no writes): `{ preview: true, holdings: [...], cashAmount: number,
  errors: string[] }`
- Response (normal): `201 { portfolio: PortfolioSummary, importResult: { holdingsCount: number,
  cashAmount: number, actionsLogged: number, uploadId: string } }`
- Notes: `400` missing `content` or neither mapping source given; dry-run-specific: `404` unknown
  template, `400` mapping mismatch/oversized sample/parse error; normal path additionally: `409`
  duplicate name, `409` Flex portfolio quota exceeded.

**`GET /portfolios/:id`** — Gate: requireAuth
- Request: param `id`
- Response: `{ portfolio: { ...summary fields, cashAmount, holdings: [{ id, symbol, name,
  quantity, purchasePrice, currentPrice, sector, purchaseDate, costBasis, currentValue,
  gainLoss, returnPct, allocationPct, priceUpdatedAt, todayChangeDollar, todayChangePercent }],
  totalHoldingsValue, totalCostBasis, totalGainLoss, totalPortfolioValue } }`
- Notes: `404` not found (or not owned by the caller).

**`PUT /portfolios/:id`** — Gate: requireAuth
- Request: param `id`; body `name` (optional, can't be blank if given), `broker` (optional)
- Response: `{ portfolio: PortfolioSummary }`
- Notes: `400` blank name; `404` not found; `409` duplicate name.

**`DELETE /portfolios/:id`** — Gate: requireAuth
- Request: param `id`
- Response: `{ success: true }`
- Notes: `404` not found.

**`POST /portfolios/:id/import`** — Gate: requireAuth + `requirePermission('portfolio_upload:legacy')`
- Request: param `id`; body `filename` (optional), `content` (required), `dryRun` (boolean)
- Response (`dryRun: true`): `{ preview: true, sourceFormat: 'robinhood_txt'|'csv', holdings:
  [...], cashAmount: number, errors: string[] }`
- Response (normal): `{ holdingsCount, cashAmount, actionsLogged, uploadId }` (no wrapper object)
- Notes: `400` missing content or a recognized parse-failure message (missing columns, empty
  file, unrecognized Robinhood format, no valid rows); `404` portfolio not found.

**`POST /portfolios/:id/flex-template`** — Gate: requireAuth + `requirePermission('portfolio_upload:flex')`
- Request: param `id`; body `templateName` (required), `columnMapping` (required object),
  `samplePreview` (optional), `headerRowIndex`/`dataStartColumnIndex` (default `1`),
  `footerMarkerColumnIndex`/`footerMarkerText`/`cashConfig` (default `null`),
  `howToUseDescription` (optional)
- Response: `{ portfolio: PortfolioSummary, template: { id, templateName, status, createdBy,
  createdAt, howToUseDescription } }`
- Notes: `400` missing/invalid `templateName`/`columnMapping`; `404` portfolio not found; `409`
  if the portfolio isn't currently in the `Flex-Err` (unresolved) state, or the template name is
  a duplicate, or the template quota is exceeded.

**`PUT /portfolios/:id/flex-template`** — Gate: requireAuth + `requirePermission('portfolio_upload:flex')`
- Request: param `id`; body either `uploadTemplateId` or `columnMapping`, plus the same
  header/data/footer/cash fields as above, `filename`, `content` (required)
- Response: `{ portfolio: PortfolioSummary, importResult: {...} }` — always re-runs the import
  against the new mapping before persisting.
- Notes: `400` missing content or neither mapping source given, or sample/mapping-mismatch
  errors; `404` portfolio or template not found; `409` if the portfolio's template isn't already
  in the resolved `Flex` state.

**`POST /portfolios/:id/refresh-prices`** — Gate: requireAuth
- Request: param `id`
- Response: `{ holdings: [{ id, symbol, currentPrice, currentValue, gainLoss, returnPct,
  allocationPct, priceUpdatedAt, todayChangeDollar, todayChangePercent }],
  performanceHistory: Record<symbol, HistoricalBar[]> }`
- Notes: `404` portfolio not found; `503` no FMP key on file (own or fallback). Logs real
  FMP-call counts (fire-and-forget) for Usage Audit.

---

## 4. Portfolio Templates — `portfolioTemplate.routes.ts`, mounted at `/portfolio-templates`

**`GET /portfolio-templates/`** — Gate: requireAuth + `requirePermission('portfolio_upload:flex')`
- Request: query `search` (optional)
- Response: `{ templates: [{ id, templateName, status, createdBy, createdAt,
  howToUseDescription }] }` — filtered to Approved templates from admin/admin-master or the
  caller themselves, never a flat everyone-sees-everything list.

**`GET /portfolio-templates/mine/pending`** — Gate: requireAuth + `requirePermission('portfolio_upload:flex')`
- Request: none
- Response: `{ templates: [...] }` — same shape, the caller's own Pending-Approval templates.

**`POST /portfolio-templates/`** — Gate: requireAuth + `requirePermission('portfolio_upload:flex')`
- Request: `templateName` (required), `columnMapping` (required object), `samplePreview`
  (optional), header/data/footer/cash fields (same defaults as above), `howToUseDescription`
  (optional)
- Response: `201 { template: TemplateSummary }`
- Notes: `400` missing/invalid name or mapping; `409` duplicate name, or quota exceeded.

**`GET /portfolio-templates/admin/all`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: none
- Response: `{ templates: [{ ...TemplateSummary, createdByEmail: string|null }] }`

**`GET /portfolio-templates/unattached-portfolios`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: none
- Response: `{ portfolios: [{ id, name, ownerEmail, createdAt, holdingsCount, cashAmount }] }` —
  Flex portfolios stuck in the unresolved `Flex-Err` state.

**`DELETE /portfolio-templates/unattached-portfolios/:portfolioId`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: param `portfolioId`
- Response: `{ success: true }`
- Notes: `404` if the portfolio is gone or no longer stuck in `Flex-Err`.

**`GET /portfolio-templates/:id`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: param `id`
- Response: `{ template: { ...TemplateSummary, reviewedBy, reviewedAt, samplePreview,
  columnMapping, headerRowIndex, dataStartColumnIndex, footerMarkerColumnIndex,
  footerMarkerText, cashConfig } }`
- Notes: `404` not found.

**`PUT /portfolio-templates/:id/status`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: param `id`; body `status` (must be `Approved` or `Rejected`)
- Response: `{ success: true }`
- Notes: `400` any other status value; `404` not found. Reviewer is recorded from the session.

**`DELETE /portfolio-templates/:id`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: param `id`
- Response: `{ success: true }`
- Notes: `404` not found; `409` if the template isn't `Rejected`/`Pending Approval`, or is still
  bound to a real portfolio. A hard, permanent delete.

**`GET /portfolio-templates/:id/bound-portfolios`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: param `id`
- Response: `{ portfolios: [{ id, name, ownerEmail, createdAt }] }`

**`DELETE /portfolio-templates/:id/bound-portfolios/:portfolioId`** — Gate: requireAuth + `requirePermission('portfolio_template:manage_status')`
- Request: params `id`, `portfolioId`
- Response: `{ success: true }`
- Notes: `404` if the portfolio isn't found or isn't actually bound to this specific template.

---

## 5. Flex Quota — `flexQuota.routes.ts`, mounted at `/flex-quota`

**`GET /flex-quota/status`** — Gate: requireAuth
- Request: none (always "my own" status)
- Response: `{ pendingTemplates: { current, limit }, approvedTemplates: { current, limit },
  flexPortfolios: { current, limit } }`

---

## 6. Quotes — `quotes.routes.ts`, mounted at `/quotes`

**`GET /quotes/`** — Gate: requireAuth
- Request: query `symbols` (comma-separated string, e.g. `?symbols=AAPL,MSFT`)
- Response: `{ quotes: Record<symbol, Quote> }`
- Notes: `400` missing `symbols` or it resolves to zero valid symbols after parsing; `503` no FMP
  key available. Logs real (non-cached) call count for Usage Audit, fire-and-forget. Confirmed to
  currently have zero frontend callers (tracked for correctness, not an active under-reporting
  fix).

---

## 7. Contrarian Finder — `contrarianFinder.routes.ts`, mounted at `/contrarian-finder`

**`GET /contrarian-finder/universe`** — Gate: requireAuth
- Request: none
- Response: `{ indices: [{ id, description }], stocks: [{ symbol, name, sector, marketCap,
  indices: string[] }] }`

**`POST /contrarian-finder/scan-batch`** — Gate: requireAuth + `requirePermission('contrarian_finder:scan')`
- Request: `batchIndex` (number), `batchSize` (number, clamped 10–250), `maxBatches` (number,
  clamped 1–10), `qualityPreset` (string), `scanDays` (number, clamped 1–30),
  `updateAllTickerData` (boolean), `threshold` (number), `runRowId` (string)
- Response: `{ batchIndex, totalBatches, universeSize, results: ScanResult[], tickerRefresh?:
  { updated, skipped }, runRowId? }`
- Notes: `400` `batchIndex` out of range; `503` no FMP key, or the Python analysis service is
  unreachable/erroring.

**`POST /contrarian-finder/ticker-data-refresh-batch`** — Gate: requireAuth + `requirePermission('contrarian_finder:scan')`
- Request: `batchIndex`, `batchSize` (clamped 10–250), `maxBatches` (clamped 1–10)
- Response: `{ batchIndex, totalBatches, universeSize, updated, skipped }`
- Notes: `400` `batchIndex` out of range; `503` no FMP key.

**`POST /contrarian-finder/last-scan`** — Gate: requireAuth + `requirePermission('contrarian_finder:scan')`
- Request: `universeSize` (number), `scanned` (number), `params` (opaque object), `results`
  (opaque array)
- Response: `{ success: true }`
- Notes: `400` wrong types for `universeSize`/`scanned`/`results`. Retention tier (60-run rolling
  log vs. one-row-per-account) is resolved server-side from the caller's permissions.

**`GET /contrarian-finder/last-scan`** — Gate: requireAuth
- Request: none
- Response: `{ lastScan: { completedAt, universeSize, scanned, params, results } | null }` — the
  single newest run across both retention tiers, visible to everyone regardless of role.

**`GET /contrarian-finder/run-history`** — Gate: requireAuth + `requirePermission('contrarian_finder:view_history')`
- Request: none
- Response: `{ runs: [{ id, completedAt, universeSize, scanned, params }] }` — metadata only, the
  (potentially large) `results` blob is excluded to keep the list cheap.

**`GET /contrarian-finder/run-history/:id`** — Gate: requireAuth + `requirePermission('contrarian_finder:view_history')`
- Request: param `id`
- Response: `{ run: { completedAt, universeSize, scanned, params, results } }` — the full record.
- Notes: `404` unknown run id.

---

## 8. Momentum — `momentum.routes.ts`, mounted at `/momentum`

**`GET /momentum/:symbol`** — Gate: requireAuth
- Request: param `symbol`
- Response: `{ symbol, name: string|null, analysis: { price, sma20, sma50, rsi, macd: {macd,
  signal, hist, prevMacd, prevSig}, bb: {upper, mid, lower, bw}, volRatio, dayChg, score: {rsi,
  macd, volume, trend, riskReward, total}, signal: 'STRONG BUY'|'BUY'|'WATCH'|'AVOID', entryLow,
  entryHigh, entryMid, stopLoss, target, rr, flags: string[], extras: string[] } }`
- Notes: `400` missing symbol, or fewer than 30 trading days of history available; `429` per-user
  FMP rate limit exceeded; `503` no FMP key, or the Python analysis service is down.

---

## 9. Long-Term Analysis & Contrarian Comeback — `analysis.routes.ts`, mounted at `/analysis`

**`GET /analysis/health`** — Gate: requireAuth
- Request: none
- Response: `{ status: string }` — proxied verbatim from the Python analysis service's own
  `/health`.
- Notes: `503` analysis service unreachable or non-2xx.

**`GET /analysis/long-term/:symbol`** — Gate: requireAuth
- Request: param `symbol`
- Response: `{ symbol, companyName, sector, industry, exchange, price, marketCap, beta, range52w,
  dividend, valuation: {trailingPe, forwardPe, evToEbitda, peerAvgTrailingPe,
  peerAvgEvToEbitda, peerCount}, financials: {fyLabel, fyPrevLabel, revenue, grossMargin,
  operatingMargin, eps, netIncomeGrowthPct}, earningsSurprises: [...], priceTarget,
  upsidePct, consensus: {strongBuy, buy, hold, sell, strongSell, totalAnalysts, buyPct, holdPct,
  sellPct}, peers: [...], peerNote, bullSignals: string[], bearSignals: string[], mediumTerm:
  {rating, score, rationale}, longTerm: {rating, score, rationale}, news: [...] }`
- Notes: `400` missing symbol; `404` unrecognized ticker; `429` FMP rate limit exceeded; `503` no
  FMP key (Finnhub is optional/soft-fails), or the analysis service is down.

**`GET /analysis/contrarian-comeback/:symbol/gate`** — Gate: requireAuth
- Request: param `symbol`
- Response: `{ symbol, check1Pass, drawdownPct, dd52w, dd4y, check3Status: 'pass'|
  'override_available'|'hard_block', etfSymbol, etfReturn6M, check4Pass, recentNews: [...],
  insiderSignal, insiderBuys, insiderSells, analystUpgrades90d, analystDowngrades90d,
  priceTargetAvg, analystUpsidePct, failedCheck, reason, route }`
- Notes: `400` missing symbol; `404` unrecognized ticker; `429` FMP rate limit exceeded; `503` no
  FMP key or analysis service down. Populates a 30-minute per-(user, symbol) cache the Submit
  route below can reuse.

**`POST /analysis/contrarian-comeback/:symbol`** — Gate: requireAuth
- Request: param `symbol`; body `breakdownTypes` (non-empty array), `catalystAnswer` (`'yes'`\|
  `'no'`), `check3Override` (boolean, optional), `check3OverrideReason` (string|null, optional)
- Response: `{ symbol, format: 'A'|'B', failedCheck, reason, route, companyName, sector,
  exchange, price, drawdownPct, breakdownTypes, hybridCap, check3Override,
  check3OverrideReason, etfSymbol, etfReturn6M, score: {breakdown, sector, technical, value,
  catalyst, total, verdict: 'HIGH'|'MODERATE'|'SPECULATIVE'|'AVOID', hybridCapActive,
  sectorOverrideCapActive, hints}, technicals: {weeklyRsi, obvTrend, volumeDrying, sma200w,
  volumeRatioPct, volumeClimax}, fibonacci: {swingLow, athPrice, fib382, fib618, fib100},
  fundamentalHealth: {debtToEquity, currentRatio, freeCashFlow, revenueGrowthPct,
  grossMarginPct, cashRunwayMonths, positiveFcf}, catalystPipeline: {recentInsiderTrades,
  recentGrades, news, insiderSignal, analystUpgrades90d}, stagedEntry: {tranches, hardStop,
  capLabel: 'Large-Cap'|'Mid-Cap'|'Small-Cap', isMidCap}, recoveryTargets: {conservative,
  baseCase, bullCase, analystConsensus, riskRewardRatio}, valueDislocation: {peRatio,
  priceToSales, analystUpsidePct, sanityCheckTriggered} }`
- Notes: `400` missing symbol, empty `breakdownTypes`, or invalid `catalystAnswer`; `404`
  unrecognized ticker; `429` FMP rate limit exceeded (only checked on a cache miss); `503` no FMP
  key or analysis service down. Reuses a same-user Gate result from the last 30 minutes instead
  of re-fetching.

---

## 10. Stock Preview — `stockPreview.routes.ts`, mounted at `/stock-preview`

**`GET /stock-preview/:symbol`** — Gate: requireAuth
- Request: param `symbol`
- Response: `{ symbol, quote: { price, changeDollar, changePercent, name, isActivelyTrading } |
  null, historical: HistoricalBar[] }` (newest-first)
- Notes: `400` missing symbol; `429` FMP rate limit exceeded; `503` no FMP key.

---

## 11. Rate Limit Status — `rateLimit.routes.ts`, mounted at `/rate-limit`

**`GET /rate-limit/status`** — Gate: requireAuth
- Request: none
- Response: `{ exempt: boolean, limit: number, windowMinutes: number, usedInWindow: number,
  remaining: number | null }` — `remaining` is `null` when `exempt` is `true` (admin/admin-master).
  Reports the Candlestick Charts refresh budget specifically.

---

## 12. Candlestick Charts — `candlestick.routes.ts`, mounted at `/candlestick`

**`GET /candlestick/cached-symbols`** — Gate: requireAuth
- Request: none
- Response: `{ symbols: [{ symbol, interval: '5min'|'15min'|'30min'|'1hour'|'4hour'|'1day',
  updatedAt, isFresh: boolean }] }` — one row per distinct symbol, shared across all users.

**`GET /candlestick/:symbol/:interval`** — Gate: requireAuth
- Request: params `symbol`, `interval` (one of the 6 values above)
- Response (unwrapped): `{ bars: [{ date, open, high, low, close, volume }], indicators:
  Record<string, unknown>, updatedAt, isFresh: boolean, companyName: string | null }`
- Notes: `400` missing/unrecognized symbol or interval; `404` no cached data exists yet for that
  pair — this route **never** calls FMP, read-only against the cache.

**`POST /candlestick/:symbol/:interval/refresh`** — Gate: requireAuth
- Request: params `symbol`, `interval`; no body
- Response: same `CandlestickSnapshot` shape as the `GET` above, now freshly fetched.
- Notes: `400` missing/unrecognized symbol or interval; `429` the per-user Candlestick rate limit
  is exceeded; `503` no stored API key available for the fetch. The only route in this file that
  makes a real, billed FMP call.

---

## 13. Candlestick Pattern Q&A — `candlestickQuestionAnswer.routes.ts`, mounted at `/candlestick-question-answer`

**`GET /candlestick-question-answer/entries`** — Gate: requireAuth + `requirePermission('candlestick_question_answer:ask')`
- Request: query `query` (optional), `horizon` (optional, one of `dayTrading`/`mediumTerm`/
  `longTerm`), `tier` (optional, one of `101`/`201`/`301`)
- Response: `{ entries: [...] }`
- Notes: `400` invalid `horizon` value. Powers Browse — instant, free, no LLM call.

**`POST /candlestick-question-answer/ask`** — Gate: requireAuth + `requirePermission('candlestick_question_answer:ask')`
- Request: `question` (string), `horizon` (one of `dayTrading`/`mediumTerm`/`longTerm`)
- Response (answered): `{ outcome: 'answered_from_kb', answer: string, matchedEntryIds: string[],
  matchedPatterns: string[], reason: null }`
- Response (unable): `{ outcome: 'unable_to_answer', answer: null, matchedEntryIds: [],
  matchedPatterns: [], reason: string }`
- Notes: `400` empty question or invalid horizon; `429` the Ask-specific rate limit is exceeded
  (currently 10 questions/10 minutes); `503` no Anthropic key available. The only route in this
  file making a real, billed LLM call — see `02-Functional-Code-Workflow.md` §2.7c for the
  underlying agentic tool-calling loop.

**`GET /candlestick-question-answer/patterns`** — Gate: requireAuth + `requirePermission('candlestick_question_answer:manage_content')`
- Request: none
- Response: `{ patterns: [...] }`

**`POST /candlestick-question-answer/patterns`** — Gate: requireAuth + `requirePermission('candlestick_question_answer:manage_content')`
- Request: `patternName` (string), `formationDescription` (string), `relevantHorizons`
  (non-empty array of `dayTrading`/`mediumTerm`/`longTerm`), `complexityTier` (one of `Simple`/
  `Composite`/`Advanced`/`Complex`)
- Response: `201 { pattern: {...} }`
- Notes: `400` missing/invalid fields; `409` duplicate pattern name.

**`GET /candlestick-question-answer/admin/entries`** — Gate: requireAuth + `requirePermission('candlestick_question_answer:manage_content')`
- Request: none
- Response: `{ entries: [...] }` — every entry, including non-Approved, for the Admin screen.

**`POST /candlestick-question-answer/entries`** — Gate: requireAuth + `requirePermission('candlestick_question_answer:manage_content')`
- Request: `patternId` (string), `questionText` (string), `answerText` (string), `category` (one
  of `Definition`/`Interpretation`/`Reliability`/`How to Use`/`Common Mistakes`), `tier` (one of
  `101`/`201`/`301`)
- Response: `201 { entry: {...} }` — `createdBy` set from the session, content is Approved
  immediately (no pending-review queue for admin-authored content).
- Notes: `400` missing/invalid `patternId`/`category`/`tier`/text fields.

**`PUT /candlestick-question-answer/entries/:id/status`** — Gate: requireAuth + `requirePermission('candlestick_question_answer:manage_content')`
- Request: param `id`; body `status` (`Approved` or `Rejected`)
- Response: `{ success: true }`
- Notes: `400` any other status value; `404` unknown entry id.

---

## 14. Support Tickets — `supportTicket.routes.ts`, mounted at `/support`

**`POST /support/tickets`** — Gate: requireAuth only
- Request: `subject` (string), `body` (string)
- Response: `201 { ticket: {...} }`
- Notes: `400` missing/empty fields. Deliberately reachable by a `status: 'pending'` account —
  the one channel such an account has to reach an admin at all.

**`GET /support/tickets/mine`** — Gate: requireAuth only
- Request: none
- Response: `{ tickets: [...] }` — scoped to the caller.

**`GET /support/tickets/mine/:id`** — Gate: requireAuth only
- Request: param `id`
- Response: `{ ticket: {...}, messages: [...] }`
- Notes: `404` if the ticket doesn't exist or belongs to another user (ownership is hidden as a
  `404`, never a `403`). Side effect: marks the ticket read by its owner before responding.

**`POST /support/tickets/mine/:id/messages`** — Gate: requireAuth only
- Request: param `id`; body `body` (string)
- Response: `201 { message: {...} }`
- Notes: `400` empty body; `404` not found/not owned. Always reopens the ticket to `'new'`.

**`GET /support/tickets/summary`** — Gate: requireAuth + `requirePermission('support:manage')`
- Request: none
- Response: `{ counts: {...} }`

**`GET /support/tickets`** — Gate: requireAuth + `requirePermission('support:manage')`
- Request: query `status` (optional, one of `new`/`open`/`on_hold`/`closed`)
- Response: `{ tickets: [...] }`
- Notes: `400` invalid status filter value.

**`GET /support/tickets/:id`** — Gate: requireAuth + `requirePermission('support:manage')`
- Request: param `id`
- Response: `{ ticket: {...}, messages: [...] }`
- Notes: `404` unknown id. Side effect: marks the ticket opened by an admin (flips `new` → `open`)
  before responding.

**`POST /support/tickets/:id/messages`** — Gate: requireAuth + `requirePermission('support:manage')`
- Request: param `id`; body `body` (string), `status` (one of `open`/`on_hold`/`closed`)
- Response: `201 { message: {...} }`
- Notes: `400` empty body or invalid/missing status; `404` unknown id.

---

## 15. Usage Audit — `usageAudit.routes.ts`, mounted at `/usage-audit`

**`GET /usage-audit/last-3-days`** — Gate: requireAuth + `requirePermission('usage_audit:view')`
- Request: none
- Response: `{ ranking: [...] }` — the default landing view for the User Usage Dashboard.

**`GET /usage-audit/day`** — Gate: requireAuth + `requirePermission('usage_audit:view')`
- Request: query `offset` (must be `0`, `1`, or `2` — today/yesterday/day before)
- Response: `{ offset, ranking: [...] }`
- Notes: `400` missing or invalid `offset`.

**`GET /usage-audit/monthly`** — Gate: requireAuth + `requirePermission('usage_audit:view')`
- Request: query `month` (optional, `YYYY-MM-01`; defaults to the current month)
- Response: `{ month, ranking: [...], dataCutoff: ... }` — `dataCutoff` reflects the daily
  aggregation job's own watermark (the Monthly tab is deliberately a few days behind by design).
- Notes: `400` malformed `month`.

**`GET /usage-audit/available-months`** — Gate: requireAuth + `requirePermission('usage_audit:view')`
- Request: none
- Response: `{ months: [...] }` — populates the Monthly sub-tab's month picker.

---

## 16. Admin Console — Users, Roles, Functions

### `users.routes.ts` — mounted at `/users`

**`GET /users`** — Gate: requireAuth + `requirePermission('users:manage_roles')`
- Request: none
- Response: `{ users: [{ id, email, roles: string[], apiKeyProviders: string[], status,
  flexMaxPendingTemplatesOverride, flexMaxApprovedTemplatesOverride,
  flexMaxPortfoliosOverride }] }`

**`POST /users`** — Gate: requireAuth + `requirePermission('users:create')`
- Request: `email` (string), `password` (min 8 chars), `status` (optional, default `active`),
  `role` (optional, default `user`)
- Response: `201 { id, email, status, roles: string[] }`
- Notes: `400` invalid email/short password/unknown status/unknown role; `409` duplicate email.

**`PUT /users/:id/role`** — Gate: requireAuth + `requirePermission('users:manage_roles')`
- Request: param `id`; body `role` (string)
- Response: `{ id, roles: string[] }`
- Notes: `400` missing role or unknown role name.

**`PUT /users/:id/status`** — Gate: requireAuth + `requirePermission('users:manage_roles')`
- Request: param `id`; body `status` (string)
- Response: `{ id, status }`
- Notes: `400` missing or unknown status value.

**`PUT /users/:id`** — Gate: requireAuth + `requirePermission('users:manage_roles')`
- Request: param `id`; body (all optional, partial update) `email`, `password` (min 8 chars),
  `status`, `role`, `flexMaxPendingTemplatesOverride`/`flexMaxApprovedTemplatesOverride`/
  `flexMaxPortfoliosOverride` (each `number | null` — `null` clears the override, omitted leaves
  it untouched)
- Response: `{ id, email, status, roles: string[], flexMaxPendingTemplatesOverride,
  flexMaxApprovedTemplatesOverride, flexMaxPortfoliosOverride }`
- Notes: `400` invalid email/password/status/override value; `409` duplicate email.

### `roles.routes.ts` — mounted at `/roles`

**`GET /roles`** — Gate: requireAuth + `requirePermission('roles:manage')`
- Request: none
- Response: `{ roles: [{ id, name, userCount: number }] }`

**`POST /roles`** — Gate: requireAuth + `requirePermission('roles:manage')`
- Request: `name` (string)
- Response: `201 { role: { id, name, userCount } }`
- Notes: `400` missing/empty name; `409` duplicate role name.

**`DELETE /roles/:id`** — Gate: requireAuth + `requirePermission('roles:manage')`
- Request: param `id`
- Response: `{ success: true }`
- Notes: `409` if the role is still assigned to any user.

**`GET /roles/:id/permissions`** — Gate: requireAuth + `requirePermission('permissions:manage')`
- Request: param `id`
- Response: `{ permissions: string[] }`

**`POST /roles/:id/permissions`** — Gate: requireAuth + `requirePermission('permissions:manage')`
- Request: param `id`; body `permissionKey` (string)
- Response: `{ permissions: string[] }` — updated list after the grant.
- Notes: `400` missing key, unknown permission key, missing-parent-permission, or a
  role-not-allowed-for-this-permission rule (e.g. admin-master-only permissions).

**`DELETE /roles/:id/permissions/:key`** — Gate: requireAuth + `requirePermission('permissions:manage')`
- Request: params `id`, `key`
- Response: `{ permissions: string[] }` — updated list after the revoke.
- Notes: `409` if a still-granted child permission depends on this one (e.g.
  `contrarian_finder:scan_history` depending on `contrarian_finder:scan`).

### `functionMaster.routes.ts` — mounted at `/functions`

**`GET /functions`** — Gate: requireAuth + `requirePermission('permissions:manage')`
- Request: query `all` (optional — `all=true` includes inactive functions too)
- Response: `{ functions: [{ id, permissionKey, name, description, status }] }`

**`POST /functions`** — Gate: requireAuth + `requirePermission('functions:manage')`
- Request: `permissionKey` (string), `name` (string), `description` (optional), `status`
  (optional, default `active`)
- Response: `201 { function: {...} }`
- Notes: `400` missing/empty key or name, invalid status; `409` duplicate function.

**`PUT /functions/:id`** — Gate: requireAuth + `requirePermission('functions:manage')`
- Request: param `id`; body `status` (string)
- Response: `{ function: {...} }`
- Notes: `400` missing/empty status, invalid status; `404` not found.

---

## 17. Config Properties — `configProperty.routes.ts`, mounted at `/config-properties`

The only Admin Console area restricted to `admin-master` alone (`config_properties:manage` can
only ever be granted to that role — see `User Manual.md`).

**`GET /config-properties/groups`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: none
- Response: `{ groups: [{ id, name, description, createdAt, updatedAt }] }`

**`POST /config-properties/groups`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: `name` (string), `description` (optional)
- Response: `201 { group: {...} }`
- Notes: `400` missing/blank name; `409` duplicate group name.

**`PUT /config-properties/groups/:id`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: param `id`; body `name` (string), `description` (optional)
- Response: `{ group: {...} }`
- Notes: `400` missing/blank name; `404` not found; `409` duplicate name.

**`GET /config-properties/properties`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: query `groupId` (optional filter)
- Response: `{ properties: [{ id, groupId, groupName, propertyKey, name, description, valueType,
  minValue, maxValue, status, currentValue, currentVersion, createdAt, updatedAt }] }`

**`POST /config-properties/properties`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: `groupId`, `propertyKey`, `name`, `valueType`, `initialValue` (all required strings),
  `description`/`minValue`/`maxValue` (optional), `status` (optional, default `active`)
- Response: `201 { property: {...} }`
- Notes: `400` missing required field, bad `valueType`, or `initialValue` fails validation
  (outside min/max, wrong type for `valueType`); `409` duplicate `propertyKey` (globally unique,
  immutable once created).

**`PUT /config-properties/properties/:id`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: param `id`; body `name` (required), `description`/`minValue`/`maxValue` (optional),
  `status` (optional, default `active`)
- Response: `{ property: {...} }`
- Notes: `400` missing/blank name; `404` not found.

**`PUT /config-properties/properties/:id/value`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: param `id`; body `value` (string)
- Response: `{ value: { id, propertyId, value, version, effectiveTimestamp, isActive,
  changedBy, changedByEmail, createdAt } }` — inserts a new append-only history row; never
  updates or deletes a prior one.
- Notes: `400` missing/blank value, or value fails type/range validation; `404` property not
  found.

**`GET /config-properties/properties/:id/history`** — Gate: requireAuth + `requirePermission('config_properties:manage')`
- Request: param `id`
- Response: `{ history: [...] }` — the full append-only version history for that property.

---

For the underlying database tables behind all of the above, see `backend/src/db/SCHEMA.md`.
For the role/permission model governing which roles hold which `requirePermission()` keys by
default, see `User Manual.md`. For how a request actually flows Route → Middleware → Controller
→ Service, see `02-Functional-Code-Workflow.md` §2.1.
