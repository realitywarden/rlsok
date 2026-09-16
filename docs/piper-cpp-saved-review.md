# Compare a Piper CPP arm and gripper selection

Compare saved launch choices, controller settings, the complete robot model
and source files before another session. A changed gripper choice, CAN name,
speed cap or activation-to-zero setting stays visible against the original
reviewed baseline. This free independent tool reads files only: it never loads
the SDK, opens CAN, enables the arm, launches a controller or homes a gripper.

Source review: [justagist/piper_cpp c2894e86](https://github.com/justagist/piper_cpp/tree/c2894e86fd78d0ec1f7cbd40721de8ffbe91ad00).
This is separate from the other Piper/bimanual recipe. It is not an upstream
merge or a completed physical integration.

## Choose the actual files

Use [Local Check 1.5.2](https://github.com/realitywarden/rlsok/releases/tag/v1.5.2),
Python 3 and Git. From the extracted bundle:

```sh
export PATH="$PWD/bin:$PATH"
SOURCE=/absolute/path/to/piper_cpp
cp materials/piper-cpp-selection.example.json piper-selection.json
```

Edit the example to match the launcher and all your selected arguments. Resolve
empty description/controller arguments to their actual chosen filenames.
The example records source defaults, including `go_to_zero_on_activate: true`;
it is **not an instruction to activate or move the arm**. Extra saved arguments
are retained for comparison but are not certified as effective upstream options.
Set `provenance: operator-selected` after review.

Select a previously saved, **complete expanded robot_description** as
`model.urdf`. The upstream Xacro includes external `piper_description` files;
a wrapper alone omits their geometry. RLSOK does not execute Xacro or start
a controller to create this file. If you do not have this saved model, keep
the item pending instead of substituting a made-up model.

```sh
python3 materials/select-saved-files.py --source "$SOURCE" --id my-piper-cpp \
  --file selection=piper-selection.json \
  --file controllers="$SOURCE/piper_cpp_ros/config/piper_controllers.yaml" \
  --file model=/absolute/path/to/saved/model.urdf --output selected.json
rlsok profile prepare-saved-setup --recipe piper-cpp \
  --source "$SOURCE" --input selected.json --output setup-01
rlsok profile capture-setup --manifest setup-01/manifest.json --output observed-01.json
```

Read `setup-01/REVIEW.md`, the copied inputs and `source-files.json`, then choose
your comparison baseline:

```sh
rlsok profile approve-setup --observation observed-01.json --actor YOUR_NAME --output baseline-01.json
```

For another saved selection, prepare a new `setup-02`, capture `observed-02.json`
and compare to the same baseline:

```sh
rlsok profile review-setup --baseline baseline-01.json --observation observed-02.json --output comparison-02
```

Read `comparison-02/report.md`. The original baseline is retained; changed files
require review, and missing/malformed files remain missing. All these steps run
offline without the robot.

## MoveIt and limits

For `piper_cpp_moveit/piper_moveit.launch.py`, also select saved files with keys
`moveit_controllers`, `joint_limits`, `kinematics`, `planning` (YAML) and
`semantic_model` (the complete expanded SRDF). Controller and description
selection differs between the two launchers: review their copied source and
record resolved files, not assumed overrides. The recipe copies SDK/control
source as text and binds its bytes, including local changes beyond Git HEAD.

The check compares the whole selected input. It does not establish that gripper
hardware matches a toggle, that controller/model joints are mechanically valid,
or that saved files are the ones a running process loaded. CAN names alone do
not establish physical identity. No package/firmware compatibility or real
bench result is claimed. See [saved setup review](saved-setup-review.md).
