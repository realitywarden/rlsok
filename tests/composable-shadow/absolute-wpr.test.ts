import assert from 'node:assert/strict';
import test from 'node:test';
import { createFanucFixture } from '../../packages/composable-shadow/fixture';
import { approveProfile, evaluateProfile, profileSchema, type Path } from '../../packages/composable-shadow';
import { validateGoal } from '../../packages/composable-shadow/goals';
import { verifyEvidenceBundle } from '../../packages/core/evidence';
import { executablePolicyHash } from '../../packages/core/exec-spec';

const now = new Date('2026-09-16T02:00:00Z');
function scenario() {
  const s = structuredClone(createFanucFixture(now));
  const old = s.profile.paths[1]!;
  s.profile.paths[1] = { ...old, adapter: 'cartesian_absolute_wpr', fields: {
    position: ['/x','/y','/z'], rotation: ['/w','/p','/r'], velocity:'/velocity',
    frame:'/frame', expectedFrame:'synthetic-frame', defaultVelocityMmS:25, maxVelocityMmS:2000
  } } as Path;
  s.proposals.proposals[1]!.goal = {x:100,y:-20,z:0,w:0,p:90,r:360,velocity:0,frame:'synthetic-frame'};
  return s;
}
test('absolute WPR keeps native components, default velocity and zero-dispatch evidence', async () => {
  const s=scenario(); const before=structuredClone(s.proposals);
  const approval=approveProfile(s.profile,'offline-reviewer','2026-09-16T03:00:00Z',now);
  const report=await evaluateProfile({...s,approval,now});
  assert.equal(report.decision,'WOULD_ALLOW');
  assert.equal(report.hardwareSignalSent,false); assert.equal(report.controllerGoalsAttempted,0); assert.equal(report.cloudUploaded,false);
  assert.deepEqual(s.proposals,before);
  const result=report.results[1]!;
  assert.equal(result.release.actionContract.representation,'cartesian_absolute_wpr');
  assert.equal(result.release.actionContract.dimension,6);
  assert.equal(result.release.actionContract.units.position,'millimeter');
  assert.deepEqual(verifyEvidenceBundle(result.evidence,{expectedReleaseId:result.release.metadata.releaseId,expectedExecutablePolicyHash:executablePolicyHash(result.release),now}),{ok:true});
});
for(const [name,change,reason] of [
  ['missing component',{r:undefined},'pose_invalid'],['nonfinite component',{x:Infinity},'pose_invalid'],
  ['string component',{p:'90'},'pose_invalid'],['fractional velocity',{velocity:1.5},'velocity_invalid'],
  ['negative velocity',{velocity:-1},'velocity_invalid'],['uint16 overflow',{velocity:65536},'velocity_invalid'],
  ['selected speed exceeded',{velocity:2001},'velocity_out_of_bounds'],
  ['empty frame',{frame:''},'frame_mismatch'],['wrong frame',{frame:'other'},'frame_mismatch']
] as const) test(`absolute WPR rejects ${name}`,()=>{
  const s=scenario();Object.assign(s.proposals.proposals[1]!.goal,change);
  assert.equal(validateGoal(s.profile,s.profile.paths[1]!,s.proposals.proposals[1]!.goal),`cartesian_absolute_wpr_${reason}`);
});
test('absolute WPR accepts literal zero pose without treating it as a no-op',()=>{
  const s=scenario(); Object.assign(s.proposals.proposals[1]!.goal,{x:0,y:0,z:0,w:0,p:0,r:0,velocity:2000});
  assert.equal(validateGoal(s.profile,s.profile.paths[1]!,s.proposals.proposals[1]!.goal),null);
});
test('absolute WPR refuses invalid default and aliased mappings before approval',()=>{
  const s=scenario();const p=s.profile.paths[1] as Extract<Path,{adapter:'cartesian_absolute_wpr'}>;
  p.fields.defaultVelocityMmS=2001;assert.equal(profileSchema.safeParse(s.profile).success,false);
  p.fields.defaultVelocityMmS=25;p.fields.rotation[0]=p.fields.position[0];assert.equal(profileSchema.safeParse(s.profile).success,false);
});
test('calibration change still blocks all declared FANUC paths with original approval',async()=>{
  const s=scenario();const approval=approveProfile(s.profile,'offline-reviewer','2026-09-16T03:00:00Z',now);
  const calibration=s.observation.facts.find(f=>f.id.includes('calibration'))!;assert.ok(calibration);calibration.value='f'.repeat(64);
  const report=await evaluateProfile({...s,approval,now});
  assert.ok(report.results.every(r=>r.decision==='WOULD_BLOCK'));assert.equal(report.controllerGoalsAttempted,0);
});
