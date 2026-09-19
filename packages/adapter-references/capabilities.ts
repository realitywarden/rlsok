import { z } from 'zod';
import { canonicalJson, sha256 } from '../core/evidence';
import type { RuntimeAttestation } from '../core/runtime-attestation';

const timestamp = z.string().datetime({ offset: true });
const identity = z.string().trim().min(1).max(512);

export const degradationCapabilityReportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceIdentity: identity,
  observedAt: timestamp,
  continuityToken: identity,
  classificationRevision: identity,
  faultSetId: identity,
  capabilities: z.record(z.boolean())
}).strict();

export type DegradationCapabilityReport = z.infer<typeof degradationCapabilityReportSchema>;

export function degradationRuntimeAttestation(
  report: DegradationCapabilityReport
): RuntimeAttestation {
  const parsed = degradationCapabilityReportSchema.parse(report);
  return {
    schemaVersion: 1,
    source: {
      identity: parsed.sourceIdentity,
      kind: 'external-degradation-classifier',
      version: parsed.classificationRevision
    },
    observedAt: parsed.observedAt,
    continuityToken: parsed.continuityToken,
    availableCapabilities: Object.entries(parsed.capabilities)
      .filter(([, available]) => available)
      .map(([capability]) => capability)
      .sort()
  };
}

export const selectedObservedStateReportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceIdentity: identity,
  selectionIdentity: identity,
  observedAt: timestamp,
  stateEpoch: identity,
  monitorVersion: identity,
  selectedCapability: identity,
  status: z.enum(['ready', 'not_ready', 'unknown'])
}).strict();

export type SelectedObservedStateReport = z.infer<typeof selectedObservedStateReportSchema>;

/**
 * Normalizes one explicitly selected, execution-relevant state contract.
 * The adapter owns stateEpoch and must change it for relevant transitions while
 * keeping it stable across unselected sensor or environment noise.
 */
export function selectedObservedStateRuntimeAttestation(
  report: SelectedObservedStateReport
): RuntimeAttestation {
  const parsed = selectedObservedStateReportSchema.parse(report);
  return {
    schemaVersion: 1,
    source: {
      identity: parsed.sourceIdentity,
      kind: 'selected-observed-state-monitor',
      version: parsed.monitorVersion
    },
    observedAt: parsed.observedAt,
    continuityToken: sha256(canonicalJson({
      selectionIdentity: parsed.selectionIdentity,
      stateEpoch: parsed.stateEpoch
    })),
    availableCapabilities: parsed.status === 'ready'
      ? [parsed.selectedCapability]
      : []
  };
}

export const golemUpperBodyReportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceIdentity: identity,
  observedAt: timestamp,
  continuityToken: identity,
  monitorVersion: identity,
  upperBodyMotionReady: z.boolean()
}).strict();

export type GolemUpperBodyReport = z.infer<typeof golemUpperBodyReportSchema>;

/** RLSOK consumes the monitor verdict; it never infers contact/caught state. */
export function golemUpperBodyRuntimeAttestation(
  report: GolemUpperBodyReport
): RuntimeAttestation {
  const parsed = golemUpperBodyReportSchema.parse(report);
  return {
    schemaVersion: 1,
    source: {
      identity: parsed.sourceIdentity,
      kind: 'golem-upper-body-monitor',
      version: parsed.monitorVersion
    },
    observedAt: parsed.observedAt,
    continuityToken: parsed.continuityToken,
    availableCapabilities: parsed.upperBodyMotionReady
      ? ['upper_body.motion_ready']
      : []
  };
}

const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const deviceHandshakeReportSchema = z.object({
  schemaVersion: z.literal(1),
  sourceIdentity: identity,
  observedAt: timestamp,
  monitorVersion: identity,
  sessionContinuityToken: identity,
  challengeNonce: identity,
  authentication: z.object({
    method: z.enum(['signed-challenge', 'session-authenticated', 'configured', 'none']),
    proofVerified: z.boolean(),
    keyId: identity.optional()
  }).strict(),
  device: z.object({
    controllerId: identity,
    hardwareRevision: identity,
    firmwareVersion: identity,
    firmwareDigest: digest.optional(),
    protocolVersion: identity,
    configurationDigest: digest,
    capabilities: z.array(identity)
  }).strict()
}).strict();

export type DeviceHandshakeReport = z.infer<typeof deviceHandshakeReportSchema>;

/**
 * Normalizes an adapter-owned challenge/session result. Configured IDs, bus
 * addresses, USB paths and unverified self-reports never emit a trusted
 * capability. The continuity digest changes with the selected device,
 * software, configuration or authenticated session, but not with each nonce.
 */
export function deviceHandshakeRuntimeAttestation(
  report: DeviceHandshakeReport
): RuntimeAttestation {
  const parsed = deviceHandshakeReportSchema.parse(report);
  const authenticated = parsed.authentication.proofVerified &&
    (parsed.authentication.method === 'signed-challenge' ||
      parsed.authentication.method === 'session-authenticated');
  return {
    schemaVersion: 1,
    source: {
      identity: parsed.sourceIdentity,
      kind: 'device-handshake-monitor',
      version: parsed.monitorVersion
    },
    observedAt: parsed.observedAt,
    continuityToken: sha256(canonicalJson({
      session: parsed.sessionContinuityToken,
      authenticationMethod: parsed.authentication.method,
      keyId: parsed.authentication.keyId ?? null,
      device: parsed.device
    })),
    availableCapabilities: authenticated
      ? ['device.identity.authenticated', ...new Set(parsed.device.capabilities)].sort()
      : []
  };
}
