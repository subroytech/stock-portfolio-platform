# Self-Directed Retail Investor Platform — Requirements & Gap Analysis

**Date:** 2026-09-19
**Lens:** `Architecture.md`'s new "Platform Objective" section — *"a self-directed stock investing
platform for retail investors."*
**Purpose of this document:** take that objective seriously as a product lens (not just a technical
one) and ask: for someone who manages their own equity portfolio, what does a platform genuinely
need — and where does what's actually built today (per `Architecture.md` Section 1) stand against
that? This is a gap analysis and a prioritized requirements list, not a rebuild plan — most of what
follows is *additive* to what already exists.

---

## 1. A scope question this document had to answer before anything else

"Self-directed investing platform" can mean two very different things:

| Interpretation | What it implies |
|---|---|
| **(A) A brokerage** | The platform itself routes/executes trades, holds custody of securities, does KYC/AML, and is a regulated broker-dealer. |
| **(B) A decision-support / portfolio-management companion** | The user executes trades at a real brokerage elsewhere; this platform tracks the resulting portfolio, and helps them research, screen, and decide. |

**Everything actually built today is unambiguously (B), not (A)**: Portfolio Upload (Legacy and
Flex) exists specifically to *import* a CSV/Excel export from Fidelity/Schwab/Robinhood/Empower —
i.e., the trade already happened somewhere else. There is no order-entry screen, no connection to
any brokerage's trading API, no concept of "buying power" or settlement, and no KYC/AML/broker-
dealer registration groundwork anywhere in the codebase or docs. `Architecture.md`'s own Platform
Objective note explicitly says *"it never executes a trade."*

**This document proceeds entirely under interpretation (B)**, and everything below is scoped
accordingly. Interpretation (A) is not analyzed here at all — it's a categorically different
undertaking (regulatory licensing, custody, clearing/settlement infrastructure) that would need its
own dedicated discussion if it's ever actually the intent. **This is Open Question #1 below —
confirm the interpretation before treating the rest of this document as settled.**

---

## 2. Target user

A retail investor who:
- Already holds (or is opening) brokerage account(s) elsewhere and executes their own trades there.
- Wants one place to see their *combined* real portfolio (not a demo/model one), understand its
  composition, and get research/screening help deciding what to do next.
- Is not a licensed professional and is not being advised by one *through this platform* — every
  score/signal is decision-support, never a recommendation to act (already the explicit framing on
  Long-Term Analysis/Contrarian Comeback, and now the platform-wide posture per the Platform
  Objective note).

---

## 3. Capability framework — current state vs. gap, by pillar

