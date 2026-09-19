# EtherCAT + ros2_control Shadow boundary

This is a zero-command review plan for an existing EtherCAT hardware plugin.
It does not start the master, activate a controller, claim a hardware
interface or transmit an EtherCAT frame.

## What is selected

Keep the following inputs together in one reviewed setup:

- the complete expanded `ros2_control` robot description and hardware-plugin
  parameters;
- the ordered joint-to-slave mapping, including each encoder offset, scale,
  direction and gear ratio used by the hardware interface;
- slave alias, physical position, vendor ID, product code, operation mode,
  selected PDO/SDO mapping, and distributed-clock/synchronization settings;
- the EtherCAT master identity, selected network interface and reviewed slave
  topology;
- controller type, ordered joints, command/state interfaces, command endpoint
  and execution-relevant controller parameters;
- the exact hardware plugin and EtherCAT driver source/build identity.

Do not fold live encoder samples, cycle counters, timestamps or unrelated
slaves into the saved approval. Those are observations, not stable selected
configuration.

## How comparison works

RLSOK hashes the selected files and normalized selection as one configuration.
A changed encoder offset, slave identity/PDO mapping, joint order, controller
claim or selected source/build identity produces a different configuration and
the old approval cannot be reused. The comparison is byte- and
selection-based; RLSOK does not infer EtherCAT semantics from a topic name.

Before a real-arm trial, a separate read-only observer must report the active
master/topology, hardware-plugin identity and controller claims. That observer
may emit a runtime capability only after its evidence is fresh and matches the
reviewed selection. Merely finding an interface name or saved YAML file is not
proof of the live device.

## First safe test

1. Check out the exact repository revision used to build the running system.
2. Export the expanded robot description, controller YAML, EtherCAT slave/PDO
   configuration, encoder-offset source and build identity to a new local
   review directory.
3. Review and approve that saved directory while the EtherCAT master and arm
   are unreachable or powered safe.
4. Make a copy and change exactly one encoder offset. Compare it with the
   reviewed setup and require a block.
5. Repeat with one slave identity/PDO fact and one joint/controller binding.
6. Only after those zero-command cases work, add a read-only live observer.

The first three changed copies are synthetic mismatch checks. They do not
establish live compatibility, successful installation, motion safety or
customer acceptance.

## Exact material still needed from an owner

For an owner-specific runnable recipe, provide the public or private checkout
path and commit, the expanded `ros2_control` description, controller YAML, the
file or code that defines encoder offsets, the EtherCAT slave/PDO/DC
configuration, and the command endpoint intended for the first test. Private
files can remain local; only their hashes and the generated report need be
shared if the owner chooses.
