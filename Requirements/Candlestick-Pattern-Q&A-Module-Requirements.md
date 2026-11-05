# Candlestick Analysis Q&A Module — Requirements Document

**Date:** 2026-09-20 (originally), updated 2026-09-20 with Section 9.4/11.9 (spend-control
research), updated 2026-09-28 with Section 13 (candlestick pattern backlog), updated 2026-09-28 to
mark Tweezer Bottom/Top built and note Kicking's content is now drafted, updated 2026-09-29 to mark
Kicking built and add fully-drafted content for every remaining backlog item (Abandoned Baby,
Tasuki Gap, Rising/Falling Three Methods), updated 2026-10-03 to mark Abandoned Baby and Tasuki Gap
built, then again the same day to mark the Complex tier + Rising/Falling Three Methods built -
**Section 13 is now fully closed, no remaining candlestick pattern backlog items**
**Status:** Phase 1 (Section 4.1) has since been `/plan`-approved and built — see `CLAUDE.md`'s
"Anthropic API Key — Bring-Your-Own + Admin-Master Fallback" entry and this repo's plan history
for what actually shipped, which may have diverged in detail from this document's original,
tentative proposals (Section 5's schema in particular). Phase 2 (Section 4.2) has not been
planned or built. This document was written before any `/plan` session and has not been fully
reconciled against Phase 1's as-built shape — treat Sections 1-8 as historical intent, Section
9.4/11.9 (spend-control) as a separate unresolved open item, and Section 13 (added 2026-09-28) as
a running backlog for the independently-built pattern-detection/tier system, unrelated to this
document's own original LLM-Ask scope.
**Lens:** `Architecture.md`'s Platform Objective — a self-directed stock investing platform for
retail investors. This feature is decision-support/education, never personalized advice (see
Section 7).

---

## 1. Vision (as stated, restated for precision)

Build a Q&A knowledge base — "Candlestick Analysis 101/201/301" — that lets a self-directed
retail investor ask questions about candlestick chart **patterns** and get a trustworthy answer,
tagged by which trading horizon the question concerns.

**Two independent tagging axes** (confirmed): every question/answer carries *both*, not one or
the other.

| Axis | Values | What it represents |
|---|---|---|
| **Difficulty tier** | 101, 201, 301 | Curriculum-style progression — 101 = foundational ("what is a Doji?"), 201 = intermediate (multi-candle patterns, context-dependence), 301 = advanced (confluence with volume/trend, failure-rate nuance, conflicting-signal resolution) |
| **Trading horizon** | Day-Trading, Swing Trading, Long-Term Investment | Which timeframe the question's answer should be framed around — the same pattern can mean something different (or nothing at all) depending on horizon |

**Two build phases** (as stated):
- **Phase 1**: answer questions using only a curated internal knowledge base, via an LLM doing
  function-calling against internal DB tables. If the retrieved content doesn't sufficiently
  answer the question, respond "unable to answer" rather than guessing.
- **Phase 2**: for questions Phase 1 couldn't answer, fall back to a direct LLM call (not
  restricted to the curated DB), show that generated answer to the user, and — if approved —
  persist it into the curated knowledge base so the same question is answerable from the DB next
  time.

---

## 2. Scope boundary — what this is and isn't

**This is genuinely new ground for the platform**: confirmed via a full-repo search — there is
currently **zero** LLM/AI-provider integration anywhere in this codebase (no `openai`/
`anthropic`/embedding/vector-DB dependency in `backend/package.json`, `frontend/package.json`, or
`analysis-service/pyproject.toml`). This would be the platform's first LLM integration, full stop
— not an extension of an existing one. That has real consequences (Section 8) worth taking
seriously before scoping implementation.

**In scope**: candlestick **pattern recognition and interpretation** — Doji, Hammer/Hanging Man,
Engulfing, Morning/Evening Star, Harami, Three White Soldiers/Black Crows, Shooting Star, Piercing
Line/Dark Cloud Cover, and similarly-shaped formations — what they look like, what they
conventionally signal, and how that signal's reliability/relevance shifts by trading horizon.

