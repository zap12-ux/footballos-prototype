import { z } from 'zod';
import { IdSchema, TimestampSchema, UnitSchema, VersionSchema } from './common.js';

// §8 Playbook ---------------------------------------------------------------------------------

export const PlaybookDocumentStatusSchema = z.enum(['uploaded', 'extracting', 'extracted', 'review', 'failed']);
export type PlaybookDocumentStatus = z.infer<typeof PlaybookDocumentStatusSchema>;

/** Where a page's text came from (v0.4, §15.1). `none` = scanned page without OCR: nothing is proposed from it. */
export const PageTextSourceSchema = z.enum(['pdf_text', 'ocr', 'none']);
export type PageTextSource = z.infer<typeof PageTextSourceSchema>;

/** How a proposal was found (v0.4, §15.1): text heuristics, a model over the page image, or nothing. */
export const ProposalBasisSchema = z.enum(['text', 'model', 'none']);
export type ProposalBasis = z.infer<typeof ProposalBasisSchema>;

/** Plain-language outcome of an extraction, shown to the reviewing coach (v0.4). */
export const ExtractionSummarySchema = z.object({
  basis: ProposalBasisSchema,
  note: z.string(),
  warnings: z.array(z.string()),
  conceptsProposed: z.number().int().nonnegative(),
  termsProposed: z.number().int().nonnegative(),
  pagesWithoutText: z.number().int().nonnegative(),
});
export type ExtractionSummary = z.infer<typeof ExtractionSummarySchema>;

export const PlaybookDocumentSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  unit: UnitSchema,
  title: z.string().min(1).max(200),
  assetId: IdSchema,
  pageCount: z.number().int().nonnegative(),
  status: PlaybookDocumentStatusSchema,
  /** Null until extraction has run; `failed` documents carry the failure reason in `extraction.note`. */
  extraction: ExtractionSummarySchema.nullable(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type PlaybookDocument = z.infer<typeof PlaybookDocumentSchema>;

export const PlaybookPageSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  pageNumber: z.number().int().positive(),
  /** Storage key of the rendered page PNG; null when no image was rendered (plain-text documents). */
  imageKey: z.string().min(1).nullable(),
  /** Untrusted data: text layer or OCR output. */
  ocrText: z.string().nullable(),
  ocrConfidence: z.number().min(0).max(1).nullable(),
  textSource: PageTextSourceSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type PlaybookPage = z.infer<typeof PlaybookPageSchema>;

export const PlaybookVersionStatusSchema = z.enum(['draft', 'approved', 'superseded']);
export type PlaybookVersionStatus = z.infer<typeof PlaybookVersionStatusSchema>;

export const PlaybookVersionSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  unit: UnitSchema,
  seasonId: IdSchema,
  label: z.string().min(1).max(64),
  status: PlaybookVersionStatusSchema,
  approvedBy: IdSchema.nullable(),
  approvedAt: TimestampSchema.nullable(),
  supersedes: IdSchema.nullable(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
});
export type PlaybookVersion = z.infer<typeof PlaybookVersionSchema>;

