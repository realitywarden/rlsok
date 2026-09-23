import { z } from 'zod';
import { canonicalJson, sha256 } from './evidence';
import {
  configurationDigest,
  executableConfigurationIdentity,
  executionConfigurationSchema
} from './execution-configuration';
import { requiredCapabilitiesSchema } from './runtime-attestation';

const hash = z.string().regex(/^[a-f0-9]{64}$/, 'expected lowercase SHA-256');
const timestamp = z.string().datetime({ offset: true });

export const executablePolicySpecSchema = z.object({
  apiVersion: z.literal('realitywarden.io/v1alpha1'),
  kind: z.literal('ExecutablePolicy'),
  metadata: z.object({
    name: z.string().min(1),
    releaseId: z.string().min(1),
    createdAt: timestamp
  }).strict(),
  model: z.object({
    artifact: z.string().min(1).refine((path) => !/^([a-zA-Z]:[\\/]|[\\/])/.test(path), {
      message: 'artifact must be portable, not an absolute path'
    }),
    sha256: hash,
    framework: z.enum(['lerobot', 'custom', 'ros2']),
    policyType: z.string().min(1),
    codeRevision: z.string().min(1)
  }).strict(),
  actionContract: z.object({
    representation: z.enum([
      'joint_position',
      'joint_velocity',
      'cartesian_pose',
      'cartesian_delta',
      'cartesian_absolute_wpr',
      'twist',
      'trajectory',
      'program',
      'structured_message'
    ]),
    dimension: z.number().int().positive(),
    jointOrder: z.array(z.string().min(1)),
    units: z.object({
      position: z.enum(['radian', 'degree', 'meter', 'millimeter', 'none']),
      velocity: z.string().min(1)
    }).strict(),
    normalizerSha256: hash,
    preprocessorSha256: hash,
    postprocessorSha256: hash
  }).strict(),
  robot: z.object({
    profileId: z.string().min(1),
    profileSha256: hash,
    urdfSha256: hash,
    controllerType: z.string().min(1),
    controllerConfigSha256: hash
  }).strict(),
  runtimePolicy: z.object({
    policySha256: hash,
    maxStateAgeMs: z.number().int().positive(),
    maxConfigurationAgeMs: z.number().int().positive().optional(),
    requiredCapabilities: requiredCapabilitiesSchema.optional(),
    maxAttestationAgeMs: z.number().int().positive().optional(),
    failClosed: z.literal(true)
  }).strict(),
  executionConfiguration: executionConfigurationSchema.optional(),
  approvedConfigurationDigest: hash.optional(),
  evidence: z.object({
    scenarioPackId: z.string().min(1),
    testReportSha256: hash,
    status: z.enum(['draft', 'tested', 'approved', 'revoked']),
    approvedBy: z.string(),
    approvedAt: z.union([timestamp, z.literal('')])
  }).strict(),
  deployment: z.object({
    allowedDeviceIds: z.array(z.string().min(1)).min(1),
    mode: z.enum(['shadow', 'canary', 'released']),
    expiresAt: timestamp
  }).strict()
}).strict().superRefine((spec, context) => {
  if (spec.actionContract.representation === 'program') {
    if (spec.actionContract.dimension !== 1 || spec.actionContract.jointOrder.length !== 0
      || spec.actionContract.units.position !== 'none' || spec.actionContract.units.velocity !== 'none') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['actionContract'], message: 'program contract requires one program selector, no joints and no physical units' });
    }
  } else if (spec.actionContract.representation !== 'structured_message' && spec.actionContract.units.position === 'none') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['actionContract', 'units'], message: 'physical action contract requires physical position units' });
  }
  if (
    spec.actionContract.representation.startsWith('joint_')
    && spec.actionContract.dimension !== spec.actionContract.jointOrder.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actionContract', 'jointOrder'],
      message: 'jointOrder length must equal action dimension'
    });
  }
  if (spec.evidence.status === 'approved' && (!spec.evidence.approvedBy || !spec.evidence.approvedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidence'],
      message: 'approved release requires approvedBy and approvedAt'
    });
  }
  if (spec.evidence.status !== 'approved' && (spec.evidence.approvedBy || spec.evidence.approvedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['evidence'],
      message: 'approval identity is only valid for approved releases'
    });
  }
  if (
    spec.executionConfiguration
    && spec.approvedConfigurationDigest
    && configurationDigest(spec.executionConfiguration) !== spec.approvedConfigurationDigest
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['approvedConfigurationDigest'],
      message: 'approved configuration digest does not match executionConfiguration'
    });
  }
});

export type ExecutablePolicySpec = z.infer<typeof executablePolicySpecSchema>;

export function executablePolicyHash(spec: ExecutablePolicySpec): string {
  const parsed = executablePolicySpecSchema.parse(spec);
  return sha256(canonicalJson({
    ...parsed,
    executionConfiguration: executableConfigurationIdentity(
      parsed.executionConfiguration
    )
  }));
}

type CheckResult = 'PASS' | 'BLOCK' | 'APPROVAL_REQUIRED' | 'INVALID';

interface ExecSpecCheck {
  result: CheckResult;
  reasons: string[];
}

export function checkExecutablePolicySpec(input: unknown, now: Date = new Date()): ExecSpecCheck {
  if (!Number.isFinite(now.getTime())) {
    return { result: 'INVALID', reasons: ['current_time_invalid'] };
  }
  const parsed = executablePolicySpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      result: 'INVALID',
      reasons: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    };
  }
  const spec = parsed.data;
  if (spec.evidence.status === 'revoked') {
    return { result: 'BLOCK', reasons: ['release_revoked'] };
  }
  if (Date.parse(spec.deployment.expiresAt) <= now.getTime()) {
    return { result: 'BLOCK', reasons: ['release_expired'] };
  }
  if (spec.evidence.status === 'draft') {
    return { result: 'BLOCK', reasons: ['release_not_tested'] };
  }
  if (spec.evidence.status === 'tested') {
    return { result: 'APPROVAL_REQUIRED', reasons: ['release_not_approved'] };
  }
  return { result: 'PASS', reasons: [] };
}

interface ExecSpecDiff {
  changes: string[];
  invalidatesApproval: boolean;
}

export function diffExecutablePolicies(
  previous: ExecutablePolicySpec,
  next: ExecutablePolicySpec
): ExecSpecDiff {
  const fields: Array<[string, unknown, unknown]> = [
    ['model', previous.model.sha256, next.model.sha256],
    ['normalizer', previous.actionContract.normalizerSha256, next.actionContract.normalizerSha256],
    ['preprocessor', previous.actionContract.preprocessorSha256, next.actionContract.preprocessorSha256],
    ['postprocessor', previous.actionContract.postprocessorSha256, next.actionContract.postprocessorSha256],
    ['action contract', previous.actionContract, next.actionContract],
    ['robot profile', previous.robot.profileSha256, next.robot.profileSha256],
    ['controller', previous.robot.controllerConfigSha256, next.robot.controllerConfigSha256],
    ['runtime policy', previous.runtimePolicy, next.runtimePolicy],
    [
      'execution configuration',
      executableConfigurationIdentity(previous.executionConfiguration),
      executableConfigurationIdentity(next.executionConfiguration)
    ],
    ['approved configuration digest', previous.approvedConfigurationDigest, next.approvedConfigurationDigest],
    ['scenario evidence', previous.evidence.testReportSha256, next.evidence.testReportSha256]
  ];
  const changes = fields
    .filter(([, left, right]) => canonicalJson(left) !== canonicalJson(right))
    .map(([name]) => name);
  return { changes, invalidatesApproval: changes.length > 0 };
}
