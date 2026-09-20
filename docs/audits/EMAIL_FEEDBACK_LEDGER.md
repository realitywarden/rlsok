# RLSOK email feedback ledger

Audit date: 2026-08-31 (Asia/Shanghai)

Audited runtime baseline: `6ed21e2969272d857f19eb1ae5d91065205d7d9e` (merged PR #21)
Closure artifacts: this feedback-closure branch; exact merge SHA is recorded after review

Latest local targeted-review baseline:
`31a3c046a9687a1661423d676564e66967ea8b50`; frozen Runtime v1.4.5
candidate `4e9b188a78ff1a770f6333097aec0b418773da88` remains unchanged.

External-validation reply update: 2026-08-31 (Asia/Shanghai). The ledger records
conceptual validation separately from an actual code, secured-graph, or Shadow
run so that a positive reply cannot silently close a stronger external gate.

## Method and classification rule

The connected Gmail account was searched with `in:anywhere`, including Spam
and Trash, for RLSOK, ROS/robot, execution/authorization, configuration,
controller, runtime/provenance, DDS, CANopen, RMF, MAVROS, Nav2, teleoperation,
and fault terms. The original search covered all mail through 2026-08-28. The
2026-08-31 targeted delta used the supplied review artifact's Elite and SCHUNK
maintainer-reply summaries; it does not infer a claim from a subject or snippet.

Feedback determines what to inspect, not what to believe. Status is assigned
from reproducible RLSOK code, tests, and architecture, not the sender's role,
tone, or authority.

Status totals (40 meaningful replies):

| Status               | Count |
| -------------------- | ----: |
| IMPLEMENTED                                   |    16 |
| REFERENCE-CONTRACT; EXTERNAL TEST OPEN        |    11 |
| CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN      |     8 |
| EXTERNAL-TEST-DEFERRED (no generic invariant) |     4 |
| OUT-OF-SCOPE                                  |     1 |

Shared implementation evidence used below:

- configuration identity/provenance: `packages/core/execution-configuration.ts`
  and `tests/releasegate/configurationProvenance.test.ts`;
- capability/freshness/continuity: `packages/core/runtime-attestation.ts` and
  `tests/releasegate/runtimeAttestation.test.ts`;
- fail-closed execute-time refresh, single-use Permit, and Shadow zero-dispatch:
  `packages/core/execution-gate.ts`, the two test files above, and
  `tests/ros2-reference/ros2Reference.test.ts`;
- selected observed-state continuity and the no-stop execution boundary:
  `packages/adapter-references/capabilities.ts`,
  `tests/releasegate/runtimeAttestation.test.ts`, and the ROS 2 reference files;
- fleet boundary: `docs/FLEET_OTA_AUTHORIZATION_BOUNDARY.md`;
- UR5e and Husarion references: `packages/robot-integrations/`,
  `packages/husarion-rosbot-gazebo/`, and matching tests under
  `tests/robot-integrations/`.
- signed, bounded, network-free edge authorization:
  `packages/edge-authorization/snapshot.ts` and
  `tests/edge-authorization/snapshot.test.ts`;
- DDS trust, degradation/capability, GOLEM, inference provenance, and selected
  integration contracts: `packages/adapter-references/`,
  `examples/adapter-references/`, `tests/adapter-references/references.test.ts`,
  and `docs/FEEDBACK_ADAPTER_REFERENCE_CONTRACTS.md`.

## Reply ledger

The Gmail message ID is included so every row can be traced to the exact
reviewed reply without publishing private message bodies or email addresses.

| ID  | Sender / project and date                                                            | Concrete claim and suggested invariant                                                                                                                                                                                                                  | Reproducible / architecture relevance                                                                | Current RLSOK coverage and status                                                                                                                                                                                                       | Recommended action, boundary risk, and later Shadow value                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01 | QuanRobotics — 2026-07-27 — Gmail `19fa15b27c5324ba`                                 | A useful release boundary combines artifact, action contract, robot/controller profiles, approval, expiry/revocation, and Evidence; start with simulated Shadow.                                                                                        | Architecture-relevant but not a defect report.                                                       | Core release, Permit, binding, Evidence, and Shadow paths cover the claim. **EXTERNAL-TEST-DEFERRED**: no Quan-specific invariant or test environment was supplied.                                                                     | Offer the documented public Zero-to-Shadow path later. Do not add a Quan integration. High external Shadow value.                                                                                                            |
| E02 | Ekumen / LeKiwi — 2026-08-03 — Gmail `19fc7a71c81de4e8`                              | The described workflow was hard to distinguish from ordinary deployment; a small E2E demo would clarify it.                                                                                                                                             | Repeated, objective public-comprehension evidence.                                                   | Deployment-vs-execution demo and public explanation are code-complete. **CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN** under the Class A/B protocol.                                                                                     | Keep the concrete revoked-after-deployment example and external protocol. A LeKiwi integration is not justified. Medium Shadow-review value.                                                                                 |
| E03 | General Axis Robotics — 2026-08-15 — Gmail `1a0078e848bdc8e2`                        | Rechecking an exact software/configuration state for a particular vehicle immediately before operation may fill a fleet/OTA gap and must sit separately from fleet control and functional safety.                                                       | Architecture-relevant; no reproducible product defect.                                               | Fleet boundary and device/configuration binding match. **EXTERNAL-TEST-DEFERRED** until an actual fleet release architecture exists; fabricating one would broaden scope.                                                             | Recontact only for a real Shadow evaluation when their release architecture exists. Avoid fleet-management or safety expansion. High external value.                                                                         |
| E04 | Denis Stogl / ros2_control — 2026-08-16 — Gmail `1a009f585690b6e6`; follow-ups through 2026-08-27; new reply 2026-09-19 `1a0b961863ae7d46`; closure sent `1a0bd9852bab668d` | Earlier discussion produced useful lower-level provenance questions, but the new reply rejects the current general framing as a non-existent real-world problem and says it usually cannot be checked automatically. | Strong negative comprehension and problem-validation evidence. It invalidates any broad inference that a generic ros2_control-adjacent hardware check is wanted or automatically feasible; it is not a code review. | Local Check already limits itself to selected files/exports and states that file/graph matches do not prove hardware identity. The public contributor entry describing earlier conceptual confirmation was removed so a historical opt-in is not presented against the sender's current position. **SCOPE/COPY CORRECTED; NO ROS2_CONTROL INTEGRATION**. | The one-time reply acknowledged the over-broad question, confirmed the source/site correction, and closed the request. Do not ask for hardware, add a ros2_control integration, or claim endorsement/support. Only a future system owner with a concrete observable mismatch and exporter could justify a narrowly bounded adapter. |
| E05 | Lovro Ivanov / ros2_canopen — 2026-08-17 — Gmail `1a00ee20e02224cb`                  | Do not bind policy directly to volatile CAN Node IDs by default. A bus-specific monitor should expose authenticated topology/NMT/capability state; RLSOK should stay bus-agnostic.                                                                      | Reproducible architecture guidance.                                                                  | The selected-identity fixture binds stable mapping/EDS-DCF and capability while excluding raw Node ID. **REFERENCE-CONTRACT; EXTERNAL TEST OPEN** against ros2_canopen.                                                               | Exercise the fixture with authenticated topology/NMT evidence. Core remains CANopen-agnostic. Medium Shadow value.                                                                                                           |
| E06 | Rune Søe-Knudsen / Universal Robots — 2026-08-17 — Gmail `1a00faa2ac0b2f94`; attribution opt-in `1a04266affd78a98` | The scaled trajectory controller advances trajectory progress according to reported speed scaling; near-zero scaling stalls progress, not a special “zero target = skip” branch. URSim is the closest no-hardware stand-in. | Directly reproducible against the official driver/URSim. | UR5e integration binds the scaled controller and official-driver tests cover mock/reference behavior. No Core assumption depends on a zero-target skip. **IMPLEMENTED**. | Preserve wording that Shadow omits dispatch rather than sending a zero goal. Public attribution uses Rune's exact approved display name, organization, URL and contribution wording, with an explicit no-endorsement boundary for both Rune and Universal Robots. URSim/physical validation remains reference evidence, not a new feature. High external validation value. |
| E07 | Luis Camero / Clearpath — 2026-08-17 — Gmail `1a00fcb1189cbf75`                      | Generated launch/configuration and installed dependency versions establish the execution baseline; the reply initially could not tell whether RLSOK was runtime or pre-execution.                                                                       | Technical provenance guidance plus comprehension evidence.                                           | Clearpath fixture binds `robot.yaml` plus generator identity/version and excludes incidental output. **REFERENCE-CONTRACT; EXTERNAL TEST OPEN**; comprehension also awaits a real retest.                                            | Public copy says “immediately before dispatch.” Exercise the fixture in a real generated workspace; no Clearpath support claim yet. Medium Shadow value.                                                                      |
| E08 | Husarion Support — 2026-08-17 — Gmail `1a00fce17d82288a`; follow-up context 2026-08-26 | The initial Webots/Shadow ask was not understandable; Husarion officially supports Gazebo, not its old Webots path. Later Webots/ros2_control guidance raised lower-level runtime/API compatibility only as a speculative generic concern. | Reproducible comprehension and support-matrix correction; the later point is generic provenance guidance, not Webots validation. | Official Gazebo reference and DDS readiness regression remain complete. The generic runtime compatibility reference covers the speculative concern without changing the support matrix. **CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN** for first-time comprehension. | Keep Webots out of the official Husarion claim and use the human protocol. No extra robot integration and no validation claim from speculative guidance. High comprehension value. |
| E09 | Loke Ji Xian / Open-RMF — 2026-08-18 — Gmail `1a013def8808fec7`; attribution declined `1a04242622e331ca` | Fleet adapters consume served state; reconnect/stale state is not a distinct robot-command authorization semantic and can remain indistinguishable without extra freshness. | Architecture-relevant and reproducible at adapter boundaries. | Core state freshness, attestation freshness/continuity, and `docs/FLEET_OTA_AUTHORIZATION_BOUNDARY.md` put RLSOK below RMF. **IMPLEMENTED** / boundary validated. | Not an RMF feature backlog. A future adapter may translate trusted fleet/robot freshness into attestation, but RLSOK must not duplicate RMF. Loke Ji Xian declined public attribution and must not be added to contributor data or pages. Medium Shadow value. |
| E10 | Keai Jiang Chee / Open-RMF — 2026-08-18 — Gmail `1a013e41d631e581`                   | RMF task award plus fleet-adapter acceptance is its execution authority; bidding/traffic feasibility does not separately ask if this robot release may act now.                                                                                         | Confirms the product boundary.                                                                       | RLSOK explicitly sits below task/fleet planning and retains robot-command authorization. **IMPLEMENTED** / boundary validated.                                                                                                          | No Open-RMF integration or feature backlog. Retain as external architectural validation.                                                                                                                                     |
| E11 | Husarion Support — 2026-08-18 — Gmail `1a013f05fd778ebd`                             | `cmd_vel` is the representative ROSbot base command path for a simple pre-controller authorization demonstration.                                                                                                                                       | Reproducible with the official Gazebo stack.                                                         | Husarion ROSbot Gazebo package, example, tests, and CI workflow implement zero-dispatch Shadow and run-mode publication checks. **IMPLEMENTED**.                                                                                        | Maintain the existing reference only; no new robot integration. High external rerun value.                                                                                                                                   |
| E12 | Luis Camero / Clearpath — 2026-08-18 — Gmail `1a01528d440d99d0`                      | Deterministic generated artifacts can be represented by `robot.yaml` plus exact generator package versions; hashing every regenerated output is unnecessary.                                                                                            | Generic deterministic-provenance invariant.                                                          | v2 `generated` provenance binds input digest plus generator identity/version; tests prove canonical binding and drift denial. **IMPLEMENTED**.                                                                                          | A future Clearpath adapter may collect these explicit inputs. Do not auto-bind formatting/generated metadata. Medium Shadow value.                                                                                           |
| E13 | Okan Demir / Nav2 docking — 2026-08-18 — Gmail `1a013ef56d3cdd10`                    | Willing to inspect whether RLSOK aligns with docking, but supplied no concrete invariant.                                                                                                                                                               | Not a generic defect; potential external evaluation only.                                            | Generic action/configuration binding exists. **EXTERNAL-TEST-DEFERRED** because no docking-specific invariant was supplied; no speculative integration is justified.                                                                 | Recontact only with the public protocol and a narrowly scoped simulated Shadow result; do not add Nav2 docking now. Medium external value.                                                                                   |
| E14 | Tetsu Yamaguchi / Nav2 — 2026-08-18 — Gmail `1a0163b4347d9b17`; follow-up and attribution opt-in 2026-08-30, message ID not supplied in development delta | The original limits/controller distinction was refined: feedback mode, smoothing semantics, CLOSED_LOOP odometry binding, resolved command-path topology, and per-goal FollowPath selectors can change execution while numeric limits remain unchanged. OPEN_LOOP uses prior command state rather than measured motion. | Concrete future-adapter authorization invariants, version-specific to the actual Nav2 action/parameter definitions; not a review of RLSOK implementation. | Runtime v1.4.5 dispatches only strict `FollowJointTrajectory` proposals and has no Nav2 `FollowPath` adapter, so there is no current selector bypass. The earlier limits-only reference was incomplete and is now narrowed to a Jazzy-specific selected semantics/source/topology/selector contract. **REFERENCE-CONTRACT CORRECTED; NAV2 INTEGRATION NOT IMPLEMENTED**. | Do not add speculative Nav2 execution support. A future adapter must bind exact pre-dispatch selectors and prove semantic/source/topology drift denial in simulation. Attribution is opt-in, identifies Engineering Assurance Layer only as an adjacent tool, and explicitly states no implementation review or endorsement. The invitation to audit that tool is a separate possible follow-up. |
| E15 | Aarav Gupta / omni-wheel controller — 2026-08-19 — Gmail `1a01727fd8d86cd6`          | The original release/controller-binding explanation was not understandable without a concrete example.                                                                                                                                                  | Repeated comprehension evidence.                                                                     | Merged public copy has the revoked-release example and explicit boundary. **CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN**.                                                                                                                | Use this profile for the later first-time human test, not as grounds for an omni-wheel integration. High comprehension value.                                                                                                |
| E16 | Max-Bin Wang / CARLA-Autoware — 2026-08-20 — Gmail `1a01a9d98b2b27f5`                | Bind stable command semantics, adapter/controller identity, limits and frame contract; keep simulator actor/map/weather and other environment noise outside execution identity.                                                                         | Generic provenance/semantic boundary.                                                                | v2 semantic contract and provenance bind the stable facts while observation/environment values are excluded from the digest. **IMPLEMENTED**.                                                                                           | No CARLA/Autoware integration. A future adapter can materialize the stable contract. Medium Shadow value.                                                                                                                    |
| E17 | Aditya Jindal / ROS lifecycle — 2026-08-20 — Gmail `1a01b7582aae03b6`                | Lifecycle ERROR can require fresh execution authority because internal state is invalidated even if endpoints recover; FAILURE may roll back to known state.                                                                                            | Generic continuity/capability input, but classification belongs to the lifecycle adapter.            | Attestation continuity, source identity, freshness, and capability checks fail closed before dispatch. **IMPLEMENTED** at Core level.                                                                                                   | Future lifecycle monitor decides the classification and changes continuity/capabilities. RLSOK must not become the lifecycle manager. Contributor opt-in recorded; no support implication. Medium Shadow value.                                                                   |
| E18 | Martin Huber / KUKA LBR FRI — 2026-08-20 — Gmail `1a01f4d8886d61a2`                  | The initial question was unclear; architecture separates robot/joint-limit inputs from FRI system configuration before generating URDF.                                                                                                                 | Comprehension evidence plus a source graph.                                                          | v2 represents selected generated/content provenance and public boundary changed. **CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN**; no KUKA support claim.                                                                                | Retest public wording; no KUKA integration. Medium comprehension value.                                                                                                                                                      |
| E19 | Martin Huber / KUKA LBR FRI — 2026-08-22 — Gmail `1a028b3608105534`                  | Final robot description is hardware source of truth; controller parameters are also execution-relevant and may change online.                                                                                                                           | Generic configuration and runtime-observation invariant.                                             | v2 content/generated provenance plus controller identity/digest and execute-time configuration refresh cover it. **IMPLEMENTED**.                                                                                                       | A future KUKA adapter selects sources; no Core or robot integration now. Medium Shadow value.                                                                                                                                |
| E20 | Bartosz Burda / ros2_medkit — 2026-08-21 — Gmail `1a02335611359a4a`; follow-up 2026-08-27 | Fault cleared is not capability restored. The fault/degradation system owns classification and available capabilities; RLSOK consumes that state for the next command. The follow-up conceptually confirms this ownership boundary. | Exact match to a generic Core authorization input; conceptual confirmation, not an implementation review. | `requiredCapabilities`, execute-time refresh and the runnable degradation reference prove cleared-without-capability blocks and fresh restored capability may pass. **IMPLEMENTED; EXTERNAL CONCEPT VALIDATED**. | External ros2_medkit classification mapping remains an owner test; RLSOK is not the fault manager. Contributor opt-in is recorded as independent feedback with no integration or support claim. High Shadow value. |
| E21 | Deep Patel / Dual YAM teleop — 2026-08-21 — Gmail `1a024bb9799e80a0`                 | The outreach did not make sense and appeared generated; no technical boundary could be evaluated.                                                                                                                                                       | Objective comprehension evidence; speculation about authorship is not a requirement.                 | Product explanation and protocol are corrected. **CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN**; authorship speculation creates no technical backlog.                                                                                   | Test understanding with a real person. Do not add YAM teleop or respond to the authorship speculation as a product feature. High comprehension value.                                                                        |
| E22 | Ivan Perez Dominguez / Ogma-Space ROS — 2026-08-21 — Gmail `1a02422a456b9004`; attribution declined `1a0447c26e6bb561` | Compile-time provenance versus runtime recheck was not clear. | Objective comprehension evidence. | v2 and merged public copy separate compile/deploy facts from dispatch-time recheck. **CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN**. | Keep compile/deploy/run sequence explicit in the human protocol. No Ogma integration. Ivan Perez Dominguez declined attribution for both himself and the project and must not be added to contributor data or pages. High comprehension value. |
| E23 | Alex and Alisa / SO-ARM101 — 2026-08-21 — Gmail `1a0238e6eccc71c9`; validation `1a038459178f828d` | Stable USB serials assign leader/follower roles independent of port number; with multiple same-role arms, calibration should bind to device serial. They later confirmed serial → role → calibration is their source of truth: USB port changes do not invalidate, while reassigning a physical serial to a different role should. | Generic physical-identity and calibration provenance invariant; external conceptual validation. | v2 device/robot identity plus calibration content provenance binds the stable mapping without binding volatile USB ports. **IMPLEMENTED; EXTERNAL CONCEPT VALIDATED**. They explicitly did not review the actual code. | Preserve the generic fixture and no-support boundary. An actual code/Shadow review remains useful before any support claim; no SO-ARM integration. Medium Shadow value. |
| E24 | Max Conway / CorrellLab GOLEM — 2026-08-21 — Gmail `1a0262287140648b`; meeting request 2026-08-27 `1a0406eea949903b`; material request sent `1a0bd8575e2d03f2` | Upper-body motor/capability state, including contact/caught conditions, should be checked before a new H12 motion. The latest reply expresses interest and requests a real-time technical conversation but supplies no new invariant. | Adapter-owned live evidence; Core must not infer it from raw motors. The conversation request opens review/test-bed discussion only. | Runnable normalization maps only the external verdict to `upper_body.motion_ready`; review inputs, examples and questions are documented. **REFERENCE-CONTRACT; EXTERNAL TEST OPEN**; RLSOK never infers contact/caught state. | The reply asks for the exact public GOLEM commit/branch, H12 launch/config, adapter-owned `/lowstate` verdict fields, final command boundary, ROS/OS versions and a zero-command real/simulated test path, plus time windows for the requested call. Await those materials; do not infer contact from raw motors or add public attribution without consent. High external Shadow value. |
| E25 | Erik Boasson / CycloneDDS — 2026-08-21 — Gmail `1a024e427026d74b`; validation `1a0394e14caa6912` | DDS GUIDs change when entities are recreated, ROS identities can be spoofed, and authenticated DDS Security is needed before treating them as trust evidence. The follow-up confirms that trust should be scoped to the command-critical path, unrelated participants should be ignored, and raw graph names/GUIDs are insufficient. | Generic trust-boundary guidance; vendor/RMW extraction is not portable Core behavior.                | Command-path contract refuses raw GUID/name trust and requires authenticated middleware proof. **REFERENCE-CONTRACT; EXTERNAL CONCEPT VALIDATED; EXTERNAL TEST OPEN** for CycloneDDS extraction. The actual code and a secured graph were not independently tested. | Never use raw GUID alone as durable approval identity. Do not turn RLSOK into DDS security. High negative-test value.                                                                                                        |
| E26 | Yan Xiaojia / Elite Robots CS — 2026-08-21 — Gmail `1a023addb448bc28`; follow-up 2026-08-31, message ID not supplied in review artifact | Exact reported model is sufficient for CS63→CS66 detection and does not require another physical controller identifier. Same-model unit continuity would require a trustworthy unique hardware identifier. Controller software is distinct from driver/SDK and matters only if explicitly selected inside the execution boundary. | Concrete clarification of one future Elite adapter boundary; conceptual validation, not code or physical observer review. | The reference already selects exact model plus driver/SDK and does not require a controller hardware ID. Focused generic-v2 tests now prove model and driver drift deny before fake dispatch while unselected serial/controller-software observations do not invalidate. **REFERENCE-CONTRACT; EXTERNAL CONCEPT VALIDATED; EXTERNAL TEST OPEN** for a truthful Elite-owned model observer. | Keep driver/SDK as the independent approved software invariant. Do not require serial or controller software under the present claim, fabricate an observer, claim Elite support, or infer public-listing consent. |
| E27 | Ruddrho Mollik / vision-guided color sorting — 2026-08-21 — Gmail `1a023bc0de26885e` | Camera calibration, robot-camera transform, workcell setup, and object/bin mapping can change the meaning of an unchanged arm command.                                                                                                                  | Generic configuration-provenance claim.                                                              | v2 calibration/frame digests and explicit content provenance can represent these selected, security-critical inputs. **IMPLEMENTED**.                                                                                                   | Integrators choose explicit sources; do not absorb perception or workcell validation into Core. Contributor opt-in recorded; no code-review, integration, endorsement, or support claim. Medium Shadow value. |
| E28 | Atsushi Kuwagata / CRANE-X7 — 2026-08-21 — Gmail `1a023bd77ddc0fe2`; follow-up 2026-08-27 | URDF owns hardware limits, MoveIt owns planning constraints, ros2_control owns hardware-drive limits, and actuator encoders/controller own current posture; blindly hashing all together causes false invalidation. The maintainer believes the selected source split is correct but is not familiar enough with RLSOK internals to review implementation details. | Generic separation of selected approved configuration from runtime state; conceptual confirmation, not code review or external test validation. | v2 provenance/limits bind only selected stable sources; MoveIt is conditional on approved planner-dependent semantics, while RuntimeAttestation/state freshness handles selected current posture without freezing it into approval identity. **IMPLEMENTED; EXTERNAL CONCEPT VALIDATED**. Actual reference fixture/Shadow validation remains open. | Contributor opt-in confirmed as Atsushi Kuwagata, RT Corporation, `https://rt-net.jp`. Do not imply endorsement, partnership, certification, code review, CRANE-X7 integration or support. A real fixture/Shadow run remains open. High Shadow value. |
| E29 | Wenjie / BXI — 2026-08-21 — Gmail `1a024a02e6d64a86`                                 | Policy artifact and controller/config changes are primary invalidators; inference dependencies such as PyTorch/NumPy/custom libraries may matter, but whole-environment churn should not dominate.                                                      | Generic explicit-dependency provenance rule.                                                         | ExecSpec binds policy artifact and the collector emits only explicit Python/PyTorch/NumPy/custom/CUDA declarations with stable digest and mismatch denial. **IMPLEMENTED**.                                                          | Integrators own the allowlist. Whole-environment hashing and default `pip freeze` remain intentionally excluded. High Shadow value.                                                                                          |
| E30 | Mavis Murdock / Gen3 Lite teleop — 2026-08-23 — Gmail `1a02ff555f3f3ff1`             | The recipient was unsure whether RLSOK meant training then executing a policy and could not place it in teleoperation; no technical placement was validated.                                                                                            | Late/spam-routed comprehension evidence.                                                             | Public copy now says robot-software execution authorization at the command boundary. **CODE/DOC-FIXED; EXTERNAL VALIDATION OPEN**.                                                                                                    | Recontact after supplying only the public page and protocol. Do not add Gen3 Lite integration. High comprehension/Shadow value.                                                                                              |
| E31 | Xiaoyang / DDS robustness — 2026-08-23 — Gmail `1a02e89b463beb64`; validation `1a0394e14caa6912` | Release/config validity and DDS trust are separate. Unrelated rejected traffic must not globally deny execution; stale/untrusted command-critical actuator paths must fail closed. The follow-up confirms command-critical scoping and authenticated evidence while rejecting raw graph names/GUIDs as sufficient trust. | Generic Core signal shape plus middleware-specific evidence source.                                  | Scoped contract and Fast DDS Security fixture ignore unrelated participants and fail closed on unproven command-path trust. **REFERENCE-CONTRACT; EXTERNAL CONCEPT VALIDATED; EXTERNAL TEST OPEN** for a real secured graph. The actual code was not independently tested. | Keep extraction outside Core; do not overstate portable RMW trust. High scoped-failure Shadow value.                                                                                                                        |
| E32 | Jun Wei / BlueROV2/Subcat — 2026-08-24 — Gmail `1a031b73a480a2c6`                    | Final authorization belongs immediately before MAVROS RC/serial-servo output; approval may bind solver artifact, mappings, limits and namespace. The hardware write path must not make blocking network calls; use fresh cached/signed local authority. | Reproducible generic command-boundary gap plus adapter-specific identity selection.                   | Ed25519 bounded snapshot and network-free single-use boundary bind release/action/config/device/controller/freshness/revocation and return exact Evidence identity. Invalid/stale/changed authority is zero-dispatch. **IMPLEMENTED**. | Refresh stays outside the hardware callback; no BlueROV driver, retry, stop or zero fallback was added. High Shadow value.                                                                                                  |
| E33 | Fourier Intelligence — 2026-08-14 — Gmail `19fff79a84664dbc`                         | Their team understood approval binding, pre-dispatch recheck, and Evidence and invited a GR-3 Shadow compatibility discussion, but supplied no reproducible invariant.                                                                                  | External-interest evidence only.                                                                     | Generic path exists. **EXTERNAL-TEST-DEFERRED** because no GR-3 invariant or environment was supplied; adding a humanoid integration would be unjustified.                                                                          | Recontact only for a scoped Shadow evaluation after public comprehension testing. Do not add a humanoid integration. High external value.                                                                                    |
| E34 | Gradisen — 2026-08-14 — Gmail `19ffcf305b4a15f4`                                     | Without a production robot-controller release workflow, the deployment-versus-execution gap cannot yet be assessed.                                                                                                                                     | Valid stage-fit feedback, not an RLSOK defect.                                                       | RLSOK is premature for this workflow. **OUT-OF-SCOPE**.                                                                                                                                                                                 | No implementation or follow-up until a release/dispatch workflow exists. Acting now would broaden into deployment consulting. Low current Shadow value.                                                                      |
| E35 | AD-R1M — 2026-08-26 — Gmail `1a0394da03eba739`                                      | The base Xacro is the stable robot description; simulation Xacro adds Gazebo plugins/control. Motor drives, sensors, structure, joints, controller interfaces, and command semantics should remain consistent, while worlds, visuals, plugins, and simulated sensors are environment-specific. | Generic selected-provenance and semantic-boundary validation.                                        | v2 content/generated provenance and semantic contract bind explicitly selected stable robot/controller facts while excluding incidental simulator environment. **IMPLEMENTED; EXTERNAL CONCEPT VALIDATED**. | Preserve the generic boundary. The reply supplies no machine-readable AD-R1M collector and does not justify a robot integration. Medium Shadow value.                                                                          |
| E36 | Unity simulator semantics — 2026-08-26 — Gmail `1a03948594550267`                   | Interface name/type is insufficient when value meaning changes, including IMU sign or timing semantics. Semantic revision should be scoped per interface; useful evidence distinguishes requested URDF, measured realization, per-interface semantics, and build fingerprint. The upstream project currently offers only coarse simulator-version plus release-note/commit identity. | Generic explicit semantic/dependency provenance rule; no upstream machine-readable extractor exists. | Existing v2 selected provenance plus the generic physical-execution-identity reference binds only the interface semantics an approval consumes. A selected semantic change invalidates; an unrelated interface change does not. **IMPLEMENTED; EXTERNAL CONCEPT VALIDATED**. | Keep selection explicit and adapter-owned. A future extractor remains external until upstream exposes reproducible semantics; do not add a Unity integration. Medium Shadow value. |
| E37 | Bobby Larson / Ganglion — 2026-08-27 — Gmail message ID not supplied in development delta | Periodic/eventual capability-policy sweeps are insufficient for queued physical motion. Queued intent is not in flight and must use dispatch-near exact command/target, configuration/policy/revocation epoch, short-TTL and single-use authority. Controller-accepted execution begins the outside boundary; stopping it is a controlled-stop/safety responsibility. A selected observed-state epoch was proposed as the remaining TOCTOU concern. | Generic last-mile authorization audit, not an integration or endorsement claim. | Exact action/target, refreshed release/configuration eligibility, TTL and single-use were already implemented. The existing execute-time refreshed `RuntimeAttestation` continuity token already represents an explicitly selected adapter-owned state epoch; the new generic normalization, Evidence-focused regressions and no-stop ROS boundary make that contract explicit. **REFERENCE-CONTRACT; EXTERNAL TEST OPEN** for integration-owned state facts. | Do not add a duplicate epoch or hash raw state/world data. An adapter rotates continuity only for selected execution-relevant transitions; unrelated observations do not globally invalidate. Validate the selected classifier externally. High negative/TOCTOU Shadow value. |
| E38 | Motty / CRANE+ — 2026-08-27 — Gmail `1a043130a2c6f9d2` | Execution-critical launch choices can be worth including in the approved setup, but reproducing all launch/runtime conditions inside the execution guard creates source-code mirroring and dual-maintenance risk. | Generic selected launch-semantics boundary; personal developer feedback, explicitly not an RT Corporation view. | Existing v2 selected provenance can bind the smallest stable launch inputs that choose mock, simulation, or real hardware paths. No Core or authorization behavior change is required. **REFERENCE-CONTRACT; EXTERNAL TEST OPEN**. | Do not mirror the full Python launch graph or runtime configuration and do not treat this as a CRANE+ feature request, integration, validation, RT Corporation position, or endorsement. |
| E39 | Chinedu / Lidarbot — 2026-08-27 — Gmail `1a04267aeadf6c06` | The `ros2_control` hardware component, drive controller, and wheel mapping form a useful minimum boundary for confirming how commands reach the motors. | Generic selected execution-binding guidance for a mobile base. | Existing v2 provenance can bind those integration-owned configuration identities without adding a Core field or runtime capability. **REFERENCE-CONTRACT; EXTERNAL TEST OPEN**. | Do not add a Lidarbot integration or infer validation. The sender's questions about remote deployment, safety, and cybersecurity are not validated claims or feature requests; RLSOK remains execution authorization, not functional safety or a generic cybersecurity product. |
| E40 | Harry Arnst / SCHUNK SVH — 2026-08-31 — message ID not supplied in review artifact | The SVH driver has little user configuration; `schunk_svh_driver/cfg/schunk_svh_driver.yaml` is the main candidate to inspect. | Useful inspection pointer, not proof that every YAML field is authorizing or that YAML is the complete execution setup. | Official source review at driver commit `d7115d099e86dd3d2de7d8f9a7295c6796ce7596` found a minimal selected controller/side, joint mapping, partial-goal, interface and timing projection. Firmware-selected current/position/homing settings live outside the YAML. Existing v2 provenance represents these facts; a focused reference and fake-dispatch regression were added without an adapter. **REFERENCE-CONTRACT; EXTERNAL TEST OPEN**. | Do not hash the whole YAML or bind raw `/dev/ttyUSB*`. Validate the selected projection, firmware observer and command path in an official fake/simulated graph before any SVH support statement. The reply is not public attribution consent. |
| E41 | Daniel Palander / PF999 Robotics — 2026-09-19 — Gmail `1a0bb44777e4de46`; release/material reply sent `1a0bd982e3588544` | One bounded grasp-and-hold authorization may permit local grip redistribution and small contact corrections. Measurable slip outside a declared envelope ends the operation; local control measures and responds, independent safety owns force/stopping, and a new check is required before another operation. Reviewed perception configuration, reference-observation digests and expected temporal transitions may be saved inputs without making RLSOK the live visual interpreter. | Generic, reproducible saved-contract requirement. Hardware thresholds, geometry, sensing and the classifier remain intentionally undisclosed and cannot be implemented or validated by RLSOK. | `bounded-operation` selected-input inspection validates task validity, ownership, allowed adjustments, terminating conditions, threshold shape, optional perception configuration, reference digests and temporal-state transitions. The normal saved-setup baseline/review flow detects later file changes. It sends no hardware signal. **IMPLEMENTED AND PUBLISHED; HARDWARE-SPECIFIC MATERIAL OPEN**. | Local Check 1.5.4, its cross-platform downloads and guide were sent. The reply requests only redacted actual controller/calibration/perception exports, envelope-exit signal/units/threshold form, runtime version and a zero-command PF999 test path. Await those materials; do not request internal geometry or sensing implementation or claim slip detection, classifier correctness, physical integration or safety. |
| E42 | Yasiru Fernando / Dobot Magician — 2026-09-20 — Gmail `1a0bd7712b80193d` | After receiving the exact material list, the sender committed to provide a small public repository containing the homing service, launch/config files, startup checks, one redacted request, the exact commit, ROS 2 distribution and OS within one or two days. | This is a concrete path from the released saved-input recipe to an independently reviewable, hardware-owner-supplied interface. It supplies no new implementation fact yet. | The generic Dobot saved-input review is already published; no homing call, joint/Cartesian command or physical-distance validation is claimed. **MATERIALS PROMISED; WAITING**. | Do not send another reminder now. When the exact public commit and files arrive, map them into a read-only review, return the proposed mapping before asking for any run, and keep physical homing/motion outside the claim until the owner supplies controlled real-arm evidence. |

## Feedback closure audit

### BlueROV2 / Subcat

**A — representability:** yes, with an adapter. v2 can bind robot/device,
logical command endpoint, controller implementation/version, mappings,
`limitsDigest`, and provenance. `solver_id` may be an explicit software source;
the generated solver may be a `generated` source (input digest plus generator)
or content digest. RC/servo mapping, MAVROS namespace, serial configuration,
and selected limits must be projected into a stable adapter-owned content or
semantic digest; incidental observations must not be copied into identity.

**B — synchronous Cloud at the hardware boundary:** the original
`CloudConnectedDispatchBoundary` still performs Cloud work and must not be put
inside a hard write callback. `packages/edge-authorization/snapshot.ts` now
provides the alternative: an Ed25519 issuer/refresh path outside the callback
and bounded local verification immediately before one dispatch.

**C — ownership:** the snapshot binds release content, action, configuration,
device, controller, issue/expiry time and revocation epoch. Unknown key,
invalid signature, rollback epoch, stale/future time or changed binding fails
closed with zero dispatch. The boundary is single-use, has no Cloud dependency,
retry, stop or zero fallback, and returns exact snapshot/version/digest fields
for Evidence. BlueROV/MAVROS identity selection remains adapter-owned; no
BlueROV driver was added.

### DDS command-path trust

Core's normalized contract is sufficient if an authenticated adapter supplies:

- source `kind`: `dds-security-monitor` (vendor/version recorded);
- required capability: `dds.command_path.trusted` for the configured logical
  actuator path;
- continuity token: a stable digest of the authenticated expected actuator
  peer/endpoint/session set, not a raw unauthenticated GUID;
- fresh `observedAt`.

An unrelated rejected participant must not remove the scoped capability. Loss
of the expected actuator endpoint, stale trust, failed authentication, or an
untrusted command-critical peer removes it (or makes attestation unavailable),
which Core already fails closed. The runnable Fast DDS Security fixture proves
the scoped normalization and refuses raw GUID/name trust. It preserves
`unknown` for missing or insufficient proof and `untrusted` for an explicit
command-path rejection; both emit no trusted capability. Participant
authentication without enforced governance and validated path permissions also
remains `unknown`, not trusted. A real secured Fast DDS graph and CycloneDDS
extraction remain external tests; RLSOK does not authenticate DDS traffic or
claim portable RMW rejection reasons. The follow-up conceptually validates the
path-scoped design, not the code or a secured-graph run.

### Selected interface semantics and physical execution identity

Version 2 already hashes the selected semantic contract and selected provenance
for one approval. The generic reference makes the selection boundary explicit:
base robot description, actuator/sensor configuration, controller interfaces,
command semantics, and execution-relevant runtime/software/configuration facts
may be selected. A consumed IMU sign/timing contract is therefore an
interface-scoped provenance source; changing it invalidates that approval even
when topic, type, controller/action interface, and URDF are unchanged. An
approval that does not consume the IMU omits that source, so the same unrelated
change does not globally invalidate it.

The same rule applies below unchanged ros2_control and hardware_interface APIs.
Lifecycle, resource, timing, or failure-behavior changes invalidate approval
unless the integration explicitly qualifies and emits a stable compatibility
envelope. Simulator worlds, visuals, incidental plugins, and unrelated
environment noise are excluded by default. The AD-R1M and Unity replies support
this generic boundary only; neither creates a vendor integration or support
claim. The Webots/ros2_control point remains speculative guidance, not external
validation.

### Queued command and selected observed-state epoch

The audit found no missing Core/schema epoch. A Permit already binds the exact
action hash, release, device/target, controller and selected configuration; it
is short-lived and consumed before execute-time checks. Immediately before
dispatch, Core refreshes the release record, configuration and any required
`RuntimeAttestation`. An adapter that selects execution-relevant state uses the
existing continuity token as its bounded state epoch and exposes a required
capability. Changed continuity, missing/stale observation, or unknown/not-ready
capability records a specific zero-dispatch Evidence reason. A newer timestamp
or an unselected capability change remains eligible, so unrelated sensor noise
does not become global invalidation.

The ROS 2 reference did contain a separate boundary defect: revocation tried to
cancel a previously accepted goal. That cancel IPC and call path were removed.
Revocation now prevents only a new dispatch. Controller-accepted execution,
controlled stop, safety stop, hold, zero command, and retries remain outside
RLSOK.

### Fault and degradation capability

Core already implements the requested semantics: deterministic
`requiredCapabilities`, a fresh adapter-owned available capability set,
source/version/continuity stability, execute-time refresh, and zero dispatch on
missing/stale/changed attestation. The degradation reference now maps an
external classifier report to capabilities and proves that cleared fault with
capability still absent remains blocked, while restored capability with fresh
continuity can pass. The fault manager continues to own evidence and
classification; RLSOK does not clear, diagnose, or classify faults.

### GOLEM / CorrellLab reference and external acceptance test

1. Use a fork/branch of the public H12 controller and a non-moving Shadow
   environment; do not send H12 goals.
2. The exact input is schema v1 `sourceIdentity`, `observedAt`,
   `continuityToken`, `monitorVersion`, and external boolean
   `upperBodyMotionReady`. The reference translates only that verdict into
   `upper_body.motion_ready`.
3. The approved ExecSpec requires `upper_body.motion_ready`.
4. Fresh, continuous, ready state produces an eligible Shadow observation and
   Evidence with `hardwareSignalSent: false`.
5. False, missing, stale, unknown/malformed input, monitor replacement, or
   continuity change removes eligibility and records the exact fail-closed
   reason, still with zero command.
6. `upper_body.motion_ready` means only that the selected external monitor says
   the capability needed before a new command is available. It is not an RLSOK
   inference of collision/contact/caught state or motor safety.
7. CorrellLab judgment is still required on the report owner boundary, the
   capability name, which transitions rotate continuity, and the concrete
   ready/not-ready/missing/stale/replacement fixtures. RLSOK does not implement
   GOLEM or send a cancellation/safety stop for an executing H12 trajectory.

### BXI dependency provenance

Current v2 provenance can represent policy artifact identity, controller/config
identity, and explicit runtime dependencies. PyTorch, NumPy, a custom inference
library, or an allowlisted lock/manifest can be named explicitly using software
identity/version or a content digest. Automatic closure over the entire Python
environment would create noisy invalidation and is intentionally not required.
No new Core field is justified. The allowlist-driven collector now emits the
explicit inference-runtime manifest chosen by the integrator, rejects missing
or version-mismatched declared dependencies, ignores unrelated packages, and
never performs `pip freeze` or whole-environment hashing.

### Open-RMF boundary

The two replies establish that task award/adapter acceptance is the authority
inside RMF and that RMF does not expose a distinct final robot-command
release-authorization semantic. RLSOK's existing placement below fleet/task
planning therefore matches the evidence. This is **IMPLEMENTED/VALIDATED**, not
an Open-RMF feature backlog.

### No-action follow-ups

Jacob / ros_gz supplied no reproducible new invariant, so it creates no backlog
or new ledger row. BlueROV2/Subcat remains fully represented by E32 and the
existing signed-edge-authorization section; no duplicate work was added.

## Reviewed replies excluded from status counts

The following exact replies were read but did not make a concrete technical or
comprehension claim: topic-based ros2_control author unavailable (`1a0173132f3361ea`),
OpenArm redirect to Discussions (`1a02308b943d2aaf`), Kinova support redirect
(`1a01f92e52082d57`), Cyberbotics no-bandwidth reply (`19ffbb0dba98ee67`), and
automated delivery/marketing/out-of-office responses. They do not create a
feature backlog. The Nav2 docking, Fourier, and Gradisen replies remain in the
ledger because they change external-validation priority or product stage fit.

## Remaining real-world gates

There is no unexplained `PARTIAL` or unrepresented generic defect in the 40-row
ledger. Remaining gates are explicit and external:

- run the DDS reference against a secured Fast DDS graph and add a CycloneDDS
  extractor only when authenticated signals are actually available;
- have ros2_medkit, GOLEM, Clearpath, CANopen, Nav2, Elite, SCHUNK SVH,
  CRANE-X7 and device
  owners exercise the provided contracts/fixtures before any support claim;
- perform uncoached Class A first-time comprehension and Class B regression
  validation against the live public site and Zero-to-Shadow path;
- recontact Quan, General Axis, Nav2 docking and Fourier only when they have a
  concrete release/dispatch environment. Their deferral does not justify a new
  integration.

These are external validation gates, not permission to broaden Core or add a
robot integration.

## External reference-validation requests (2026-08-25)

Each reply asks one narrow source-of-truth/capability question, limits any run
to Shadow/simulation/reference review, and explicitly makes no support claim.
The exact version-controlled reference set (public only after release) is
`examples/adapter-references/selected-identity-references.json`,
`packages/adapter-references/command-path.ts`,
`packages/adapter-references/capabilities.ts`, and
`tests/adapter-references/references.test.ts` plus
`tests/adapter-references/selectedIdentityBinding.test.ts`, narrowed per row
below.

| Ledger row / project | Gmail SENT message ID | Exact review artifact | State |
| --- | --- | --- | --- |
| E05 ros2_canopen | `1a03819bc60f152c` | selected-identity CANopen fixture plus reference test | Awaiting external result |
| E07 Clearpath | `1a03819d2a515d2a` | selected generated-configuration identity fixture plus reference test | Awaiting external result |
| E24 GOLEM | `1a037d005f03ef8e` | `capabilities.ts` upper-body normalization plus reference test | Awaiting external result |
| E25 CycloneDDS | `1a03819dd7e127bb` | `command-path.ts` authenticated DDS identity boundary plus reference test | Conceptually validated by reply `1a0394e14caa6912`; actual code, CycloneDDS extractor, and secured graph not tested |
| E26 Elite | `1a03819c6c6dda5d` | selected robot-model/driver identity fixture plus focused generic-v2 mismatch tests | Conceptually validated by the 2026-08-31 reply; a truthful Elite observer and actual external mismatch run remain open |
| E31 secured Fast DDS | `1a03819e73693009` | scoped authenticated command-path trust fixture plus negative tests | Conceptually validated by reply `1a0394e14caa6912`; actual code and real secured graph not tested |
| E20 ros2_medkit | `1a03819f9c6a2c1c` | `capabilities.ts` degradation normalization plus reference test | Awaiting external result |
| E14 Nav2 | `1a0381a2d8bdf85a` | selected Jazzy smoother semantics, CLOSED_LOOP source, command topology and FollowPath-selector reference plus test | Awaiting an actual adapter and simulated graph result; current Runtime has no Nav2 dispatch path |
| E28 CRANE-X7 | `1a0381a381cec7d3` | selected limits versus live-state provenance fixture plus test | Conceptually validated by follow-up: source split appears correct; implementation details and an actual fixture/Shadow run were not reviewed |
| E23 device serial/calibration | `1a0381a226b47c8b`, retry `1a0381bad0da0a3f` | serial-to-role/calibration identity fixture plus test | Conceptually validated by reply `1a038459178f828d`: source-of-truth and negative test confirmed; actual code not reviewed |

## Current unreplied-thread closure receipts (2026-09-20)

The mailbox was rescanned without a date boundary. These replies close or
truthfully park RLSOK threads whose latest message was external and had no
later reply from us. A Gmail `SENT` ID proves sending only; it does not prove
receipt, reading, real-hardware use or acceptance.

| Contact / thread | Gmail SENT message ID | Truthful state after reply |
| --- | --- | --- |
| Yasiru Fernando / Dobot Magician `1a0adf5685c386c6` | `1a0bda95969d789a` | Exact public repository/commit, homing service, launch/config, startup checks and redacted request still awaited; no motion requested. |
| BADAOUI IKRAM / ESIBOT `1a0a860d07bb9a86` | `1a0bda9623a759f3` | Current request closed; no ESIBOT integration or test claim. |
| Kenichi Maeda / dual LBR `1a0af9e82a86e7a8` | `1a0bda96c28ad8f1` | One zero-command result and exact controller/interface mapping invited if the hardware is used later. |
| Raj Indulkar / MyCobot 280 `1a0b39e578127eab` | `1a0bda9778005460` | Waiting until the owner returns to the hardware; versions/configuration and a zero-command observation remain required. |
| Giovanni Remigi / serial robot `1a0b381bacb60639` | `1a0bda98397e8e5f` | Waiting for the confirmed handshake implementation and returned device name; memory alone was not used to implement an adapter. |
| Lidarbot `1a023083dfe04645` | `1a0bda991409f335` | Waiting on the maintainer's deadline; exact Jazzy path and a zero-command observation remain required. |
| Arjun Chandroth / 17-DOF humanoid `1a0a3fab4a69b50e` | `1a0bda9a100bfc9b` | Physical-hardware request closed; no compatibility inferred from the historical project. |
| Gaus Mohiuddin Sayyad / dual Kinova `1a0a852fac9b1187` | `1a0bda9aa24fd27d` | Waiting for hardware availability, exact bridge/mapping and one zero-command result. |
| Rocky Wüst / PiDog `1a0a0a9c3e8a5f61` | `1a0bda9b6e178407` | Waiting for upstream issue #12; no reminder and no integration claim. |
| Tanvir Rahman / taught arm `1a08f71d089be0fc` | `1a0bda9c41686e85` | Physical-arm request closed because the hardware is unavailable. |
| Branimir Ćaran / Astro `1a079e2e7307dc41` | `1a0bda9d1a7136bb` | Waiting until after the paper deadline; exact firmware/configuration and zero-command observation remain required. |
| Hiwonder support / ROSpider `1a0bc96b8af75ddb` | `1a0bda9dc5ea3f17` | Email request closed; any future support post must contain a concrete tutorial step, version and observed result. |
| Nguyễn Hậu / mobile robot `1a0b37abb024a379` | `1a0bdab1c563b0d8` | Request closed because the maintainer left robotics and the project is indefinitely postponed; no integration or test claim. |

## 2026-09-20 real-hardware recovery correction

The earlier mailbox-complete statement did **not** establish that the
real-hardware feedback objective was complete.  A connector-only Gmail query
for `in:anywhere is:unread -from:me "rlsok.com"` returned 91 messages across
87 threads at the time of the recovery audit.  Unread state is not the same as
reply state: after reading the complete threads, 23 had an external last
message, but most of those were delivery failures, automated notifications or
unrelated mail.  More importantly, several threads whose latest message was
ours still contained an explicit real-hardware offer which had been answered
with source preparation or another material request rather than a completed
device observation.

The following threads therefore remain open until the stated external result
exists; source recipes, releases, sent mail and draft PRs are not substitutes:

| Platform / thread | Existing external commitment | Required completion evidence |
| --- | --- | --- |
| Physical MIRA / `1a08f594da4e5c52` | Lucas states that the team is currently working with the physical MIRA and is open to integration/testing. | A live, read-only PX4/ROS observation tied to the selected MIRA checkout, followed by the project-specific capture.  Minimal no-command request sent as Gmail message `1a0bddb7e1fd8ee9`; it explicitly forbids launching solely for the request, arming, Offboard, services, `/cmd_vel` and propeller enablement. |
| MakerMods Metal / `1a08f6661ff3b468` | Isaac invited PR integration, mapping review and subsequent bench testing. | Owner review of draft PR #160, then an owner-run bench result; the open draft PR alone is implementation evidence only. |
| Dual Kinova Gen3 / `1a0a852fac9b1187` | Gaus will try it when both real Gen3 arms are free. | Current left/right mapping and one zero-command observation from the real dual-arm environment. |
| PAROL6 / `1a079accbfaa60b2` | Graham offered testing, then reported that the arm is broken and needs replacement parts plus reassembly. | Owner-run result using the actual PAROL6 checkout/controller/bridge after repair; the pinned public recipe is not this result. Do not remind before the owner says the arm is ready. |
| TRIK / `1a07658ff1d51524` | Azimbek offered a real TRIK environment. | Current wheel/brick binding and a read-only result from that environment. |
| LelyRobot / `1a076624befe452b` | Tomo authorized work with the current system. | Confirmation of the active Python/C++ bridge and a read-only observation from the selected physical path. |
| GOLEM/H12 / `1a01d8e3a7eb0fef` | CorrellLab offered GOLEM as a test bed and requested a technical conversation. | Adapter-owned readiness/contact verdict mapping plus a zero-command owner run; the generic capability normalizer does not infer this. |
| xArm 1S / `1a079b3b1b7e645b` | Alan offered in-person access in the San Francisco Bay Area, but has no time to restore the long-idle setup; we cannot attend from China. | Paused by the owner's explicit availability constraint. The public source mapping is not a restored xArm or a physical result; do not ask Alan to rebuild it solely for this evaluation. |
| Nova inspection robot / `1a079b9ee5020015` | Satya agreed the boundary is real and offered a call; the proposed slots were missed. | Exact repository/commit, bringup, one robot-facing command boundary, selected hardware/configuration and a redacted example were requested once for asynchronous work. No uniquely matching public repository was found; wait without another request. |
| Rover-arm UART / `1a066fa358e97d9f` | Rohit agreed to a 20-minute evaluation but did not supply the mapping after the original and reduced requests. | Current driver/commit plus the configuration section mapping joint names/order to the 27-byte UART frame. Multiple prior requests mean no further reminder; no platform-specific integration can be claimed. |
| PiDog / `1a0a0a9c3e8a5f61` | Rocky accepted the scope and will contact us when upstream issue #12 is closed. | Resolved commit plus one zero-command brain/bridge/body observation. Explicitly wait for Rocky's ping and send no reminders. |
| ESP32 bridges / `1a0adeb95ffdf921`, `1a0aeac310cdddbf` | Amal supplied the required identity/capability fields and authentication distinction; Hiep confirmed that his current serial path has no firmware/code check. | A bridge-owned firmware protocol and owner result are still absent. The released generic signed-nonce/session contract is implementation evidence only; Hiep has already received the exact handshake material list and should not be asked repeatedly. |

MakerMods delivery correction: PR
[`makermods-robotics/makermodslab#160`](https://github.com/makermods-robotics/makermodslab/pull/160)
was changed from Draft to Ready for review on 2026-09-20 after confirming that
the implementation, exact mapping scope, synthetic checks and hardware limits
were present in the PR body.  It remains open, mergeable and unreviewed; Ready
for review is only a maintainer-review state, not merge, owner execution or a
Metal-arm bench result.  No additional reminder email was sent.

MIRA implementation delta: the CLI now exposes `profile capture-mira-status`.
It creates one read-only ROS subscription to `/fmu/out/vehicle_status`, requires
one unambiguous `px4_msgs/msg/VehicleStatus` publisher, and records the ROS
environment, publisher endpoint and selected arming/navigation/failsafe/preflight
fields in a digested observation.  Focused tests prove rejection of ambiguous
publishers and incomplete status and statically reject publisher/service APIs in
the reader.  This makes an owner-run live result directly collectable, but does
not itself establish that Lucas ran it or that the publisher is a particular
Pixhawk/airframe.

Website delivery: official guide
`/learn/read-px4-mira-status-without-commanding-the-robot` was committed in
`rlsok-cloud` as `3adca5f` and deployed to production as
`dpl_5LzTy9xD74gvrgTCMh4GnaUMCoX5`.  The production URL returned HTTP 200 and
contained the command, exact source commit and non-authentication/zero-command
boundary.  The page explicitly says this source command is not present in the
1.5.5 Windows/Mac downloads, so website publication does not silently upgrade
those packages or claim an owner run.

Packaged delivery: immutable release
[`mira-status-observer-v1`](https://github.com/realitywarden/rlsok/releases/tag/mira-status-observer-v1)
points to source commit `0cd66e6bafa46944dab4fedcc86bf2c08c098d95` and
contains a 23,476-byte ZIP plus checksum.  The published ZIP was downloaded
again and matched SHA-256
`16008c63db11b6136957cec2cc28d5b5f6510200c2c8819cc3c07ed9b9b797a2`;
its extracted focused tests passed all three cases.  GitHub reports the release
immutable.  Website commit `34a51d1` and production deployment
`dpl_6kB19755PZpF3b5kHTeSLaEVkh4K` expose that separate download without
changing desktop feeds; the production guide, ZIP and checksum each returned
HTTP 200.  Delivery update `1a0bdee1e27972fc` was sent in the existing MIRA
thread with no deadline and an explicit instruction not to power or launch the
robot solely for the request.  Publication and sending remain distinct from an
owner-run observation.

Completion reporting must keep four stages separate: project-specific source
implementation, publication/delivery, owner execution, and physical-robot
evidence.  The real-hardware goal remains open while every row above lacks the
last stage.

## Cross-platform Local Check 1.5.5 delivery (2026-09-20)

- Source payload: immutable `v1.5.5`, source commit `7a1176f194dff6bdb6f50e69945692ba3847d3c5`.
- Windows: immutable `windows-local-check-v1.5.5`, packaging commit `c8031662c2897f026fc883ac7c49781a945bb6d9`; the exact ZIP was extracted on Windows, reported `RLSOK 1.5.5`, and produced `WOULD_ALLOW` plus `WOULD_BLOCK` example reports.
- macOS: immutable `macos-local-check-v1.5.5`, packaging commit `c8031662c2897f026fc883ac7c49781a945bb6d9`; Apple-silicon and Intel installers were compiled and installed on their matching standard GitHub-hosted architectures. The installed native SwiftUI executable passed its resource/version self-check and the bundled example produced `WOULD_ALLOW` plus `WOULD_BLOCK` on both architectures.
- Website: `rlsok-cloud` commit `0379e4ed05ee2e922209d56bf937685b5250a837`, production deployment `dpl_8mfmNgkLpFGAbTJQgwJHnXHv2fbe`. Production manifests and the download page identify 1.5.5, and all four Windows, macOS arm64, macOS x64 and Ubuntu asset URLs returned HTTP 200 after redirects.
- Boundary: the new Mac surface is a real native Local Check console aligned with the current dark, dense workspace hierarchy. It does not claim the absent Cloud-management or robot-command capabilities; packages remain unsigned and not notarized. No physical robot use or customer acceptance is established.

## Mailbox completion audit (2026-09-20)

- Gmail connection was authoritative for `zhengqikk@gmail.com`. The no-date scan covered 4,926 normal messages and 22 spam messages: 4,948 messages across 4,002 threads.
- The mechanical rule “latest message is external and no later `SENT` message exists” produced 1,523 candidates. Notifications, promotions, delivery failures, automated acknowledgements and unrelated historical business mail were not treated as product feedback.
- Thirty-seven candidates had prior outbound context and appeared human or support-originated. The current RLSOK technical subset is represented by the ledger and closure table above. Each independently actionable generic requirement is implemented; each unavailable-hardware or missing-material case was closed or asked for the exact public commit, configuration, version, mapping and/or zero-command result needed next.
- Spam was included. Its apparent technical threads were full-thread false positives with later `SENT` replies; the remaining spam items were sales, promotion or delivery failures.
- A final incremental normal-and-spam search after the releases and website deployment found no newer external message. Courtesy acknowledgements do not reopen a closed request, and automated release notifications do not require replies.
- This completes the bounded mailbox *classification and reply audit*, not the
  current real-hardware feedback objective. Waiting senders have not thereby
  supplied materials, run RLSOK, connected hardware, or accepted a result. Any
  future reply is a new mailbox event and must be evaluated from its full thread.

## Incremental mailbox events after the audit (2026-09-20)

The Gmail connector was checked again after the MIRA implementation and
delivery.  Spam had no new message.  New normal-mail events were handled as
follows:

- Unitree support `1a0bde5a39b2ce7c` thanked us for acknowledging the
  third-party/no-compatibility boundary and invited future questions.  This is
  a courtesy close, supplies no implementation material or hardware result and
  needs no additional reply.
- Nguyễn Hậu `1a0bdb6262db7317` was a courtesy reply after the mobile-robot
  request was explicitly closed because the owner left robotics.  It does not
  reopen that thread.
- GitHub release notifications are automated receipts for already recorded
  releases.  Delivery failures for Niryo, FZI and earlier outreach establish
  non-delivery only; they are not customer feedback or a reason to invent an
  alternate recipient.
- The unsolicited “underexposed repository” message
  `1a0bdce448f35b47` is a generic marketing solicitation with no RLSOK product
  feedback or robot material.  No reply is required.
- The Nova Robotics public-source search did not uniquely identify the
  inspection platform described by Satya.  A result named `Nova_ROS2` concerns
  a Dobot Nova5 arm and cannot be substituted for the emailed inspection
  robot.  The already-sent repository/commit/command/material request remains
  the only truthful unblock path; no repeat was sent.

## MIRA observer source-compatibility audit (2026-09-20)

The packaged observer was checked again against the exact public MIRA source
revision named in the recipe, not only against RLSOK's tests.  MIRA commit
`52a3503e966a00dca6faba7b8850fed54540f34d` subscribes to
`/fmu/out/vehicle_status` as `px4_msgs::msg::VehicleStatus` with
`rclcpp::SensorDataQoS()`, matching the observer's topic, type and sensor-data
QoS.  The MIRA dependency table and Docker entrypoint intentionally consume
the latest `px4_msgs` main rather than a pinned revision.  Current upstream
`px4_msgs` commit `72fcfaa2750306c9fde8e30e14b5a6d67eb3264f` defines all four
selected fields: `arming_state`, `nav_state`, `failsafe` and
`pre_flight_checks_pass`.

This source audit found no reason to replace the immutable v1 package.  It is
still not an installed ROS/PX4 run, an authenticated Pixhawk/airframe identity,
or physical-MIRA evidence; only Lucas's returned owner-run capture can satisfy
that stage.

## Real-hardware follow-up wording correction (2026-09-20)

The owner clarified that earlier replies which stopped at source preparation,
configuration material or a statement that no physical run was needed should
not be treated as having fully pursued a real-robot result.  Five still-viable
threads therefore received one corrected, project-specific follow-up.  These
are not generic reminders: each asks for the smallest read-only evidence that
can distinguish an owner-run environment from another public-source review.

| Platform / thread | Gmail SENT ID | Corrected request and boundary |
| --- | --- | --- |
| LelyRobot / `1a076624befe452b` | `1a0bdfaadf404fdb` | During an already-running normal bringup, return checkout identity, active Python/C++ bridge, node/topic endpoint details and one existing `/ultrasonic_left` sample.  No launch solely for RLSOK and no `/cmd_vel` publication.  A sensor sample is serial-path evidence, not controller authentication or motion safety. |
| TRIK / `1a07658ff1d51524` | `1a0bdfab4fd66be9` | During normal TRIK bringup and before teleoperation, return checkout identity, controller/hardware-interface listings, `/joint_states` and `/diff_drive_controller/odom`.  No power/launch solely for RLSOK and no velocity publication.  This is a request for the real TCP/hardware path, not another static recipe. |
| MakerMods Metal / `1a08f6661ff3b468` | `1a0bdfac005a26ec` | PR #160 is now Ready for mapping review.  If accepted, run capture-only against copies of the selected real-bench record/calibrations while the arm remains unpowered and no bus/session is opened.  This can establish an owner-run selected setup, not physical identity, torque, motion or safety. |
| Amal ESP32 bridge / `1a0adeb95ffdf921` | `1a0bdfad064edfba` | Requested the exact public host/firmware sources and existing non-motion query so RLSOK can implement the project-specific identity/capability exchange and later run it on the physical bridge with drive output disabled.  Authentication will not be claimed without actual nonce/session proof. |
| Hiep ESP32 bridge / `1a0aeac310cdddbf` | `1a0bdfae383c2dbe` | Offered to implement the missing read-only identity request from the exact host/firmware sources, then capture it during normal maintenance with drive output disabled.  A returned version string is comparison evidence only, not authenticated identity. |

MIRA and dual Kinova had already received explicit physical, zero-command
requests and were not contacted again.  GOLEM/H12 had received an exact
materials plus real/simulation zero-command question on 2026-09-19; repeating
it one day later would not improve the unblock path.  PAROL6 is broken, xArm
1S lacks restoration availability, PiDog is waiting on its upstream issue and
the rover-arm owner has already received multiple mapping requests, so those
constraints were respected rather than overridden by a mass reminder.

These SENT IDs prove outreach only.  None is a returned owner capture, robot
connection, bench trial, accepted PR or hardware validation.
