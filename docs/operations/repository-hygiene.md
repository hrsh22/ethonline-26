# Repository hygiene

Run `pnpm clean:generated` to remove regenerable first-party build outputs,
compiler caches, and test reports. Use `pnpm clean:generated -- --dry-run` to
print the fixed cleanup set without removing it. The command deliberately does
not traverse the repository and does not remove `.data`, `.env*`, deployment
records, or SQLite databases.

## Deployment record retention

`deployments/84532.json` and
`deployments/cca-base-sepolia-2026-09-08/84532.json` are currently byte-for-byte
identical. The dated directory also contains the deployment input and
composition sidecars, while the canonical path is consumed by the application,
subgraph tooling, and operational documentation. Keep both copies until the
project adopts an explicit retention policy for dated deployment records; do
not treat either path as a regenerable cleanup target.
