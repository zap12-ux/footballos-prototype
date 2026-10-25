import { z } from 'zod';
import { IdSchema, TimestampSchema, UnitSchema, VersionSchema } from './common.js';

// §8 Playbook ---------------------------------------------------------------------------------

export const PlaybookDocumentStatusSchema = z.enum(['uploaded', 'extracting', 'extracted', 'review', 'failed']);
export type PlaybookDocumentStatus = z.infer<typeof PlaybookDocumentStatusSchema>;

export const PlaybookDocumentSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  unit: UnitSchema,
  title: z.string().min(1).max(200),
  assetId: IdSchema,
  pageCount: z.number().int().nonnegative(),
  status: PlaybookDocumentStatusSchema,
  createdAt: TimestampSchema,
});
export type PlaybookDocument = z.infer<typeof PlaybookDocumentSchema>;

export const PlaybookPageSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  pageNumber: z.number().int().positive(),
  imageKey: z.string().min(1),
  /** Untrusted data. */
  ocrText: z.string().nullable(),
  ocrConfidence: z.number().min(0).max(1).nullable(),
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
  version: VersionSchema,
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
});
export type Term = z.infer<typeof TermSchema>;
