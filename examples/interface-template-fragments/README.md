# Compose interface template fragments

These two templates are synthetic. They demonstrate the portable composition
contract and are not verified robot integrations.

```sh
rlsok profile compose-templates \
  --input examples/interface-template-fragments/base-arm.template.json \
  --input examples/interface-template-fragments/site-controller.template.json \
  --output composed.template.json
```

The output combines both paths, deduplicates the shared robot-description fact
and takes the later controller and observation-age defaults. Inspect it, match
it against a fresh discovery catalog, then supply real goals, files and
semantic confirmations. No command is sent during composition.
