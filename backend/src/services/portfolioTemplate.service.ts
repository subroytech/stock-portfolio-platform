// Portfolio Upload - Flex - template CRUD + governance (CLAUDE.md's "Portfolio Upload - Flex"
// section has the full narrative behind every decision below).

import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { ColumnMapping, ALL_TARGET_FIELDS } from './flexParser.service';

export class DuplicateTemplateNameError extends Error {}
export class InvalidTemplateNameError extends Error {}
export class TemplateNotFoundError extends Error {}

const UNIQUE_VIOLATION = '23505';

export type TemplateStatus = 'Pending Approval' | 'Approved' | 'Rejected';

export interface TemplateSummary {
  id: string;
  templateName: string;
  status: TemplateStatus;
  createdBy: string | null;
  createdAt: string;
  howToUseDescription: string | null;
}

export interface TemplateDetail extends TemplateSummary {
  reviewedBy: string | null;
  reviewedAt: string | null;
  samplePreview: unknown;
  columnMapping: ColumnMapping;
  headerRowIndex: number;
  dataStartColumnIndex: number;
}

// Trimmed non-empty, a minimum length, and at least one letter - blocks junk like "123" or
// whitespace from slipping past the UI's own validation, on top of the table's own uniqueness
// constraint. Not run client-side only - this is the authoritative check.
export function validateTemplateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 3) throw new InvalidTemplateNameError('Template name must be at least 3 characters.');
  if (!/[a-zA-Z]/.test(trimmed)) throw new InvalidTemplateNameError('Template name must contain at least one letter.');
  return trimmed;
}

function toSummary(row: { id: string; template_name: string; status: TemplateStatus; created_by: string | null; created_at: string; how_to_use_description: string | null }): TemplateSummary {
  return {
    id: row.id, templateName: row.template_name, status: row.status, createdBy: row.created_by,
    createdAt: row.created_at, howToUseDescription: row.how_to_use_description,
  };
}

// Approved-list a user sees (Admin Console "Existing Template" list) - filtered, not a flat
// shared pool: templates created by admin/admin-master, or by the caller themselves.
export async function listApprovedTemplates(userId: string, search?: string): Promise<TemplateSummary[]> {
  const { rows } = await pool.query<{ id: string; template_name: string; status: TemplateStatus; created_by: string | null; created_at: string; how_to_use_description: string | null }>(
    `SELECT m.id, m.template_name, m.status, m.created_by, m.created_at, m.how_to_use_description
     FROM m_portfolio_template_mapping_master m
     WHERE m.status = 'Approved'
       AND (
         m.created_by = $1
         OR m.created_by IN (
           SELECT ur.user_id FROM users_roles ur JOIN m_roles r ON r.id = ur.role_id WHERE r.name IN ('admin', 'admin-master')
         )
       )
       AND ($2::text IS NULL OR m.template_name ILIKE '%' || $2 || '%')
     ORDER BY m.template_name`,
    [userId, search ?? null],
  );
  return rows.map(toSummary);
}

// Admin Console approval screen only (portfolio_template:manage_status) - every template
// regardless of status/creator, newest-pending-first so what actually needs a decision sorts
// to the top.
export async function listAllTemplates(): Promise<TemplateSummary[]> {
  const { rows } = await pool.query<{ id: string; template_name: string; status: TemplateStatus; created_by: string | null; created_at: string; how_to_use_description: string | null }>(
    `SELECT id, template_name, status, created_by, created_at, how_to_use_description
     FROM m_portfolio_template_mapping_master
     ORDER BY (status = 'Pending Approval') DESC, created_at DESC`,
  );
  return rows.map(toSummary);
}

// The personal Pending-Approval dropdown - only ever the caller's own templates.
export async function listMyPending(userId: string): Promise<TemplateSummary[]> {
  const { rows } = await pool.query<{ id: string; template_name: string; status: TemplateStatus; created_by: string | null; created_at: string; how_to_use_description: string | null }>(
    `SELECT id, template_name, status, created_by, created_at, how_to_use_description
     FROM m_portfolio_template_mapping_master
     WHERE status = 'Pending Approval' AND created_by = $1
     ORDER BY template_name`,
    [userId],
  );
  return rows.map(toSummary);
}

export async function getTemplateDetail(templateId: string): Promise<TemplateDetail> {
  const client = await pool.connect();
  try {
    const { rows: masterRows } = await client.query<{
      id: string; template_name: string; status: TemplateStatus; created_by: string | null;
      reviewed_by: string | null; reviewed_at: string | null; sample_preview: unknown; created_at: string;
      header_row_index: number; data_start_column_index: number; how_to_use_description: string | null;
    }>(
      `SELECT id, template_name, status, created_by, reviewed_by, reviewed_at, sample_preview, created_at,
              header_row_index, data_start_column_index, how_to_use_description
       FROM m_portfolio_template_mapping_master WHERE id = $1`,
      [templateId],
    );
    if (!masterRows[0]) throw new TemplateNotFoundError(`No template found with id ${templateId}.`);
    const master = masterRows[0];

    const { rows: dtlsRows } = await client.query<{ target_field: string; source_header: string }>(
      'SELECT target_field, source_header FROM m_portfolio_template_mapping_dtls WHERE template_id = $1',
      [templateId],
    );
    const columnMapping: ColumnMapping = Object.fromEntries(dtlsRows.map((r) => [r.target_field, r.source_header]));

    return {
      id: master.id, templateName: master.template_name, status: master.status, createdBy: master.created_by,
      createdAt: master.created_at, reviewedBy: master.reviewed_by, reviewedAt: master.reviewed_at,
      samplePreview: master.sample_preview, columnMapping,
      headerRowIndex: master.header_row_index, dataStartColumnIndex: master.data_start_column_index,
      howToUseDescription: master.how_to_use_description,
    };
  } finally {
    client.release();
  }
}