Each pillar: what a self-directed retail investor platform needs it to do, what's actually built
today (cited against `Architecture.md`'s own accomplished list), and the resulting gap/priority.

### 3.1 Account Onboarding & Access Model

**Need:** a new retail user can sign up and start getting value quickly, with sensible free-tier
defaults, no human in the loop.

**Current state:** Self-Registration exists (`SignupPage.tsx`, password policy, security-question
recovery) — but every new account is created `status: 'pending'` with **no role assigned at all**,
and stays functionally locked out (sees only a "Thanks for registering, under review" page) until
an `admin` manually assigns a role via Manage Users. RBAC is rich (5 roles: `user`, `user-premium`,
`admin`, `admin-master`, plus 2 contrarian-scan-specific roles) but every one of them is
admin-provisioned, not self-selected.

**Gap — Critical, and the single biggest structural tension in this whole analysis:** this is a
*controlled-rollout / internal-beta* onboarding model, not a public retail self-serve one. A real
retail user signing up today gets stuck on a waiting screen indefinitely unless someone with admin
access notices and acts. If the near-term goal is genuinely "retail investors" (plural, public,
unknown to the operator ahead of time), this has to become a real self-serve flow: sign up → land
in a default free role immediately → optionally request/pay for an upgraded tier later. See Open
Question #2 — this may be entirely intentional for a controlled pilot phase, in which case it's not
a "gap" yet, just a known limitation to lift later.

### 3.2 Portfolio Tracking, Import & Multi-Device Sync

**Need:** the user's *actual* holdings, kept current, from wherever they're custodied, on any
device.

**Current state:** Strong. Multi-portfolio CRUD, two import paths (Legacy header-alias parsing;
Flex's admin-governed, template-based mapping wizard for any CSV/XLS shape), buy/sell action
history derived from re-imports, Refresh Prices, DB-backed (CockroachDB, not `localStorage`) so it
already syncs across devices/sessions by design.

**Gap — Medium:** import is always a *manual, user-initiated* file upload. There's no standing
connection to a brokerage (e.g., a Plaid-style read-only account link) that keeps a portfolio
current automatically — a real retail user has to remember to re-export and re-upload. Not urgent
(explicitly out of scope so far, no prior discussion of it), but worth naming as the natural next
step once the import mechanics above are solid, which they now are.

### 3.3 Market Data & Quotes

**Need:** timely, accurate pricing without the user needing to think about where it comes from.

**Current state:** FMP (equities) + partial Finnhub (news) integration, market-hours-aware
real-time-vs-cached hybrid, a shared day-cache (`m_fmp_daily_cache`) that already cross-benefits
every feature that touches the same symbol same day.

**Gap — Low.** This pillar is in good shape for the current single-market (US equities) scope.
Genuine gaps are scope questions, not defects: no international/multi-currency listings, no
options/futures/crypto beyond the two BTC/ETH tickers already special-cased in Refresh Prices.

### 3.4 Research, Screening & Scoring Tools

**Need:** ways to *find* candidate ideas and *evaluate* a specific one, without needing a licensed
advisor's input.

**Current state:** Genuinely the platform's strongest pillar today — Momentum Analysis (5-factor
score + Kelly sizing), Contrarian Finder (universe screener across ~458 symbols with
threshold/window/quality controls, shared run history), Long-Term Analysis (fundamentals + Forward
P/E + EV/EBITDA + peer comps + news), Contrarian Comeback (a full staged-entry/recovery-target/
thesis-invalidation workflow). This is a materially more sophisticated toolset than most retail
brokerages' own free research tabs.

**Gap — Low for breadth, Medium for one specific thing:** none of these tools produce a
**persistent, revisitable "idea" or "thesis" record** the user can track over time and see whether
it played out — each run's output is a point-in-time result (Contrarian Finder is the one exception,
via Run History). A retail investor's actual workflow is "I found this idea three weeks ago — did
my thesis hold up?" — nothing here currently answers that across features.

### 3.5 Charting & Technical Analysis

**Need:** the visual/technical side of deciding entry/exit timing.

**Current state:** Strong and recently built out — Candlestick Charts across 6 timeframes, 11
indicators (SMA/EMA/RSI/MACD/BB/VWAP/Pivot Points/Fibonacci/Volume MA/OBV), gap-free index-based
x-axis, self-healing cache.

**Gap — Low.** This pillar is comprehensively built for a single-symbol view. The one real gap:
no way to overlay/compare two symbols on one chart (e.g., a stock vs. its sector ETF), which is a
common retail research pattern (relative strength).

### 3.6 Risk & Position-Sizing Guidance

**Need:** help deciding *how much* to buy, not just *what*, given the user's own risk tolerance.

**Current state:** Kelly-criterion position sizing exists but only inside Momentum Analysis
(`kelly.ts`, client-side), scoped to that one page's score. Contrarian Comeback has its own staged-
entry sizing concept, independent of Momentum's.

**Gap — Medium.** There's no platform-wide, portfolio-aware risk view — e.g., "given your current
concentration in Tech (see 3.7), how much of your remaining buying power should this new idea use."
Position sizing today is per-feature and stateless, never informed by the user's actual existing
portfolio.

### 3.7 Diversification / Allocation Insight

**Need:** understanding concentration risk across the *whole* portfolio, not one symbol at a time.

**Current state:** `AllocationChart`/sector data exist on the Dashboard (KPI cards, allocation pie).

**Gap — Medium.** This is presentational, not advisory — it shows the current allocation but
doesn't flag anything (e.g., "you're 40% concentrated in one sector," "your top 3 holdings are
62% of the portfolio"). A self-directed investor benefits most from concentration/risk being
surfaced *proactively*, not just charted passively.

### 3.8 Tax & Cost-Basis Tracking

**Need:** cost basis, realized vs. unrealized gains, and tax-relevant events (a top-3 concern for
any real retail investor managing their own portfolio outside a robo-advisor).

