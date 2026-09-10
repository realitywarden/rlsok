#!/usr/bin/env node
'use strict';
// Synthetic explanation of review invalidation. No ROS, SDK, hardware or network.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const runtime = path.resolve(__dirname, '../../dist/packages/composable-shadow');
const { createFanucFixture } = require(path.join(runtime, 'fixture.js'));
const { approveProfile, evaluateProfile } = require(runtime);
const sha = value => createHash('sha256').update(value).digest('hex');
async function main() {
  if (process.argv.length !== 3) throw Error('Supply one new output directory.');
  const output = path.resolve(process.argv[2]); fs.mkdirSync(output);
  const write = (name, value) => { const bytes = JSON.stringify(value, null, 2) + '\n'; fs.writeFileSync(path.join(output, name), bytes, {flag:'wx'}); return bytes; };
  const now = new Date(), f = createFanucFixture(now);
  // Reuse only the tested trajectory contract, with explicitly synthetic identity.
  f.profile.id = 'synthetic-calibration-review'; f.profile.robot = { deviceId:'fixture-only', model:'two-axis software fixture', controller:'fixture-only', urdfSha256:'a'.repeat(64) };
  f.profile.jointOrder = ['axis_1','axis_2'];
  f.profile.paths = [f.profile.paths[0]];f.profile.paths[0].endpoint='/fixture/follow_joint_trajectory';
  const calibration = write('baseline-calibration.json', { fixtureOnly:true, zeroRadians:0 });
  const limits = write('baseline-limits.json', { fixtureOnly:true, halfRangeRadians:0.5, lowerRadians:-0.5, upperRadians:0.5 });
  f.profile.facts = [ {id:'calibration',kind:'file_sha256',path:'baseline-calibration.json',expected:sha(calibration)},
    {id:'position-limits',kind:'file_sha256',path:'baseline-limits.json',expected:sha(limits)} ];
  f.profile.paths[0].checks = ['calibration','position-limits'];
  f.observation.profileId=f.profile.id;
  f.observation.paths=[{...f.observation.paths[0],endpoint:f.profile.paths[0].endpoint}];
  f.observation.facts=f.profile.facts.map(x=>({id:x.id,kind:x.kind,value:x.expected,observedAt:now.toISOString()}));
  f.proposals.proposals=[{id:'synthetic-mission-candidate',pathId:f.profile.paths[0].id,
    goal:{trajectory:{joint_names:['axis_1','axis_2'],points:[{positions:[0,0],time_from_start:{sec:1,nanosec:0}}]}}}];
  const approval=approveProfile(f.profile,'synthetic-example-reviewer',new Date(now.getTime()+3600000).toISOString(),now);
  write('profile.json',f.profile);write('approval.json',approval);write('candidate.json',f.proposals);
  const baseline=await evaluateProfile({...f,approval,now}); write('baseline-report.json',baseline);
  const changedCalibration=write('changed-calibration.json',{fixtureOnly:true,zeroRadians:0.1});
  const changed=structuredClone(f.observation);changed.facts[0].value=sha(changedCalibration);
  const changedReport=await evaluateProfile({...f,observation:changed,approval,now});write('calibration-changed-report.json',changedReport);
  const revisedLimits=write('limits-for-new-review.json',{fixtureOnly:true,halfRangeRadians:0.5,lowerRadians:-0.4,upperRadians:0.6});
  changed.facts[1].value=sha(revisedLimits);
  const revised=await evaluateProfile({...f,observation:changed,approval,now});write('limits-changed-report.json',revised);
  if(baseline.decision!=='WOULD_ALLOW'||changedReport.decision!=='WOULD_BLOCK'||revised.decision!=='WOULD_BLOCK')throw Error('unexpected comparison');
  if([baseline,changedReport,revised].some(x=>x.hardwareSignalSent||x.controllerGoalsAttempted))throw Error('unexpected dispatch');
  const summary={fixtureOnly:true,baseline:baseline.decision,changedCalibration:changedReport.decision,changedLimitsUnderOldApproval:revised.decision,
    explanation:'Example zero changes 0 -> 0.1 rad. With illustrative half-range 0.5 rad, review bounds -0.5..0.5 -> -0.4..0.6. Both changes invalidate the original approval. No new approval is generated for the changed inputs; the owner must review the actual limits and mission conditions.',
    scope:'Synthetic configuration-review example only. Not a Dynamixel mission adapter, limit-safety validation, or physical calibration.'};
  write('summary.json',summary);console.log(JSON.stringify(summary));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