export interface TemplateParseConfig {
  columnMapping: ColumnMapping;
  headerRowIndex: number;
  dataStartColumnIndex: number;
}

// What real-upload call sites (createPortfolioFlex/changeFlexTemplate/the dryRun preview) need
// to apply an existing (Approved or the caller's own Pending) template: the mapping plus where
// its header row/data columns actually start, without pulling the rest of getTemplateDetail's
// admin-review-only fields. Was named getTemplateMapping before header_row_index/
// data_start_column_index existed - renamed since "just the mapping" is no longer accurate.
export async function getTemplateParseConfig(templateId: string): Promise<TemplateParseConfig> {
  const { rows: masterRows } = await pool.query<{ header_row_index: number; data_start_column_index: number }>(
    'SELECT header_row_index, data_start_column_index FROM m_portfolio_template_mapping_master WHERE id = $1',
    [templateId],
  );
  if (!masterRows[0]) throw new TemplateNotFoundError(`No template found with id ${templateId}.`);

  const { rows: dtlsRows } = await pool.query<{ target_field: string; source_header: string }>(
    'SELECT target_field, source_header FROM m_portfolio_template_mapping_dtls WHERE template_id = $1',
    [templateId],
  );

  return {
    columnMapping: Object.fromEntries(dtlsRows.map((r) => [r.target_field, r.source_header])),
    headerRowIndex: masterRows[0].header_row_index,
    dataStartColumnIndex: masterRows[0].data_start_column_index,
  };
}

export interface CreateTemplateInput {
  templateName: string;
  columnMapping: ColumnMapping;
  samplePreview: unknown;
  createdBy: string;
  headerRowIndex: number;
  dataStartColumnIndex: number;
  howToUseDescription?: string | null;
}

// Save Template - master + dtls rows, always lands at 'Pending Approval'. Only ever called
// once a real Dashboard has already been rendered from this exact mapping (enforced by the
// caller, not here) - the DB layer just persists what it's given.
//
// Accepts an optional existing `client` so portfolio.service.ts's saveFlexTemplate() can run
// this INSERT and the portfolio's upload_template_id/flex_template_status UPDATE as one
// atomic transaction, rather than two independently-committed calls that could leave a
// template created but never bound if the second step failed. When no client is given (the
// standalone POST /portfolio-templates route), this opens and manages its own transaction.
export async function createTemplate(input: CreateTemplateInput, client?: PoolClient): Promise<TemplateSummary> {
  const templateName = validateTemplateName(input.templateName);
  const mappedFields = Object.keys(input.columnMapping).filter((f) => (ALL_TARGET_FIELDS as readonly string[]).includes(f));

  const ownsConnection = !client;
  const conn = client ?? await pool.connect();
  try {
    if (ownsConnection) await conn.query('BEGIN');

    let masterRow: { id: string; created_at: string };
    try {
      const { rows } = await conn.query<{ id: string; created_at: string }>(
        `INSERT INTO m_portfolio_template_mapping_master
           (template_name, created_by, sample_preview, header_row_index, data_start_column_index, how_to_use_description)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [templateName, input.createdBy, JSON.stringify(input.samplePreview), input.headerRowIndex, input.dataStartColumnIndex, input.howToUseDescription ?? null],
      );
      masterRow = rows[0];
    } catch (err) {
      if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
        throw new DuplicateTemplateNameError(`A template named "${templateName}" already exists.`);
      }
      throw err;
    }

    if (mappedFields.length) {
      const values = mappedFields.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');
      const params = mappedFields.flatMap((field) => [masterRow.id, field, input.columnMapping[field]]);
      await conn.query(
        `INSERT INTO m_portfolio_template_mapping_dtls (template_id, target_field, source_header) VALUES ${values}`,
        params,
      );
    }

    if (ownsConnection) await conn.query('COMMIT');
    return {
      id: masterRow.id, templateName, status: 'Pending Approval', createdBy: input.createdBy,
      createdAt: masterRow.created_at, howToUseDescription: input.howToUseDescription ?? null,
    };
  } catch (err) {
    if (ownsConnection) await conn.query('ROLLBACK').catch(() => { /* best-effort */ });
    throw err;
  } finally {
    if (ownsConnection) conn.release();
  }
}

// Admin Console approval function - the entire approval mechanism.
export async function setTemplateStatus(templateId: string, status: 'Approved' | 'Rejected', reviewedBy: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE m_portfolio_template_mapping_master
     SET status = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $3`,
    [status, reviewedBy, templateId],
  );
  if (!rowCount) throw new TemplateNotFoundError(`No template found with id ${templateId}.`);
}
