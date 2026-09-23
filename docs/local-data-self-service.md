# Prepare a local JSON or YAML check workspace

This path uses no ROS installation, account, AI service, cloud upload or robot command. It reads a selected local file. It does **not** discover a live device, authenticate who produced the file, or establish that a configuration is active on a controller.

## Start with your project

Run `rlsok setup-assistant` from the installed Local Check directory and open its loopback page. Choose **Open project folder** to list JSON/YAML candidates, then select the intended file under **Local JSON / YAML data**. Alternatively choose one data file directly. The assistant shows scalar field pointers and types from the first record, plus the number of records. That is structure only; it cannot infer units, physical meaning or acceptable limits.

For each field you actually want checked, select a detected pointer and type, then enter its documented meaning and unit or explicit label. Add optional bounds or allowed values. Enter a machine ID, review that the selected file is from the intended machine, and confirm the semantics. The machine ID is operator-declared, not authenticated. The first local check must match all selected rules or workspace export is blocked.

The downloaded ZIP contains `workspace.json`, `template.json`, the exact selected bytes under `files/prepared-source-data`, and `README.md`. Extract it into a private directory. With the installed CLI available, run from that directory:

```sh
rlsok profile check-local-data --workspace workspace.json --source files/prepared-source-data --output first-check.json
```

To check a **new, independently obtained snapshot** from the same declared source, pass its path with `--source` and a new report path with `--output`. The report marks whether the bytes match the originally selected file and gives `LOCAL_DATA_MATCH` or `LOCAL_DATA_BLOCK` for the selected rules. A match is **not** a motion approval or proof of current hardware state.

## Reuse rules without reusing machine identity

**Save versioned rule template** downloads only the selected scalar-field rules and their user-managed ID, name and version. It contains no selected data file or device ID. Import one or more templates on another project, remove any irrelevant fragment, and enter that machine's own file and ID. Overlapping pointers are rejected; common rules can be reused across any number of machines. Reconfirm field meaning, units and limits for each machine.

The same path is available from the CLI:

```sh
rlsok profile prepare-local-data --template rules.json --parser yaml-records/v1 --source actual-file.yaml --device-id actual-device-id --confirm-semantics yes --output new-workspace
rlsok profile check-local-data --workspace new-workspace/workspace.json --source new-workspace/files/prepared-source-data --output first-check.json
```

Use `json-records/v1` for JSON. Each file must contain one object or an array of 1–10,000 objects and be no larger than 8 MiB. Only selected scalar fields are checked; other fields and live transports are outside this path. The existing ROS interface setup and saved-file recipes remain available separately.
