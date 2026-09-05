# ORBIT 4444 web application

This package contains the Next.js App Router interface. Run it from the repository root with `pnpm dev` so the shared configuration and protocol packages are built first and the web app explicitly targets the checked Base Sepolia staging deployment. Use `pnpm dev:local` only to target the Anvil deployment. Both commands run Next.js in development mode; the command chooses the deployment target.

Put local browser-public bindings in the repository root `.env`. Do not create an
`apps/web/.env*` file: every official development, build, typecheck, start, and accessibility path
uses the guarded web launcher, rejects those files at startup, and prevents the Next.js child from
reading a file created later during development hot reload.
The package `.env.example` is reference documentation only.

The root [README](../../README.md) documents the complete workspace and required commands.
