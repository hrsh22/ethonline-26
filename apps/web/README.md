# ORBIT 4444 web application

This package contains the Next.js App Router interface. Run it from the repository root with
`pnpm dev` so the shared configuration and protocol packages are built first and the web app
explicitly targets the checked developer Base Sepolia deployment. `pnpm dev:staging` reads the
separate `.env.staging` profile and becomes usable after the staging manifest is published. Use
`pnpm dev:local` only to target Anvil. All three commands run Next.js in development mode; the
command chooses the deployment target.

The authoritative browser-public variable reference is
[`config/env/web.env.example`](../../config/env/web.env.example). Put local integration values in
the repository root `.env`; use the root `.env.staging` only for a workstation staging rehearsal.
Do not create an
`apps/web/.env*` file: every official development, build, typecheck, start, and accessibility path
uses the guarded web launcher, rejects those files at startup, and prevents the Next.js child from
reading a file created later during development hot reload.

Wallet onboarding is provided by Privy. `NEXT_PUBLIC_PRIVY_APP_ID` is the required public dashboard
identifier; the old Reown project-ID binding is not used by the web application.

The root [README](../../README.md) documents the complete workspace and required commands.
