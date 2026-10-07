// Candlestick Pattern Q&A (Phase 1) - plain DB access, no LLM involved anywhere in this file.
// See migration 047 for the full schema rationale.

import { pool } from '../db/pool';

// Matches frontend/src/lib/candlestickIndicators.ts's HorizonId exactly, by convention (no
// shared-schema codegen in this repo - same "keep in sync by hand" precedent as
// analysisService.ts's own field-for-field comment).
export type Horizon = 'dayTrading' | 'mediumTerm' | 'longTerm';
export type Tier = 101 | 201 | 301;
export type EntryStatus = 'Pending Approval' | 'Approved' | 'Rejected';
// Fixed, difficulty-ordered sequence (2026-09-26) - Definition/Interpretation are tier 101;
// Reliability/How to Use/Common Mistakes are tier 201. Tier 301 is deliberately reserved for a
// later, different kind of content (combining multiple patterns into one interpretation), not
// this axis.
export type Category = 'Definition' | 'Interpretation' | 'Reliability' | 'How to Use' | 'Common Mistakes';
// How many candles you have to read to identify the pattern (migration 050): Simple = 1,
// Composite = 2, Advanced = 3, Complex = 5 (2026-10-03). A structural property of the pattern
// itself, deliberately unrelated to Tier above (which is about content depth within a single
// pattern's Q&A). "Composite" was renamed from 'Complex' 2026-09-28 (migration 053) - "Composite"
// better describes what those 2-candle patterns actually are (a smaller candle's geometry composed
// against a larger one) than "Complex" did; this 4th tier reuses the now-vacated "Complex" name
// for genuinely 5-candle patterns (e.g. Rising/Falling Three Methods). No DDL change was needed to
// add this value - complexity_tier is VARCHAR(10) with no DB-level CHECK constraint, validated
// entirely application-side (here and in the controller's VALID_COMPLEXITY_TIERS), and 'Complex'
// (7 chars) already fits the existing column width.
export type ComplexityTier = 'Simple' | 'Composite' | 'Advanced' | 'Complex';
export const COMPLEXITY_TIERS: ComplexityTier[] = ['Simple', 'Composite', 'Advanced', 'Complex'];

// Maps a Horizon to the boolean column on m_candlestick_pattern that stores it (migration 048) -
// safe to interpolate directly into SQL since callers only ever pass a Horizon already validated
// by the controller's parseHorizon(), never raw user input.
const HORIZON_COLUMN: Record<Horizon, string> = {
  dayTrading: 'is_day_trading', mediumTerm: 'is_medium_term', longTerm: 'is_long_term',
};

const UNIQUE_VIOLATION = '23505';

export class DuplicatePatternNameError extends Error {}
export class PatternNotFoundError extends Error {}
export class EntryNotFoundError extends Error {}
export class NoFilterCriteriaError extends Error {}

export type SignalType = 'reversal' | 'continuation' | 'indecision';
export type DirectionalBias = 'bullish' | 'bearish' | 'neutral' | 'context-dependent';
export type TrendContext = 'prior-downtrend' | 'prior-uptrend' | 'either' | 'none';

