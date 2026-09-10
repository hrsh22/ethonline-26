import { parseWebPublicConfiguration } from "./web-public-configuration";

// Keep these direct property reads in one literal object. Next.js only replaces
// statically referenced NEXT_PUBLIC_* bindings in browser bundles.
export const webPublicConfiguration = parseWebPublicConfiguration({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL:
    process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT:
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
});