**Explicitly out of scope, and complementary to (not a duplicate of) what's already built**: the
Candlestick Charts feature already shipped a **Quick Reference** tab
(`frontend/src/components/CandlestickQuickReference.tsx`,
`frontend/src/lib/candlestickIndicators.ts`) covering the 9 chart **indicators/overlays** (Moving
Averages, Bollinger Bands, VWAP, Pivot Points, Fibonacci, RSI, MACD, Volume MA, OBV) and which of
those are relevant to which of the same three horizons. That content is static, hand-curated
prose with zero data dependency — it answers "which indicator should I use when," not "what does
this candle shape mean." This new Q&A module should **reuse the same horizon taxonomy** (literally
the same three horizon values, ideally the same `HorizonId` type) but must not re-teach indicator
relevance — that's solved. Overlap only where a pattern's interpretation is itself
indicator-dependent (e.g., "is a Hammer more reliable near a support level from Pivot Points?") —
acceptable cross-reference, not duplication.

**Explicitly out of scope for both phases**: personalized stock-specific calls ("should I buy
AAPL because it just formed a Hammer?"). Per `Architecture.md`'s Platform Objective, this platform
"never executes a trade and never gives personalized financial advice." An LLM answering a
free-text question is a materially higher risk of drifting into advice-shaped language than the
platform's existing static content — this needs to be a hard guardrail in the system prompt/
scope-check, not an afterthought. See Section 7.

---

## 3. User Stories

### Phase 1
- As a self-directed investor, I can type a free-text question about a candlestick pattern (e.g.
  "What does a Bullish Engulfing pattern mean for swing trading?") and get a clear, sourced answer
  drawn from the platform's own curated content.
- As a user, when I ask a question the curated knowledge base can't answer, I'm told plainly that
  the platform can't answer it yet — not given a fabricated or low-confidence guess.
- As a user, my question is automatically associated with a trading horizon (Day-Trading/Swing/
  Long-Term) — either inferred from my question's own wording, or via an explicit selector I set
  — so the answer is framed for the timeframe I actually care about.
- As an admin/admin-master, I can see which questions came back "unable to answer," so I know
  where the knowledge base has real gaps.

### Phase 2
- As a user who got "unable to answer," I can ask again (or the platform can retry
  automatically) and get an LLM-generated answer that isn't restricted to the curated DB.
- As a user, I can indicate whether that generated answer was actually helpful.
- As the platform, a well-received generated answer becomes part of the curated knowledge base,
  so a future user asking the same or a similar question gets Phase-1's cheaper, faster,
  DB-backed path instead of hitting the LLM again.
- **As an admin** (see the open question in Section 9.2 — this may need to be admin-gated, not
  user-gated), I can review a generated answer before it's promoted into the trusted, publicly-
  served knowledge base — mirroring the existing Portfolio Template governance model, where a
  regular user's submission starts at `Pending Approval` and only an admin action moves it to
  `Approved`.

---

## 4. Functional Requirements

### 4.1 Phase 1 — Curated-DB-backed Q&A via function-calling

1. **Question intake**: a text input (see Section 6 for placement) accepting a free-text
   question, plus (pending Section 9.3's decision) either an explicit horizon selector or
   horizon inferred from the question text itself.
2. **Horizon identification**: every question must resolve to exactly one of the three horizon
   values before an answer is produced — this is a hard requirement, not optional metadata, per
   the original ask ("the question would always have an identifier"). If inferred rather than
   user-selected, the resolved horizon must be shown back to the user so they can correct a
   mis-classification before trusting the answer.
3. **Function-calling against internal DB tables**: the LLM is given one or more callable
   "tools" (in the LLM function-calling sense) that query the curated knowledge base — e.g. a
   `search_patterns(query, horizon, tier)` tool and a `get_pattern_detail(pattern_id)` tool — 
   rather than the LLM freely generating an answer from its own training data. The LLM decides
   which tool calls it needs, Node executes them against the real DB, and results are fed back to
   the LLM to compose the final answer.
4. **Sufficiency/confidence check**: after retrieving candidate content, the LLM (or a second,
   cheaper classification pass) must judge whether the retrieved content actually answers the
   question. This is a real, non-trivial NLP judgment call, not a simple "did any row match" —
   see Section 9.4 for the open question on how strict/lenient this should be.
5. **"Unable to answer" fallback**: if the sufficiency check fails, the platform returns a plain,
   honest "we don't have a good answer for this yet" message — never a low-confidence guess
   presented as fact. This is the single most important trust-preserving behavior in Phase 1.
6. **Logging**: every question (horizon, tier if applicable, whether it was answered or fell
   through to "unable to answer", and which curated content — if any — was used) must be logged
   for two reasons: (a) it's the direct input to Phase 2 ("Address the Unable to Answer
   Questions"), and (b) it's the only way an admin can see where the knowledge base has gaps.

### 4.2 Phase 2 — LLM-fallback, user feedback, and DB promotion

1. **Retry path for previously-unanswerable questions**: for a question (or a sufically-similar
   new question) that fell through Phase 1's "unable to answer" path, the platform makes a second
   LLM call **not restricted to function-calling against the curated DB** — the LLM answers from
   its own general knowledge of candlestick pattern analysis.
2. **Present + explicitly label the fallback answer**: the UI must make clear this answer did
   **not** come from the platform's own curated, vetted content — e.g. a visible "Generated
   answer — not yet reviewed" badge — so a user's trust calibration is accurate. This matters more
   here than almost anywhere else in the app, since Phase 1's whole design point was "never
   silently present an unverified answer as fact."
3. **User feedback capture**: a simple "was this helpful?" signal (thumbs up/down, or similar) on
   the generated answer.
4. **Promotion into the curated knowledge base**: on positive feedback, the Q&A pair (question,
   resolved horizon, tier, generated answer) is written toward the curated tables that Phase 1's
   function-calling tools query — **but see Section 9.2**: the requirements as stated ("if he
   thinks the answer is good, we will update our DB") don't yet say whether "he" is the asking
   user or an admin, and this document takes a position: raw end-user approval writing directly
   into a knowledge base every other user's answers get served from is a real quality/trust risk,
   and should default to the same `Pending Approval → Approved` governance model this repo already
   uses for Portfolio Templates, not a direct write.

---

## 5. Data Model (proposed, tentative — for `/plan` to finalize)

Following this repo's own established naming convention
(`backend/src/db/SCHEMA.md`'s `m_`/`tx_`/`sys_`/`user_evt_`/unprefixed scheme):

- **`m_candlestick_pattern`** — the master catalog of actual candlestick patterns (Doji, Hammer,
  Bullish Engulfing, ...): `id`, `pattern_name`, `formation_description`, `visual_criteria`
  (what makes a candle/candle-sequence qualify), `status` (`'active'`/`'inactive'`, same shape as
  `m_config_property`'s status column) — reference/master data, hence `m_`.
- **`m_candlestick_question_answer_entry`** — the actual curated Q&A pairs, each bound to a pattern: `id`,
  `pattern_id` (FK → `m_candlestick_pattern`), `horizon` (`'day_trading'`|`'swing_trading'`|
  `'long_term'` — ideally sharing a type/enum with the frontend's existing `HorizonId`), `tier`
  (`101`|`201`|`301`), `question_text` (the canonical phrasing this entry answers), `answer_text`,
  `status` (`'Pending Approval'`|`'Approved'`|`'Rejected'` — same lifecycle as
  `m_portfolio_template_mapping_master`), `created_by`/`reviewed_by`/`reviewed_at` (mirroring that
  same table's audit columns exactly). This is what Phase 1's function-calling tools query
  (`WHERE status = 'Approved'` only), and what Phase 2 inserts into at `'Pending Approval'`.
- **`user_evt_candlestick_question_answer_log`** — one row per question asked: `user_id`, `question_text`,
  `resolved_horizon`, `resolved_tier` (nullable — a question may not cleanly map to a tier),
  `outcome` (`'answered_from_kb'`|`'unable_to_answer'`|`'answered_from_llm_fallback'`),
  `matched_entry_id` (nullable FK → `m_candlestick_question_answer_entry`, when `outcome = 'answered_from_kb'`),
  `user_feedback` (nullable — Phase 2's thumbs up/down), `llm_call_details` (JSONB, same
  provider-prefixed-key convention `user_evt_usage.api_call_details` already uses — e.g.
  `{ llm_tokens_in, llm_tokens_out }`), `created_at`. `user_evt_` fits since this is genuinely
  per-user event data, unlike the shared `m_candlestick_question_answer_entry` catalog.

**Why a master/entry split, not one flat table**: mirrors this repo's own precedent
(`m_portfolio_template_mapping_master`/`_dtls`) — a pattern (e.g. "Bullish Engulfing") can have
multiple Q&A entries across different tiers/horizons ("what is it" at 101, "how does volume
confirm it" at 201), all describing the same underlying pattern. Keeping the pattern catalog
separate from its per-tier/horizon Q&A entries avoids repeating the pattern's own definition in
every entry.

**Not yet decided, deliberately left to `/plan`**: whether `m_candlestick_question_answer_entry` needs a
vector/embedding-based similarity search (to detect "is this new question actually the same as an
existing entry, just reworded") or whether a simpler LLM-driven "does this existing entry answer
the new question" check (itself a function call) is sufficient at this repo's likely question
volume. The former is a meaningfully bigger infrastructure lift (this repo has zero vector-search
capability today) — worth an explicit go/no-go conversation, not an assumed default.

---

## 6. RBAC / Feature Gating

Following the exact "gated Function, zero default grants" precedent already used for
`stock_analysis:view` (migration `041`), `contrarian_finder:view_history` (migration `036`), and
`usage_audit:view` (migration `040`) — each a new row in `m_function_master`, granted to no role
by default, with `admin`/`admin-master` able to grant it to any role via the existing Manage
Permission screen with zero new admin-console frontend needed (`RolePermissionsPage.tsx` already
sources its checklist live from `GET /functions`):

- **`candlestick_question_answer:ask`** — gates the ask-a-question UI itself (hidden entirely, not just
  disabled, same pattern as every other gated tab in `TabShell.tsx`).
- **`candlestick_question_answer:manage_content`** — gates the admin review/promotion screen (approve/reject a
  Phase-2-generated entry before it's trusted knowledge-base content) — mirrors
  `portfolio_template:manage_status`'s exact role in that feature.

---

## 7. Safety, Trust & Compliance Requirements

This section exists because an LLM answering open-ended questions is a categorically different
risk profile than every other feature in this app, all of which are either static prose or
deterministic computation over live market data.

1. **Hard scope guardrail in the system prompt**: the LLM must be constrained (via its system
   prompt / tool design, and ideally a post-hoc scope check) to candlestick pattern education —
   it must refuse or deflect any question that drifts into "should I buy/sell this specific
   stock" territory, consistent with the Platform Objective's "never gives personalized financial
   advice."
2. **Every answer must visibly carry its trust level**: a curated, admin-approved answer (Phase 1
   hit) should look different in the UI from a freshly-generated, not-yet-reviewed one (Phase 2's
   fallback) — see 4.2.2. Never let the two look the same to a user.
3. **"Unable to answer" must never be silently skipped in favor of a guess.** This is the entire
   reason Phase 1 is scoped as function-calling-against-curated-content-only, rather than just
   letting the LLM answer freely from turn one — worth stating explicitly as a requirement, not
   just an implementation detail, since it's the feature's core trust proposition.
4. **Promotion into the trusted knowledge base needs a real review gate** (Section 9.2) — a wrong
   or subtly-misleading answer, once promoted, would be served to every future user asking a
   similar question, at platform authority, not "one AI's opinion."
5. **Every interaction logged** (Section 5's `user_evt_candlestick_question_answer_log`) for auditability —
   if a bad answer is ever discovered live, there needs to be a way to find who saw it and when,
   same spirit as `user_evt_impersonation_log`'s security-audit-trail precedent.

---

## 8. Architecture Placement

- **Node owns the actual LLM provider call**, not the Python `analysis-service`. This follows
  `Architecture.md`'s own stated principle directly: *"Node stays the single API gateway even
  after Python enters the picture... Backend owns all third-party API calls."* FMP/Finnhub keys
  live in Node's environment only, never reaching the frontend or Python — an LLM provider key
  should follow the identical placement, as a new third-party API this platform calls, not
  something Python touches.
- **This is a new kind of key/credential for this platform** (Section 2) — unlike FMP/Finnhub,
  which are either the user's own bring-your-own key or the Admin-Master Fallback shared key, an
  LLM key for this feature is almost certainly platform-funded (a per-question LLM call isn't
  something to ask a retail user to bring their own API key for) — meaning **this platform, not
  the user, bears the real dollar cost of every question asked**. This is exactly why Section 6's
  rate-limiting and Config-Properties-driven cost controls (Section 9's `fmpRateLimit.service.ts`
  shape) aren't optional polish — they're the mechanism that keeps this feature's cost bounded at
  all.
- **"Function calling"** in the LLM sense is implemented as: Node defines the callable tool
  schemas (e.g. `search_patterns`, `get_pattern_detail`), passes them to the LLM API call, executes
  whichever tool calls the LLM requests as real Node-side DB queries against
  `m_candlestick_question_answer_entry`/`m_candlestick_pattern`, and feeds the results back to the LLM for a
  final composed answer — a standard synchronous tool-use loop, not a Python-side responsibility.

---

## 9. Cost, Rate Limiting & Admin Configurability

Reusing two frameworks this repo has already built, rather than inventing new ones:

- **Usage Tracking**: add `'candlestick_question_answer'` to `usageTracking.service.ts`'s `UsageFeature` union,
  and call `logUsage(userId, 'candlestick_question_answer', { llm_tokens_in, llm_tokens_out })` (or a simpler
  `{ llm_call: 1 }` if per-token accounting isn't available from the chosen provider) on every
  question — the exact same provider-prefixed-key convention `fmp_quote`/`finnhub_news` already
  use, so this feature's real cost shows up in the existing Usage Audit dashboard with zero new
  reporting infrastructure.
- **Rate limiting**: a new limiter mirroring `fmpRateLimit.service.ts`'s exact shape — N questions
  per M-minute window, `admin`/`admin-master` fully exempt (checked by literal role name, same
  precedent), both N and M stored as Config Properties so they're admin-tunable without a
  deploy. Given this is a brand-new, real-dollar-cost feature (unlike FMP calls, which the
  platform doesn't pay for per-call today under the BYO-key model), this limiter matters *more*
  here than it did for Candlestick Charts, not less.
- **Config Properties** for at least: which LLM model to use (`candlestick_question_answer_llm_model`, a
  `'string'`-typed property), the Phase-1 sufficiency threshold if it ends up being a tunable
  number rather than a fixed prompt behavior, and the rate-limit N/M pair above — all editable via
  the existing `ConfigPropertiesPage.tsx`, zero new admin UI needed.

### 9.4 Spend Visibility & Budget Gate (researched 2026-09-20)

Raised directly by the platform owner ahead of loading real money into the Anthropic account
("I will probably only load $10 in that Anthropic service at any given time") — before Phase 1's
free-text Ask goes live with a real, billed key, the platform owner wanted to understand whether
the application could query and display Anthropic's own remaining account balance to
`admin-master`, as a spend-control gate.

**Finding, confirmed directly against Anthropic's current API documentation (not assumed from
memory)**: **no such endpoint exists.**
- There is no API that returns "how many dollars remain on this account." The only place that
  figure is ever shown is the Anthropic Console's own Plans & Billing page — a human-only
  surface, with multiple open feature requests (filed against `anthropic-sdk-python` and
  `claude-code`, one as recently as this week) asking Anthropic for exactly this capability;
  none resolved as of this writing.
- What Anthropic *does* expose is the **Usage & Cost Admin API**
  (`/v1/organizations/usage_report/messages`, `/v1/organizations/cost_report`) — historical
  token consumption and $ spend already incurred, grouped by model/workspace/API key, with
  5+ minutes of lag. It never reports what's left, only what's already been used.
- Critically, that Admin API requires an **Admin API key** (`sk-ant-admin01-...`) — a
  fundamentally different, more privileged, organization-level credential than the regular
  `sk-ant-...` key this platform's `users_subscriptions`/`getDecryptedKey()` model already
  stores per user/role (see the "Anthropic API Key — Bring-Your-Own + Admin-Master Fallback"
  work, 2026-09-20). It does not fit this platform's existing per-provider key model at all —
  adopting it would mean introducing a second, differently-shaped secret type solely for cost
  reporting.

**Recommended approach — a self-tracked ledger, not a balance query**: since Phase 1 already
logs `llm_call_details: { llm_tokens_in, llm_tokens_out }` on every real Ask call (Section 5's
`user_evt_candlestick_question_answer_log`), the platform can compute its own estimated running
$ cost from those token counts against Anthropic's published, stable per-model pricing — no
Anthropic API call needed at all. Concretely:
1. A new Config Property (e.g. `candlestick_question_answer_budget_usd`) lets `admin-master` set
   a $ ceiling (e.g. `10.00`) — same admin-tunable-without-a-deploy pattern as every other
   Config Property in this app.
2. The platform maintains a running total of *estimated* spend, computed from logged token
   counts × a small maintained per-model price table (needs updating if
   `candlestick_question_answer_llm_model`'s configured model changes, or Anthropic changes
   pricing).
3. `admin-master` sees a live "$X of $Y spent, ~$Z remaining (estimated)" indicator in the
   Admin Console — computed, not queried from Anthropic.
4. The same running total becomes a real **hard gate**: once estimated spend crosses the
   configured budget, the free-text Ask path stops itself with a clear message, independent of
   what Anthropic's real Console balance says. This is the actual spend-control mechanism the
   platform owner is after — not just a passive display.

**Explicitly not recommended for now**: reconciling this self-tracked estimate against
Anthropic's real Cost API. It's a materially heavier lift (a second, org-level Admin API
credential to provision and store, new setup outside this app's existing key model, 5+ minute
data lag) for a benefit — catching drift between our estimate and Anthropic's actual bill — that
matters more at higher spend/scale than a deliberately small $10 gate. Worth revisiting only if
the self-tracked estimate is ever found to drift meaningfully from the real bill.

**Not yet decided — see Section 11 item 9**: whether to build this budget-gate mechanism now,
as part of Phase 1's own launch (before any real key is loaded), or treat it as a fast-follow
once the key is live and real usage data exists to validate the token-count-based estimate
against a first real invoice.

---

## 10. UI/UX Placement (open — see Section 11.5)

Two candidate placements, not yet decided:

- **A new top-level tab** (e.g. "Candlestick Q&A" or folded into a broader "Learn" tab) —
  appropriate if this is meant to be a general reference resource independent of any specific
  stock, which the "curated FAQ knowledge base" framing suggests it is.
- **Embedded inside the existing Candlestick popup**, alongside the already-shipped "Candlestick"
  / "Quick Reference" tabs built earlier this session — appropriate if the intent is "let me ask
  about the pattern I'm looking at right now," a more contextual entry point.

These aren't mutually exclusive (a top-level tab for open-ended browsing, plus a contextual
"Ask about this pattern" shortcut from inside the popup that pre-fills the question), but the
question of which one is the *primary* surface should be settled before `/plan` sizes the
frontend work.

---

## 11. Open Questions — need decisions before this becomes a plan

1. **LLM provider and model.** No integration exists today (Section 2) — this is a from-scratch
   vendor/API decision (cost, quality, function-calling support, data-handling/privacy terms for
   a financial-adjacent product) with real ongoing dollar cost, not a one-time build cost.
2. **Who approves Phase 2 promotions into the curated KB — the asking user, or an admin?** This
   document recommends admin-gated (Section 4.2.4, Section 7.4), mirroring Portfolio Template
   governance, but this reverses part of the original framing ("if **he** thinks the answer is
   good") and should be confirmed explicitly rather than assumed.
3. **Question intake: free-text with horizon inference, or a structured horizon selector?**
   Free-text is more natural but pushes real NLP-classification risk onto the horizon-tagging
   requirement (Section 4.1.2); a selector is a trivial UI dropdown with zero misclassification
   risk, at the cost of feeling less like "just ask a question." A hybrid (free text + an
   editable, LLM-suggested horizon) may be the right middle ground.
4. **How strict should the Phase 1 sufficiency check be?** Too strict → most real questions fall
   through to Phase 2's more expensive LLM-fallback path, undermining the whole point of building
   a curated DB first. Too lenient → Phase 1 confidently returns a poor-fit answer, which is worse
   than an honest "unable to answer." This is a tuning problem that needs real usage data, not a
   one-time design decision — plan for iteration.
5. **UI placement** (Section 10) — top-level tab, embedded-in-popup, or both.
6. **Initial seed content.** Someone has to write the first N curated Q&A entries covering the
   most common candlestick patterns across all three horizons and three tiers before Phase 1 has
   anything to answer from — this is real content-authoring work, not a code task, and should be
   sized/owned explicitly (subject-matter authoring, not necessarily an engineering task).
7. **Duplicate/near-duplicate question detection** (flagged already in Section 5) — needed so the
   same underlying question asked in different words doesn't either (a) spuriously "unable to
   answer" when a near-identical entry already exists, or (b) create redundant near-duplicate
   entries once Phase 2 promotion is live.
8. **Does the 101/201/301 tier ever gate what a given user sees**, or is it purely a content
   organization/authoring scheme with no per-user restriction? (E.g., does a new user always see
   101-level answers first, escalating to 201/301 only on request, or can any tier surface
   immediately depending on how the question was phrased?)
9. **Spend-control gate (Section 9.4) — build now or fast-follow?** A self-tracked $ budget
   ledger + hard-stop gate is recommended (no Anthropic balance-query API exists to build against
   instead), but whether it ships before or after the first real Anthropic key goes live, and
   what the actual budget figure/threshold behavior should be (hard stop vs. warning-only near
   the cap), is not yet decided.

---

## 12. Explicitly Not Covered By This Document

Per the user's own framing ("I know this is a lot... before even you plan") — this document
stops at *requirements*, not a phased implementation plan, task breakdown, or effort sizing. Once
the open questions in Section 11 are resolved, the next step is a `/plan` session scoping Phase 1
specifically (Phase 2 depends on Phase 1's logging/schema being in place first, per the user's own
stated sequencing).

---

## 13. Backlog — Additional Candlestick Patterns (2026-09-28) — ✅ Fully Closed 2026-10-03

Built independently of this document's own Phase 1/2 (the LLM Ask feature) — a curated,
deterministic pattern-detection system now exists: chart-side detection/badges plus matching
curated Q&A content and diagrams, organized into complexity tiers by candle count (`m_candlestick
_pattern.complexity_tier`, migrations 050/051/053, no further migration needed for the 4th tier —
see `CLAUDE.md`'s own build-log entry): **Simple** (1 candle, 10 patterns), **Composite** (2
candles, 10 patterns — renamed from "Complex" 2026-09-28), **Advanced** (3 candles, 12 patterns),
**Complex** (5 candles, 2 patterns — added 2026-10-03, reusing the name vacated by the Composite
rename). None of this existed when Sections 1-11 above were written; see `CLAUDE.md`'s own
build-log entries for what actually shipped and when.

This section was a running list of additional, real, commonly-taught candlestick patterns
identified in conversation — parked here per the same document-before-build precedent Section 9.4
already established for the spend-control gate. **Every item below has since been built, seeded,
and live-verified against real market data; none remain outstanding.** Kept here as a historical
record of what was identified and in what order it was picked up, not as an active backlog.

### Composite (2-candle)

- **Tweezer Bottom / Tweezer Top** — ✅ Done, 2026-09-28: a bullish/bearish reversal pair: two
  candles sharing a virtually identical low (Bottom) or high (Top), reading as a specific price
  level tested and defended twice in a row. Fully built (detection, badges `Tb`/`Tt`, diagrams,
  tests) and seeded live — see `CLAUDE.md`'s own build-log entry. No longer part of this backlog.
- **Kicking (Bullish) / Kicking (Bearish)** — ✅ Done, 2026-09-29: two Marubozu candles (full-body,
  no wicks) with a genuine price gap between them and zero overlap at all. Fully built (detection,
  badges `K+`/`K-`, diagrams, tests) and seeded live — see `CLAUDE.md`'s own build-log entry. No
  longer part of this backlog.

### Advanced (3-candle)

- **Bullish Abandoned Baby / Bearish Abandoned Baby** — ✅ Done, 2026-09-29: the stricter, rarer
  sibling of Morning/Evening Star, requiring genuine price gaps on **both** sides of the small
  middle candle (a true "island reversal"). Fully built (detection, badges `A+`/`A-`, diagrams,
  tests) and seeded live — see `CLAUDE.md`'s own build-log entry. No longer part of this backlog.
- **Upside Tasuki Gap / Downside Tasuki Gap** — ✅ Done, 2026-10-03: a 3-candle **continuation**
  pattern (not a reversal, unlike everything else in this tier) - a trend candle, a second candle
  gapping further in the same direction, then a third candle that partially closes that gap
  without fully filling it. Fully built (detection, badges `Gu`/`Gd`, diagrams, tests) and seeded
  live — see `CLAUDE.md`'s own build-log entry. No longer part of this backlog.

### Complex (5-candle)

- **Rising Three Methods / Falling Three Methods** — ✅ Done, 2026-10-03: a strong trend candle,
  three small consolidating candles that stay within the first candle's own high/low range, then a
  fifth candle continuing the original trend past the first candle's own close. The concrete
  example that justified adding the whole 4th "Complex" tier (schema confirmed to need no
  migration, chart UI 4th picker/panel, Pattern Q&A Complexity filter) - fully built (detection,
  badges `Rm`/`Fm`, diagrams, tests) and seeded live — see `CLAUDE.md`'s own build-log entry. No
  longer part of this backlog. This was the last remaining item in this entire section.

## 14. Deterministic-First Resolution Cascade + Question Popularity Cache (2026-10-05) — ✅ Done

Phase 1 (2026-10-04/05, see `CLAUDE.md`'s own build-log entry) gave the existing Ask ReAct loop a
second tool, `filter_patterns_by_metadata`, so the model could answer structural questions without
guessing from an `ILIKE` substring search alone. This section is the next evolution, discussed and
approved 2026-10-05: **try to answer deterministically — from a cache, then from templates — before
ever calling the LLM at all**, with the LLM reserved for roles explicitly permitted to use it and
questions neither cheaper path can resolve.

### 14.1 RBAC

- New permission `candlestick_question_answer:llm_calling`, a **child** of
  `candlestick_question_answer:ask` — same parent/child enforcement already built for
  `contrarian_finder:scan_history`/`scan` (§6 above describes the existing single-permission gate;
  this adds a second, narrower one underneath it). A role with `ask` + `llm_calling` gets the full
  ReAct/LLM loop; a role with `ask` alone gets the cache + template path only, never the LLM.
- **Decided**: the migration granting this permission explicitly grants `llm_calling` to every role
  that currently holds `ask`, preserving today's behavior for everyone at rollout — same precedent
  as `portfolio_upload:legacy`'s own default grant when that gate was introduced.

### 14.2 New table — `m_candlestick_asked_question`

- Columns: `question_text`, `normalized_question_text`, `horizon`, `answer_text`,
  `matched_pattern_names` (JSONB), `question_status` (`'Answered'` \| `'Unable_To_Answer'`),
  `question_asked_count`, `last_asked_at`, `created_at`.
- Unique on `(normalized_question_text, horizon)` — scoped per horizon, decided 2026-10-05 (the
  same question under a different horizon may legitimately deserve a different cached answer,
  since the curated content itself is horizon-scoped).
- `UPSERT` on every ask: first time → insert (`question_asked_count = 1`); a repeat hit on the same
  key → increment the count and `last_asked_at`, but **never regenerate `answer_text`** — the first
  stored answer always wins, decided 2026-10-05.
- Only `'Answered'` rows are eligible for the public "Top 100 Questions" list (§14.5); `'Unable_To
  _Answer'` rows exist for admin gap-analysis only, same purpose the old log's indefinite retention
  was originally built for (§9/§13's own cross-references), now served by this table instead.
- Reuses the existing `m_candlestick_question_answer_entry.source_question_answer_log_id` pointer
  (already present in the schema, previously anticipating exactly this) as the future promotion
  path — an admin reviewing a popular cached answer can turn it into real curated content.

### 14.3 Resolution cascade (replaces today's single "always call the LLM" path)

1. **Cache check** — normalized question + horizon matches an existing `m_candlestick_asked
   _question` row → serve its `answer_text` directly, increment the count. No LLM, no template
   logic reached at all.
2. **No cache hit** → check the caller's `llm_calling` permission:
   - **Granted** → run the existing Phase 1 ReAct loop unchanged (`filter_patterns_by_metadata` +
     `search_question_answer_entries`, `candlestickQuestionAnswerAsk.service.ts`). On success, write
     a new `'Answered'` cache row. On `unable_to_answer`, write an `'Unable_To_Answer'` row (no
     `answer_text`).
   - **Not granted** → attempt the DB-stored question templates (§14.4). A confident match answers
     directly via `filterPatternsByMetadata()` and caches the result the same way, at zero LLM cost.
     No match → `unable_to_answer`, logged the same way as the LLM path's own failure case.

### 14.4 New table — `m_question_template`

- Columns: `template_key`, `regex_pattern`, `filter_mapping` (JSONB), `answer_template` (TEXT),
  `status`, `created_at`/`updated_at`.
- A small, hand-curated set of recognized question *shapes* (e.g. "Is `<pattern>` bullish or
  bearish?", "What's the opposite of `<pattern>`?", "Which patterns are `<signal_type>` signals?"),
  not a general free-text parser — deliberately narrow so a non-match always falls through rather
  than risking a confidently-wrong deterministic answer (there is no LLM-equivalent sufficiency
  judgment on this path).
- Admin-manageable via a new Admin Console screen (same pattern as the existing Candlestick Q&A
  content-management screen, §6) — new phrasings/templates addable without a code deploy.

### 14.5 Rate limiting — narrowed in scope, not dropped

- `user_evt_candlestick_question_answer_log` (§9's original design) is **not** replaced by the new
  cache table — a cache hit has no single user to rate-limit against once two different users share
  the same cached question, so a per-user, per-event, timestamped trail still has to exist somewhere.
  Decided 2026-10-05: shrink this table to just `(user_id, created_at)`, the minimum the existing
  rolling-window check in `candlestickQuestionAnswerRateLimit.service.ts` needs.
- **Only the LLM path (cascade step 2, `llm_calling` granted) writes a row here now** — a cache hit
  or a template-only resolution costs nothing real and must not consume a user's rate-limit budget,
  a genuine behavior change from today (where every ask, including `unable_to_answer`, counted a
  real LLM call and was rate-limited the same way).
- Since gap-analysis moves to `m_candlestick_asked_question` (which has no TTL, same as the
  original log's own rationale), this slimmed table no longer needs indefinite retention — a short
  TTL is appropriate now that its only job is the rolling rate-limit window.

### 14.6 Frontend (sequencing TBD, backend lands first either way)

- Surface the "Top 100 Questions" (`'Answered'` rows from `m_candlestick_asked_question`, ranked by
  `question_asked_count`) as a clickable, pre-built list on the Pattern Q&A page — the original
  motivating idea for this whole section.

**Status: requirements approved by the user 2026-10-05, not yet planned or built.** Next step is a
formal `/plan` pass before any code changes, per this project's own standing convention for a
phase of this size.
