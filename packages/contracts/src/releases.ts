import { z } from 'zod';

const httpsUrl = z.string().url().refine((value) => value.startsWith('https://'), 'HTTPS URL required');
const digest = z.string().regex(/^sha256:[a-fA-F0-9]{64}$/);

export const releaseArtifactSchema = z.object({
  target: z.string().min(1),
  url: httpsUrl,
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  size: z.number().int().positive(),
  mediaType: z.string().optional(),
  attestationUrl: httpsUrl.optional(),
  sbomUrl: httpsUrl.optional(),
}).strict();

export const releaseManifestSchema = z.object({
  schemaVersion: z.enum(['1.0', '1.1']),
  product: z.literal('RepoWrangler'),
  version: z.string().regex(/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
  releasedAt: z.string().datetime(),
  channel: z.enum(['stable', 'preview']).optional(),
  releaseNotesUrl: httpsUrl.optional(),
  manifestAttestationUrl: httpsUrl.optional(),
  artifacts: z.array(releaseArtifactSchema).min(1),
  containerImages: z.array(z.object({
    target: z.string().min(1), image: z.string().min(1), digest,
  }).strict()).optional(),
  compatibility: z.object({
    minimumSourceVersion: z.string().optional(),
    databaseSchema: z.object({
      minimum: z.number().int().nonnegative(),
      maximum: z.number().int().nonnegative(),
      target: z.number().int().nonnegative(),
      migrations: z.array(z.object({
        id: z.string().min(1), reversible: z.boolean(), detail: z.string().optional(),
      }).strict()),
    }).strict().optional(),
    controllers: z.array(z.object({
      type: z.string().min(1), minimumVersion: z.string().min(1),
    }).strict()).optional(),
    targets: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
}).strict();

export type ReleaseManifestDto = z.infer<typeof releaseManifestSchema>;

export const upgradeTargetSelectionSchema = z.object({
  targetVersion: z.string().regex(/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
  targetDigest: digest,
}).strict();

export const executeUpgradeRequestSchema = upgradeTargetSelectionSchema.extend({
  approvalToken: z.string().min(40).max(4096),
  idempotencyKey: z.string().min(16).max(200).regex(/^[A-Za-z0-9._:+-]+$/),
}).strict();

export const upgradeActionSchema = z.object({
  action: z.enum(['cancel', 'rollback']),
}).strict();

export const executeUpgradeActionSchema = upgradeActionSchema.extend({
  approvalToken: z.string().min(40).max(4096),
}).strict();
