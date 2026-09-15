#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  checkExecutablePolicySpec,
  diffExecutablePolicies,
  executablePolicyHash,
  executablePolicySpecSchema,
  type ExecutablePolicySpec
} from '../../packages/core/exec-spec';
import {
  verifyEvidenceBundle,
  type EvidenceBundle
} from '../../packages/core/evidence';
import { ros2Usage, runRos2Command } from './ros2';
import { cloudUsage, runCloudCommand } from './cloud';
import { runStandaloneShadow } from './shadow';
import { pairingFailureGuidance, runPairCommand } from './pair';
import { runSetupCommand } from './setup';
import { runObserveCommand } from './observe';
import { runUr5eValidationCommand } from './validate-ur5e';
import { runExternalRos2ValidationCommand } from './validate-external-ros2';
import { runCompatibilityCommand } from './compatibility';
import { runProfileCommand } from './profile';
import {
  hardwareDispatchForCliFailure,
  operatorFailureReport,
  operatorReasonCode
} from './operator-report';
import packageMetadata from '../../package.json';

function fail(
  message: string,
  report: {
    observed?: string;
    reason?: string;
    nextAction?: string;
    hardwareDispatch?: 'NO' | 'UNKNOWN';
  } = {},
): never {
  process.stderr.write(
    operatorFailureReport('FAILED', message, report) +
      `ERROR: ${message}\n`,
  );
  process.exit(2);
}