export const SourceRefSchema = z.object({
  documentId: IdSchema,
  pageNumber: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  excerpt: z.string().max(2000).nullable(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ConceptKindSchema = z.enum([
  'run',
  'pass',
  'protection',
  'front',
  'coverage',
  'pressure',
  'special_teams',
  'formation',
  'other',
]);
export type ConceptKind = z.infer<typeof ConceptKindSchema>;

export const ExtractionStatusSchema = z.enum(['proposed', 'approved', 'rejected']);
export type ExtractionStatus = z.infer<typeof ExtractionStatusSchema>;

export const ConceptSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  versionId: IdSchema,
  name: z.string().min(1).max(120),
  kind: ConceptKindSchema,
  description: z.string().max(4000),
  installed: z.boolean(),
  sources: z.array(SourceRefSchema),
  status: ExtractionStatusSchema,
  /** How the proposal was found; `none` for coach-created concepts. */
  basis: ProposalBasisSchema,
  /** Plain-language note from the extractor or the coach (untrusted when it came from a document). */
  note: z.string().max(2000),
  decidedBy: IdSchema.nullable(),
  decidedAt: TimestampSchema.nullable(),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Concept = z.infer<typeof ConceptSchema>;

export const TermSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  versionId: IdSchema,
  term: z.string().min(1).max(120),
  definition: z.string().max(4000),
  sources: z.array(SourceRefSchema),
  status: ExtractionStatusSchema,
  basis: ProposalBasisSchema,
  note: z.string().max(2000),
  decidedBy: IdSchema.nullable(),
  decidedAt: TimestampSchema.nullable(),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Term = z.infer<typeof TermSchema>;

// §15.1 requests and responses (v0.4) --------------------------------------------------------

export const PlaybookDocumentsQuerySchema = z.object({ unit: UnitSchema.optional() });
export type PlaybookDocumentsQuery = z.infer<typeof PlaybookDocumentsQuerySchema>;

export const PlaybookDocumentDetailSchema = z.object({ document: PlaybookDocumentSchema, pages: z.array(PlaybookPageSchema) });
export type PlaybookDocumentDetail = z.infer<typeof PlaybookDocumentDetailSchema>;

/** `GET /playbook/documents/:id/grant` → page images at `pageUrlTemplate` with `{pageNumber}` substituted. */
export const DocumentGrantSchema = z.object({ pageUrlTemplate: z.string(), expiresAt: TimestampSchema });
export type DocumentGrant = z.infer<typeof DocumentGrantSchema>;

export const PlaybookVersionsQuerySchema = z.object({ unit: UnitSchema.optional(), seasonId: IdSchema.optional() });
export type PlaybookVersionsQuery = z.infer<typeof PlaybookVersionsQuerySchema>;

export const CreatePlaybookVersionRequestSchema = z.object({
  unit: UnitSchema,
  seasonId: IdSchema,
  label: z.string().trim().min(1).max(64),
});
export type CreatePlaybookVersionRequest = z.infer<typeof CreatePlaybookVersionRequestSchema>;

export const ExtractionStatusQuerySchema = z.object({ status: ExtractionStatusSchema.optional() });
export type ExtractionStatusQuery = z.infer<typeof ExtractionStatusQuerySchema>;

export const PatchConceptRequestSchema = z.object({
  expectedVersion: VersionSchema,
  status: ExtractionStatusSchema.exclude(['proposed']).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  kind: ConceptKindSchema.optional(),
  description: z.string().max(4000).optional(),
  installed: z.boolean().optional(),
  note: z.string().max(2000).optional(),
});
export type PatchConceptRequest = z.infer<typeof PatchConceptRequestSchema>;

export const PatchTermRequestSchema = z.object({
  expectedVersion: VersionSchema,
  status: ExtractionStatusSchema.exclude(['proposed']).optional(),
  term: z.string().trim().min(1).max(120).optional(),
  definition: z.string().max(4000).optional(),
  note: z.string().max(2000).optional(),
});
export type PatchTermRequest = z.infer<typeof PatchTermRequestSchema>;

/** Coach-created concept: `status: 'approved'`, `sources: []`, `basis: 'none'`. */
export const CreateConceptRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: ConceptKindSchema,
  description: z.string().max(4000).default(''),
  installed: z.boolean().default(true),
  note: z.string().max(2000).default(''),
});
export type CreateConceptRequest = z.infer<typeof CreateConceptRequestSchema>;

export const CreateTermRequestSchema = z.object({
  term: z.string().trim().min(1).max(120),
  definition: z.string().max(4000).default(''),
  note: z.string().max(2000).default(''),
});
export type CreateTermRequest = z.infer<typeof CreateTermRequestSchema>;

/** `POST /playbook/versions/:id/approve` → the approved version plus the one it superseded (if any). */
export const ApprovePlaybookVersionResponseSchema = z.object({ version: PlaybookVersionSchema, superseded: PlaybookVersionSchema.nullable() });
export type ApprovePlaybookVersionResponse = z.infer<typeof ApprovePlaybookVersionResponseSchema>;