export interface Pattern {
  id: string;
  patternName: string;
  formationDescription: string;
  status: 'active' | 'inactive';
  // Application-level shape stays a plain array regardless of how it's stored (3 booleans,
  // migration 048) - nothing above this file's mappers ever deals with the boolean columns
  // directly.
  relevantHorizons: Horizon[];
  complexityTier: ComplexityTier;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionAnswerEntry {
  id: string;
  patternId: string;
  patternName: string;
  // Denormalized from the entry's own pattern (ENTRY_SELECT already joins m_candlestick_pattern
  // for pattern_name) so the Q&A browse UI can filter by complexity without a second fetch.
  complexityTier: ComplexityTier;
  category: Category;
  tier: Tier;
  questionText: string;
  answerText: string;
  status: EntryStatus;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPattern(row: {
  id: string; pattern_name: string; formation_description: string; status: string;
  is_day_trading: boolean; is_medium_term: boolean; is_long_term: boolean; complexity_tier: string;
  created_at: string; updated_at: string;
}): Pattern {
  const relevantHorizons: Horizon[] = [
    ...(row.is_day_trading ? (['dayTrading'] as const) : []),
    ...(row.is_medium_term ? (['mediumTerm'] as const) : []),
    ...(row.is_long_term ? (['longTerm'] as const) : []),
  ];
  return {
    id: row.id,
    patternName: row.pattern_name,
    formationDescription: row.formation_description,
    status: row.status as 'active' | 'inactive',
    relevantHorizons,
    complexityTier: row.complexity_tier as ComplexityTier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ENTRY_SELECT = `
  SELECT e.id, e.pattern_id, p.pattern_name, p.complexity_tier, e.category, e.tier, e.question_text,
         e.answer_text, e.status, e.created_by, e.reviewed_by, e.reviewed_at, e.created_at, e.updated_at
  FROM m_candlestick_question_answer_entry e
  JOIN m_candlestick_pattern p ON p.id = e.pattern_id
`;

function toEntry(row: {
  id: string; pattern_id: string; pattern_name: string; complexity_tier: string; category: string;
  tier: number; question_text: string;
  answer_text: string; status: string; created_by: string | null; reviewed_by: string | null;
  reviewed_at: string | null; created_at: string; updated_at: string;
}): QuestionAnswerEntry {
  return {
    id: row.id,
    patternId: row.pattern_id,
    patternName: row.pattern_name,
    complexityTier: row.complexity_tier as ComplexityTier,
    category: row.category as Category,
    tier: row.tier as Tier,
    questionText: row.question_text,
    answerText: row.answer_text,
    status: row.status as EntryStatus,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPatterns(): Promise<Pattern[]> {
  const { rows } = await pool.query('SELECT * FROM m_candlestick_pattern ORDER BY pattern_name');
  return rows.map(toPattern);
}

export async function createPattern(input: {
  patternName: string; formationDescription: string; relevantHorizons: Horizon[];
  complexityTier: ComplexityTier;
}): Promise<Pattern> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO m_candlestick_pattern (pattern_name, formation_description, is_day_trading, is_medium_term, is_long_term, complexity_tier)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        input.patternName, input.formationDescription,
        input.relevantHorizons.includes('dayTrading'),
        input.relevantHorizons.includes('mediumTerm'),
        input.relevantHorizons.includes('longTerm'),
        input.complexityTier,
      ],
    );
    return toPattern(rows[0]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new DuplicatePatternNameError(`A pattern named "${input.patternName}" already exists.`);
    }
    throw err;
  }
}

// The curated picker's browse/search query AND the LLM's own search_question_answer_entries
// tool call both route through here. `horizon`/`tier`/`query` are all optional filters - the
// browse UI lets a user narrow by any combination, while the LLM tool always supplies `horizon`
// (the ask form's own explicit selector) but may omit `tier`. Only ever returns 'Approved' rows
// - Pending Approval / Rejected content is never visible outside the admin management screen.
//
// horizon is resolved via the PATTERN's own boolean columns (migration 048), not a column on the
// entry itself - HORIZON_COLUMN's value is one of exactly 3 hardcoded strings, safe to interpolate
// directly since opts.horizon is always pre-validated by the controller's parseHorizon().
export async function searchEntries(opts: { query?: string; horizon?: Horizon; tier?: Tier } = {}): Promise<QuestionAnswerEntry[]> {
  const conditions: string[] = [`e.status = 'Approved'`];
  const params: unknown[] = [];

  if (opts.horizon) {
    conditions.push(`p.${HORIZON_COLUMN[opts.horizon]} = true`);
  }
  if (opts.tier) {
    params.push(opts.tier);
    conditions.push(`e.tier = $${params.length}`);
  }
  if (opts.query?.trim()) {
    params.push(`%${opts.query.trim()}%`);
    conditions.push(`(e.question_text ILIKE $${params.length} OR p.pattern_name ILIKE $${params.length})`);
  }

  const { rows } = await pool.query(
    `${ENTRY_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY p.pattern_name, e.tier`,
    params,
  );
  return rows.map(toEntry);
}

// The deterministic, metadata-only sibling of searchEntries() above - backs the Ask loop's
// filter_patterns_by_metadata tool (Phase 1 of the planned ReAct upgrade, 2026-10-05). Returns
// compact structural facts, never curated prose - interpretive questions still belong to
// searchEntries(). Only ever returns 'active' patterns, mirroring searchEntries()'s own
// 'Approved'-only baseline for trusted content.
export interface PatternMetadataMatch {
  patternName: string;
  complexityTier: ComplexityTier;
  signalType: SignalType;
  directionalBias: DirectionalBias;
  requiresGap: boolean;
  trendContext: TrendContext;
  mirrorPatternName: string | null;
}

function toPatternMetadataMatch(row: {
  pattern_name: string; complexity_tier: string; signal_type: string; directional_bias: string;
  requires_gap: boolean; trend_context: string; mirror_pattern_name: string | null;
}): PatternMetadataMatch {
  return {
    patternName: row.pattern_name,
    complexityTier: row.complexity_tier as ComplexityTier,
    signalType: row.signal_type as SignalType,
    directionalBias: row.directional_bias as DirectionalBias,
    requiresGap: row.requires_gap,
    trendContext: row.trend_context as TrendContext,
    mirrorPatternName: row.mirror_pattern_name,
  };
}

// At least one filter is required - deliberately rejected rather than silently returning all 34
// rows, forcing the LLM tool call to be specific. Caught in the Ask loop as a recoverable
// tool-result error (the loop keeps going), never surfaces as an HTTP error.
export async function filterPatternsByMetadata(filters: {
  patternNameOrSynonym?: string;
  signalType?: SignalType;
  directionalBias?: DirectionalBias;
  complexityTier?: ComplexityTier;
  requiresGap?: boolean;
  trendContext?: TrendContext;
  horizon?: Horizon;
} = {}): Promise<PatternMetadataMatch[]> {
  const conditions: string[] = [`p.status = 'active'`];
  const params: unknown[] = [];
  let anyFilterGiven = false;

  if (filters.patternNameOrSynonym?.trim()) {
    anyFilterGiven = true;
    params.push(`%${filters.patternNameOrSynonym.trim()}%`);
    conditions.push(`(p.pattern_name ILIKE $${params.length} OR p.synonyms::text ILIKE $${params.length})`);
  }
  if (filters.signalType) {
    anyFilterGiven = true;
    params.push(filters.signalType);
    conditions.push(`p.signal_type = $${params.length}`);
  }
  if (filters.directionalBias) {
    anyFilterGiven = true;
    params.push(filters.directionalBias);
    conditions.push(`p.directional_bias = $${params.length}`);
  }
  if (filters.complexityTier) {
    anyFilterGiven = true;
    params.push(filters.complexityTier);
    conditions.push(`p.complexity_tier = $${params.length}`);
  }
  if (filters.requiresGap !== undefined) {
    anyFilterGiven = true;
    params.push(filters.requiresGap);
    conditions.push(`p.requires_gap = $${params.length}`);
  }
  if (filters.trendContext) {
    anyFilterGiven = true;
    params.push(filters.trendContext);
    conditions.push(`p.trend_context = $${params.length}`);
  }
  if (filters.horizon) {
    anyFilterGiven = true;
    conditions.push(`p.${HORIZON_COLUMN[filters.horizon]} = true`);
  }

  if (!anyFilterGiven) {
    throw new NoFilterCriteriaError('At least one filter must be given (e.g. signalType, directionalBias, requiresGap).');
  }

  const { rows } = await pool.query(
    `SELECT p.pattern_name, p.complexity_tier, p.signal_type, p.directional_bias, p.requires_gap, p.trend_context,
            mirror.pattern_name AS mirror_pattern_name
     FROM m_candlestick_pattern p
     LEFT JOIN m_candlestick_pattern mirror ON mirror.id = p.mirror_pattern_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.pattern_name`,
    params,
  );
  return rows.map(toPatternMetadataMatch);
}

// Admin content management only - returns entries of every status (not just 'Approved'), so the
// Admin Console screen can show what's pending review too (a Phase 2 concern in practice, since
// Phase 1 itself never creates a Pending Approval row, but the screen is built ready for it).
export async function listAllEntries(): Promise<QuestionAnswerEntry[]> {
  const { rows } = await pool.query(`${ENTRY_SELECT} ORDER BY p.pattern_name, e.tier`);
  return rows.map(toEntry);
}

// Admin-authored entries default to 'Approved' (an admin writing curated content directly is
// already the trusted-content path) - Phase 2's promotion flow will be the first caller to pass
// status: 'Pending Approval' explicitly, reusing this same function rather than a separate one.
export async function createEntry(input: {
  patternId: string; category: Category; tier: Tier; questionText: string; answerText: string;
  createdBy: string; status?: EntryStatus;
}): Promise<QuestionAnswerEntry> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO m_candlestick_question_answer_entry (pattern_id, category, tier, question_text, answer_text, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.patternId, input.category, input.tier, input.questionText, input.answerText, input.status ?? 'Approved', input.createdBy],
  );
  const entry = await getEntryById(rows[0].id);
  return entry!;
}

export async function getEntryById(id: string): Promise<QuestionAnswerEntry | null> {
  const { rows } = await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [id]);
  return rows[0] ? toEntry(rows[0]) : null;
}

// Same "UPDATE ... SET status/reviewed_by/reviewed_at, check rowCount" shape as
// portfolioTemplate.service.ts's own setTemplateStatus().
export async function setEntryStatus(entryId: string, status: 'Approved' | 'Rejected', reviewedBy: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE m_candlestick_question_answer_entry
     SET status = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $3`,
    [status, reviewedBy, entryId],
  );
  if (!rowCount) throw new EntryNotFoundError(`No entry found with id ${entryId}.`);
}

// logQuestionAnswerEvent() was removed 2026-10-05 (Phase 2) - user_evt_candlestick_question
// _answer_log no longer carries question_text/horizon/tier/outcome/matched_entry_id/
// llm_call_details (migration 059 dropped them); gap-analysis and answer-reuse both moved to
// m_candlestick_asked_question (candlestickAskedQuestion.service.ts's recordAskedQuestion()).
// What's left of this table is purely a rate-limit event trail - see
// candlestickQuestionAnswerRateLimit.service.ts's recordRateLimitedCall().