**Current state:** `tx_portfolio_action_hist` records buy/sell events (diffed from re-imports), and
Purchase Price is a mapped Flex/Legacy import field — but there is **no realized/unrealized
gain calculation, no lot-level cost basis (FIFO/LIFO/specific-lot), no wash-sale awareness, and no
tax-document/1099-adjacent reporting anywhere** (confirmed via a direct code search — no `tax`,
`cost basis`, `realized gain`, or `wash sale` logic exists outside a CSV-header-alias string and an
unrelated UI label).

**Gap — High.** This is the most consequential *feature* gap relative to the stated objective: a
genuinely self-directed retail investor manages tax consequences themselves (no advisor doing it
for them), and this platform currently gives them zero help with the single most common
"self-directed and paying the price for it" pain point.

### 3.9 Watchlists, Alerts & Notifications

**Need:** track symbols of interest without owning them yet, and get proactively notified when
something changes (price threshold crossed, a scan result changed, a portfolio holding moved
sharply) — retail investors do not sit staring at the dashboard all day.

**Current state:** **None exists.** Confirmed via direct search (`watchlist`, `alert`,
`notification`) — the only match anywhere in the frontend is an unrelated identifier in a test
file. The closest analog is Contrarian Finder's shared Run History, which is a *screen* result
list, not a persistent watchlist a user curates themselves, and there is no push/email/in-app
notification mechanism of any kind (correctly out of scope until now — no email provider exists in
this repo at all, a deliberate choice already documented for Forgot Password).

**Gap — High.** This is the platform's biggest *behavioral* gap: everything today is pull-based
(the user must open the app and run something). A self-directed investor's real workflow depends
on push-based signals. This doesn't require solving "send email" first — an in-app-only
watchlist + badge/indicator (the same pattern already established for the Rate Limit
indicator and Support ticket unread badge) would deliver most of the value with zero new
infrastructure.

### 3.10 News, Sentiment & Education

**Need:** context for *why* a stock is moving, and enough plain-language explanation that a
non-professional can actually use the scores/signals correctly.