function readStructured(path: string): unknown {
  if (!existsSync(path)) fail(`input does not exist: ${path}`);
  if (statSync(path).isDirectory()) fail(`expected a file, got directory: ${path}`);
  try {
    return load(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readSpec(path: string): ExecutablePolicySpec {
  const parsed = executablePolicySpecSchema.safeParse(readStructured(resolve(path)));
  if (!parsed.success) fail(`invalid ExecSpec ${path}: ${parsed.error.message}`);
  return parsed.data;
}

function check(path: string): void {
  const result = checkExecutablePolicySpec(readStructured(resolve(path)));
  process.stdout.write(`${result.result}\n`);
  for (const reason of result.reasons) process.stdout.write(`- ${reason}\n`);
  if (result.result === 'INVALID') process.exitCode = 2;
  else if (result.result !== 'PASS') process.exitCode = 1;
}

function diff(left: string, right: string): void {
  const result = diffExecutablePolicies(readSpec(left), readSpec(right));
  if (result.changes.length === 0) process.stdout.write('No release identity changes.\n');
  else for (const change of result.changes) process.stdout.write(`CHANGED: ${change}\n`);
  process.stdout.write(`APPROVAL_INVALIDATED: ${result.invalidatesApproval ? 'yes' : 'no'}\n`);
}

function verifyEvidence(path: string, releasePath?: string): void {
  const resolved = resolve(path);
  if (!existsSync(resolved)) fail(`evidence input does not exist: ${path}`);
  const bundlePath = statSync(resolved).isDirectory() ? join(resolved, 'evidence.json') : resolved;
  if (!existsSync(bundlePath)) fail(`evidence bundle does not exist: ${bundlePath}`);
  const bundle = readStructured(bundlePath) as EvidenceBundle;
  const release = releasePath ? readSpec(releasePath) : undefined;
  const result = verifyEvidenceBundle(bundle, release
    ? {
        expectedReleaseId: release.metadata.releaseId,
        expectedExecutablePolicyHash: executablePolicyHash(release),
        revokedReleaseIds: release.evidence.status === 'revoked'
          ? new Set([release.metadata.releaseId])
          : undefined,
        expiresAt: release.deployment.expiresAt,
      }
    : undefined);
  if (!result.ok) {
    fail(`evidence verification failed: ${result.reason}`, {
      observed: result.reason,
      reason: result.reason,
      hardwareDispatch: 'NO',
      nextAction:
        'Restore the complete original Evidence bundle, then verify its source and transfer checksums before relying on it.'
    });
  }
  process.stdout.write(
    release
      ? 'PASS_BOUND_TO_RELEASE (self-consistency and supplied release identity only; authenticate provenance with a trusted Cloud checkpoint)\n'
      : 'SELF_CONSISTENT_ONLY (not authenticated; supply --release <ExecSpec> and verify provenance with a trusted Cloud checkpoint)\n',
  );
}

function usage(exitCode = 1): never {
  process.stdout.write(
    'RLSOK ReleaseGate CLI\n' +
    'Robot Software Execution Authorization.\n\n' +
    'usage: rlsok setup | rlsok profile help | rlsok compatibility inspect ... | rlsok observe | rlsok validate-ur5e ... | rlsok validate-external-ros2 ... | rlsok pair | rlsok check <release> | rlsok diff <old> <new> | rlsok shadow <release> <proposal> <evidence> | rlsok verify-evidence <bundle> [--release <ExecSpec>] | rlsok ros2 ... | rlsok cloud ...\n'
  );
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--version' || command === '-V' || command === 'version') {
    process.stdout.write(`RLSOK ${packageMetadata.version}\n`);
  }
  else if (command === '--help' || command === '-h' || command === 'help') usage(0);
  else if (command === 'check' && args.length === 1) check(args[0]);
  else if (command === 'diff' && args.length === 2) diff(args[0], args[1]);
  else if (command === 'shadow' && args.length === 3) {
    process.exitCode = await runStandaloneShadow(args[0], args[1], args[2]);
  }
  else if (
    command === 'verify-evidence'
    && (args.length === 1 || (args.length === 3 && args[1] === '--release'))
  ) verifyEvidence(args[0], args[2]);
  else if (command === 'pair') process.exitCode = await runPairCommand(args);
  else if (command === 'setup') process.exitCode = await runSetupCommand(args);
  else if (command === 'observe') process.exitCode = await runObserveCommand(args);
  else if (command === 'validate-ur5e') process.exitCode = await runUr5eValidationCommand(args);
  else if (command === 'validate-external-ros2') process.exitCode = await runExternalRos2ValidationCommand(args);
  else if (command === 'compatibility') process.exitCode = await runCompatibilityCommand(args);
  else if (command === 'profile') process.exitCode = await runProfileCommand(args);
  else if (command === 'ros2') process.exitCode = await runRos2Command(args);
  else if (command === 'cloud') process.exitCode = await runCloudCommand(args);
  else usage();
}

void main().catch((error) => {
  if (process.argv[2] === 'ros2' && process.argv[3] === 'help') {
    process.stderr.write(`${ros2Usage()}\n`);
  }
  if (process.argv[2] === 'cloud' && process.argv[3] === 'help') {
    process.stderr.write(`${cloudUsage()}\n`);
  }
  const message = error instanceof Error ? error.message : String(error);
  const ros2Operation = process.argv[3]?.startsWith('--')
    ? 'shadow'
    : (process.argv[3] ?? 'shadow');
  const hardwareDispatch = hardwareDispatchForCliFailure(
    process.argv[2],
    ros2Operation,
    message
  );
  const guidance: Record<string, string> = {
    ...pairingFailureGuidance,
    dds_discovery_timeout:
      "ROS 2 discovery timed out. Confirm this terminal sourced /opt/ros/jazzy/setup.bash, check ROS_DOMAIN_ID matches the robot graph, and run 'rlsok ros2 doctor'.",
    proposal_timeout:
      "No proposal arrived before the bounded wait expired. Confirm the proposal publisher and ROS_DOMAIN_ID, then submit a fresh uniquely identified proposal.",
    "ROS 2 unavailable":
      "ROS 2 is unavailable. Source /opt/ros/jazzy/setup.bash and run 'rlsok ros2 doctor' before retrying.",
    "controller action server unavailable":
      "The configured FollowJointTrajectory server was not found. Start ros2_control, confirm the controller is active with 'ros2 control list_controllers', then retry.",
    joint_state_missing:
      "No fresh JointState was received. Check 'ros2 topic echo --once /joint_states' and verify ROS_DOMAIN_ID before retrying.",
    joint_state_stale:
      "JointState stopped updating. Restore the state publisher and retry; RLSOK will not evaluate stale robot state.",
    "runtime_already_paired_use_--replace":
      "This runtime is already paired. Continue with 'rlsok setup', or use 'rlsok pair --replace' only when intentionally replacing credentials.",
  };
  fail(guidance[message] ?? message, {
    observed: message,
    reason: operatorReasonCode(message),
    nextAction: guidance[message] ?? message,
    hardwareDispatch,
  });
});
