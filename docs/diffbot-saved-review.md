# Compare the files used for a Modular DiffBot session

Keep the bridge settings, ESP32 sketch and model copies together. Compare a
later setup against the baseline you reviewed, and see exactly what changed.
The checker never starts ROS, opens WiFi/TCP, flashes firmware or sends PWM.

Use [Local Check 1.5.2](https://github.com/realitywarden/rlsok/releases/tag/v1.5.2)
on the supported Linux x64 computer. Python 3 and Git are needed for the small
selection helper. No account or upload is needed. This independent recipe
was reviewed against [upstream 84b2fe17](https://github.com/E-Moynul/ros2_modular_diffbot/tree/84b2fe17bb512ccb7f5461d4684507b2273ef5b3).

## Select your copies

From the extracted RLSOK directory, set `SOURCE` to your DiffBot checkout:

```sh
export PATH="$PWD/bin:$PATH"
SOURCE=/absolute/path/to/ros2_modular_diffbot
cp materials/diffbot-settings.example.json diffbot-settings.json
```

Edit `diffbot-settings.json` to record the values you selected. The example
uses public source defaults **except the deliberately local placeholder
address 127.0.0.1**. It is not a discovered robot configuration or a ROS
parameter file. Record actual launch overrides, remappings and teleop choices;
set `provenance` to `operator-selected` only after reviewing them. Keep private
addresses and WiFi credentials on your own computer.

```sh
python3 materials/select-saved-files.py --source "$SOURCE" --id my-diffbot \
  --file settings=diffbot-settings.json \
  --file bridge="$SOURCE/ros2_modular_diffbot/kinematics_wifi_bridge.py" \
  --file firmware="$SOURCE/esp32_firmware/esp32_diffbot_firmware.ino" \
  --file launch="$SOURCE/launch/launch_real.launch.py" \
  --file model="$SOURCE/urdf/robot.urdf.xacro" \
  --file model_core="$SOURCE/urdf/robot_core.xacro" \
  --file model_gazebo="$SOURCE/urdf/robot_gazebo.xacro" --output selected.json
rlsok profile prepare-saved-setup --recipe modular-diffbot \
  --source "$SOURCE" --input selected.json --output setup-01
```

Use the actual source copies for your sessions, including local modifications.
This copies every selected file, not just a few extracted numbers. Read
`setup-01/REVIEW.md` and the copied inputs. At the reviewed source, the bridge's
`max_pwm` is 200 while firmware `setMotor` clamps it again at 100. Review both;
these are not measured motor speeds and the checker does not change them.

## Keep and reuse one baseline

```sh
rlsok profile capture-setup --manifest setup-01/manifest.json --output observed-01.json
rlsok profile approve-setup --observation observed-01.json --actor YOUR_NAME --output baseline-01.json
```

After changing a selected file, prepare `setup-02` with the same request, then:

```sh
rlsok profile capture-setup --manifest setup-02/manifest.json --output observed-02.json
rlsok profile review-setup --baseline baseline-01.json --observation observed-02.json --output comparison-02
```

For a harmless offline example, change only the saved `wheel_base` value
from 0.1 to 0.11, prepare the second copy, and read `comparison-02/report.md`.
Do not copy this example into the running robot as a tuning recommendation.
Keep the original baseline; reviewing a change does not automatically approve it.

`UNCHANGED` means selected copies match; `REVIEW_REQUIRED` identifies differences;
missing or malformed saved inputs yield `NEEDS_MATERIAL`. None means the
robot is ready or motion is safe. The model is a saved reference: the reviewed
real launch does not start robot_state_publisher. Gazebo's plugin is a separate
path from the real bridge. Flashed firmware, effective live parameters,
network delivery and physical performance remain unobserved. Reports can
contain file contents and private settings; share only a redacted excerpt
you choose. See [saved setup review](saved-setup-review.md).
