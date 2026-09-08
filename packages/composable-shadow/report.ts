import type { evaluateProfile } from './index';
type Report = Awaited<ReturnType<typeof evaluateProfile>>;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}|]/g, '\\$&').replace(/[\r\n]/g, ' ');

export function reportMarkdown(report: Report): string {
  const lines = [
    '# Local Shadow result', '', `**${report.decision}** — ${escape(report.profileId)}`, '',
    `Evaluated: ${report.evaluatedAt}. Source: ${report.collector}.`, '',
    'WOULD_ALLOW means the declared configuration, local approval, observed interface and supplied message/goal passed these checks. It does not mean the proposed motion is safe or authorize a real command.', '',
    'WOULD_BLOCK means at least one listed check failed. Review the failed input; do not replace observations with expected values or silently approve the changed setup.', '',
    'RLSOK sent zero controller commands and uploaded no data. This run does not intercept other nodes: they can still operate a robot. Use an isolated simulation for the first evaluation.', ''
  ];
  for (const result of report.results) {
    lines.push(`## ${escape(result.pathId)} — ${result.decision}`, '',
      `Boundary: ${escape(result.endpoint)} (${escape(result.interfaceType)}).`, '');
    if ('subscriber' in result && result.subscriber) lines.push(`Selected receiver: ${escape(result.subscriber.namespace === "/" ? "" : result.subscriber.namespace)}/${escape(result.subscriber.name)}.`, '');
    lines.push(`Reason: ${escape(result.reason)}.`, '', '| Check | Result | Detail |', '| --- | --- | --- |');
    for (const check of result.checks) lines.push(`| ${escape(check.id)} | ${check.passed ? 'Matched' : 'Failed'} | ${escape(check.reason)} |`);
    lines.push('', `Evidence: ${result.pathId}.evidence.json; input assessment: ${result.pathId}.assessment.json.`, '');
  }
  lines.push('## What this result does not establish', '', ...report.limitations.map(value => `- ${escape(value)}`), '',
    'Motor/current limits, collision avoidance, emergency stops, gait stability and readiness checks remain with the existing robot/control system. No safety or formal-verification claim is made.', '',
    'The local operator name is self-attested. Keep results and configuration private; public case studies and contribution credit require agreement with participants.', '');
  return lines.join('\n');
}

export function compareReports(baseline: Report, changed: Report) {
  if (baseline.profileSha256 !== changed.profileSha256) throw new Error('comparison_requires_the_same_approved_profile');
  return {
    schemaVersion: 1, kind: 'LocalShadowComparison', profileSha256: baseline.profileSha256,
    baselineDecision: baseline.decision, changedDecision: changed.decision,
    cloudUploaded: false, hardwareSignalSent: false,
    paths: baseline.results.map(before => {
      const after = changed.results.find(result => result.pathId === before.pathId);
      if (!after) throw new Error('comparison_path_missing');
      if (before.assessment.proposalsSha256 !== after.assessment.proposalsSha256 || before.release.metadata.releaseId !== after.release.metadata.releaseId || before.release.evidence.approvedAt !== after.release.evidence.approvedAt || before.release.evidence.approvedBy !== after.release.evidence.approvedBy || before.release.deployment.expiresAt !== after.release.deployment.expiresAt) throw new Error('comparison_requires_the_same_approval_and_proposals');
      return { pathId: before.pathId, baselineDecision: before.decision, changedDecision: after.decision,
        baselineObservationSha256: before.assessment.observationSha256,
        changedObservationSha256: after.assessment.observationSha256,
        changedChecks: after.checks.filter(check => {
          const previous = before.checks.find(item => item.id === check.id);
          return !previous || check.passed !== previous.passed || check.reason !== previous.reason;
        }) };
    })
  };
}

export function comparisonMarkdown(comparison: ReturnType<typeof compareReports>): string {
  return ['# Compare two observations against one approved setup', '',
    `Baseline: **${comparison.baselineDecision}**. Changed observation: **${comparison.changedDecision}**.`, '',
    'The approved profile and proposed command are kept unchanged. Read baseline/report.md and changed/report.md for all checks. A block caused by stale or missing data does not demonstrate that the intended configuration change was detected.', '',
    ...comparison.paths.flatMap(path => [`## ${escape(path.pathId)}`, '',
      ...(path.changedChecks.length ? path.changedChecks.map(check => `- ${escape(check.id)}: ${check.passed ? 'matched' : 'failed'} (${escape(check.reason)}).`) : ['No check outcome changed.']), '']),
    'This is local Shadow evidence, with zero RLSOK command dispatch and no cloud upload. It is not proof of physical motion safety or customer acceptance.', ''
  ].join('\n');
}