**Current state:** Finnhub company news is pulled into Long-Term Analysis already. Some inline
help exists (Momentum's hover-tooltip precedent from the source app), and Contrarian Comeback's
UI has "context-aware tooltips."

**Gap — Medium.** News is feature-scoped (Long-Term Analysis only), not a first-class, cross-
platform surface (e.g., a news feed tied to the user's actual holdings/watchlist). Education is
present but inconsistent — no dedicated "how do I read this score" reference that's consistent
across Momentum/Contrarian Finder/Contrarian Comeback/Long-Term Analysis's four independently-
designed scoring systems.

### 3.11 Compliance, Disclosures & Trust

**Need:** a retail-facing financial tool needs to be unambiguous, everywhere, about what it is and
isn't — this is both a legal-exposure question and a trust one.

**Current state:** Exactly one disclaimer sentence exists platform-wide (Long-Term Analysis's
"Conviction ratings ... are not financial advice" footnote). No Terms of Service, no Privacy
Policy, no platform-wide "this is not investment advice / not a broker-dealer / consult a licensed
professional" statement anywhere else — not on Contrarian Finder, Contrarian Comeback, Momentum,
or the Dashboard itself, despite all of them surfacing scores/signals a user could act on.

**Gap — High**, and low-effort to close relative to its importance: this is a documentation/UI-copy
task, not a new subsystem. `Architecture.md`'s new Platform Objective note already states the
platform-wide posture explicitly — the actual product surface should say it too, everywhere a
score or signal is shown, not just on one page.

### 3.12 Cost Model / Monetization

**Need:** the retail user should be able to actually get value on day one without separately
becoming a paying customer of a data vendor they've never heard of.

**Current state:** Bring-your-own-key (Option A, decided Phase 2) — every user must independently
obtain and pay for their own FMP (and optionally Finnhub) API key and paste it into the app before
almost any feature works. The Admin-Master Fallback API Key model (certain roles can fall back to
a shared key) partially offsets this, but it's an admin-configured exception, not the default
consumer path.

**Gap — Critical, the second major structural tension**: for an internal/beta user base this is a
reasonable, deliberately cost-conscious decision (documented and confirmed at the time). For a
genuine public "retail investor platform," requiring a stranger to sign up for a third-party
financial-data API key before they can use anything is a severe first-use barrier that most retail
users will simply not clear. This is tightly coupled to Open Question #2 below — the fix (the
platform absorbing/pooling data costs itself, likely funding it via the very tiering the RBAC
system already half-supports) is a monetization/business decision, not a small code change.

### 3.13 Security & Privacy

**Need:** the user's financial data (holdings, cost basis, API keys) genuinely protected.

**Current state:** Strong — bcrypt+JWT/httpOnly cookies, AES-256-GCM encrypted API keys (never
returned in plaintext), audited impersonation (`user_evt_impersonation_log`), a self-healing
401 session model, security-question-based account recovery, a 7-rule password policy with
history-reuse prevention.

**Gap — Low.** This pillar is genuinely ahead of most early-stage products of this kind. The one
open item is scope, not weakness: no documented data-retention/deletion policy for a user who
wants their account and financial data fully erased (a real expectation for a financial-adjacent
product, and increasingly a legal one depending on jurisdiction).

---

## 4. Prioritized new requirements (candidate backlog additions)

In rough priority order, assuming Open Questions 1–2 below resolve as "yes, this is meant to serve
external retail investors, not just an internal pilot":

| # | Requirement | Pillar | Priority |
|---|---|---|---|
| 1 | Platform-wide "not financial advice / not a broker-dealer" disclosure, surfaced on every scoring/signal page, plus a real Terms of Service + Privacy Policy | 3.11 | **Critical** |
| 2 | Resolve the BYO-API-key barrier for a public retail tier — either the platform absorbs/pools data cost under a paid tier, or a generous shared/fallback key becomes the *default* for new signups, not an admin-granted exception | 3.12 | **Critical** |
| 3 | Self-serve onboarding — a new signup lands in a working (if limited) default role immediately, no admin action required to start using the app | 3.1 | **Critical** |
| 4 | Realized/unrealized gain tracking with lot-level cost basis (at minimum FIFO), surfaced on the Dashboard and per-holding | 3.8 | **High** |
| 5 | User-curated Watchlist (symbols not yet owned) + in-app alert badges for price/threshold/scan-result changes, reusing the existing badge/indicator pattern | 3.9 | **High** |
| 6 | Portfolio-level concentration/risk flags (sector/position concentration thresholds), not just charts | 3.7 | **Medium** |
| 7 | A persistent "idea/thesis" record per symbol the user can revisit later, across every research tool (not just Contrarian Finder's own Run History) | 3.4 | **Medium** |
| 8 | A single, consistent "how to read this score" reference spanning all 4 scoring systems | 3.10 | **Medium** |
| 9 | Two-symbol comparison overlay on Candlestick Charts (e.g., stock vs. sector ETF) | 3.5 | **Low** |
| 10 | Documented account/data deletion policy and a real user-initiated "delete my account and data" flow | 3.13 | **Low** |
| 11 | Read-only brokerage account linking (e.g., Plaid) to remove the manual re-upload step | 3.2 | **Low** (bigger lift, revisit after the above) |

Items 1–3 are flagged Critical specifically *because* they gate whether "retail investor" (as
opposed to "internal pilot user") is actually true today — everything else is real, incremental
product value on top of an already-solid research/tracking core.

---

## 5. Open questions — need your decision before this becomes an actionable backlog

1. **Confirm the scope interpretation from Section 1**: is "self-directed stock investing
   platform" meant as (B) research/portfolio-tracking companion (what's built today), or is there
   any intent, now or later, toward (A) actual trade execution/brokerage functionality? These are
   different products with different regulatory realities — worth settling explicitly, once, even
   if the answer is simply "(B), always was."
2. **Who is the platform actually for, right now?** An internal pilot/beta with an operator who
   personally provisions each account (today's reality — admin-gated onboarding, BYO API keys), or
   a public product meant for retail investors who've never met the operator? If it's still
   deliberately the former for now, items 1–3 above are not urgent gaps — they're correct-for-stage
   decisions, and this document's priority ranking should be read with that caveat. If the latter
   is the near-term goal, items 1–3 become the actual next phase of work, ahead of new features.
3. Should tax/cost-basis tracking (item 4) assume US tax rules specifically, or stay
   jurisdiction-agnostic (raw realized/unrealized numbers, no tax-law-specific treatment like wash
   sales)? This materially changes its scope.
4. For Watchlists/Alerts (item 5): in-app only (no new infrastructure, fast), or is email/push
   notification worth the new infrastructure it requires (this repo currently has zero email
   capability by deliberate prior choice)?
