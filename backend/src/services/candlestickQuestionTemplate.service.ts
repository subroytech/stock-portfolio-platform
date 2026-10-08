// Candlestick Pattern Q&A - deterministic question templates, Phase 2 (2026-10-05). The last
// deterministic step in the resolution cascade for a role WITHOUT candlestick_question_answer
// :llm_calling - a small, hand-curated set of recognized question SHAPES (not a general free-text
// parser), each resolved via the exact same filterPatternsByMetadata() Phase 1 already built.
// Deliberately narrow: there is no LLM-equivalent sufficiency judgment on this path, so a regex
// match is itself the only confidence signal available - a question that matches no template
// simply falls through to 'unable_to_answer' in the controller, never a guess.

import { pool } from '../db/pool';
import * as candlestickQuestionAnswer from './candlestickQuestionAnswer.service';
import type { PatternMetadataMatch } from './candlestickQuestionAnswer.service';

export type ResponseMode = 'single' | 'list';

export interface QuestionTemplate {
  id: string;
  templateKey: string;
  regexPattern: string;
  responseMode: ResponseMode;
  filterMapping: { fixedFilters: Record<string, string | boolean>; groupFilters: Record<string, string> };
  answerTemplate: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface TemplateMatchResult {
  matches: PatternMetadataMatch[];
  responseMode: ResponseMode;
  answerTemplate: string;
}

export class DuplicateTemplateKeyError extends Error {}

function toTemplate(row: {
  id: string; template_key: string; regex_pattern: string; response_mode: string;
  filter_mapping: { fixedFilters: Record<string, string | boolean>; groupFilters: Record<string, string> };
  answer_template: string; status: string; created_at: string; updated_at: string;
}): QuestionTemplate {
  return {
    id: row.id,
    templateKey: row.template_key,
    regexPattern: row.regex_pattern,
    responseMode: row.response_mode as ResponseMode,
    filterMapping: row.filter_mapping,
    answerTemplate: row.answer_template,
    status: row.status as 'active' | 'inactive',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTemplates(): Promise<QuestionTemplate[]> {
  const { rows } = await pool.query('SELECT * FROM m_question_template ORDER BY id');
  return rows.map(toTemplate);
}

const UNIQUE_VIOLATION = '23505';

export async function createTemplate(input: {
  templateKey: string; regexPattern: string; responseMode: ResponseMode;
  filterMapping: QuestionTemplate['filterMapping']; answerTemplate: string;
}): Promise<QuestionTemplate> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO m_question_template (template_key, regex_pattern, response_mode, filter_mapping, answer_template)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.templateKey, input.regexPattern, input.responseMode, JSON.stringify(input.filterMapping), input.answerTemplate],
    );
    return toTemplate(rows[0]);
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
      throw new DuplicateTemplateKeyError(`A template keyed "${input.templateKey}" already exists.`);
    }
    throw err;
  }
}

export async function setTemplateStatus(id: string, status: 'active' | 'inactive'): Promise<void> {
  await pool.query('UPDATE m_question_template SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
}

// Iterates active templates in order; on the first regex match (case-insensitive), resolves its
// filter_mapping into a filterPatternsByMetadata() call and returns the result - even if that
// result is an empty match list (a shape match whose extracted values didn't resolve to a real
// pattern, e.g. a misspelled name). Returns null only when NO template's regex matched the
// question at all. The caller (askQuestion) treats either an empty-matches result or a null
// result as 'unable_to_answer' - there's no further deterministic fallback once templates are
// the last resort for a role.
export async function matchTemplate(question: string): Promise<TemplateMatchResult | null> {
  const templates = await pool.query<{
    id: string; regex_pattern: string; response_mode: string;
    filter_mapping: { fixedFilters: Record<string, string | boolean>; groupFilters: Record<string, string> };
    answer_template: string;
  }>(`SELECT id, regex_pattern, response_mode, filter_mapping, answer_template FROM m_question_template WHERE status = 'active' ORDER BY id`);

  for (const template of templates.rows) {
    const regex = new RegExp(template.regex_pattern, 'i');
    const execResult = regex.exec(question);
    if (!execResult) continue;

    // Dynamically built from DB-stored field names (admin-authored, not end-user input) - a
    // typo'd field name here is simply ignored by filterPatternsByMetadata's own named
    // parameters, not a security concern, just a silently-ineffective template worth fixing in
    // the Admin Console if it ever under-matches.
    const filters: Record<string, unknown> = { ...template.filter_mapping.fixedFilters };
    for (const [groupIndexStr, fieldName] of Object.entries(template.filter_mapping.groupFilters)) {
      const value = execResult[Number(groupIndexStr)];
      if (value !== undefined) filters[fieldName] = value.trim();
    }

    let matches = await candlestickQuestionAnswer.filterPatternsByMetadata(
      filters as Parameters<typeof candlestickQuestionAnswer.filterPatternsByMetadata>[0],
    );

    // Real bug found live: patternNameOrSynonym matches via ILIKE '%...%' (correct for the LLM
    // tool's own fuzzy search), so a name that's a substring of another pattern's name - e.g.
    // "Doji" inside "Doji-Dragonfly"/"Doji-Gravestone"/"Doji-LongLegged" - returns multiple rows
    // and silently fails 'single' mode's exactly-one-match requirement. Narrow to an exact
    // case-insensitive name/synonym match when the raw extracted text names one unambiguously,
    // rather than giving up just because the substring search was too broad. Only applies to
    // 'single' mode - 'list' mode's whole point is returning every match, so an ambiguous
    // substring there is still meaningful, not a defect.
    if (template.response_mode === 'single' && matches.length > 1 && typeof filters.patternNameOrSynonym === 'string') {
      const needle = filters.patternNameOrSynonym.toLowerCase();
      const exact = matches.filter((m) => m.patternName.toLowerCase() === needle);
      if (exact.length === 1) matches = exact;
    }

    return { matches, responseMode: template.response_mode as ResponseMode, answerTemplate: template.answer_template };
  }
  return null;
}

function buildPlaceholders(match: PatternMetadataMatch): Record<string, string> {
  return {
    patternName: match.patternName,
    complexityTier: match.complexityTier,
    signalType: match.signalType,
    directionalBias: match.directionalBias,
    trendContext: match.trendContext,
    mirrorPatternName: match.mirrorPatternName ?? 'none',
    requiresGapText: match.requiresGap ? 'does' : 'does not',
  };
}

function fillTemplate(template: string, placeholders: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (full, key: string) => placeholders[key] ?? full);
}

// Returns null when there's nothing meaningful to format: 'single' mode needs exactly one match
// (zero means nothing resolved; more than one means the template's own filters were too broad for
// a "lookup" shape, both treated the same as a miss), 'list' mode needs at least one.
export function formatTemplateAnswer(result: TemplateMatchResult): string | null {
  if (result.responseMode === 'single') {
    if (result.matches.length !== 1) return null;
    return fillTemplate(result.answerTemplate, buildPlaceholders(result.matches[0]));
  }
  if (result.matches.length === 0) return null;
  const placeholders = {
    ...buildPlaceholders(result.matches[0]),
    patternNameList: result.matches.map((m) => m.patternName).join(', '),
  };
  return fillTemplate(result.answerTemplate, placeholders);
}
