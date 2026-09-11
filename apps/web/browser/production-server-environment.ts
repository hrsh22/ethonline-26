export const createProductionServerEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  apiOrigin: string,
): NodeJS.ProcessEnv => {
  const deploymentEnvironment =
    environment.NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT?.trim();
  if (
    deploymentEnvironment === undefined ||
    deploymentEnvironment.length === 0
  ) {
    throw new Error(
      "NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT is required by the production browser harness",
    );
  }
  return {
    NEXT_PUBLIC_API_URL: apiOrigin,
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3001",
    NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    __NEXT_PROCESSED_ENV: "true",
  };
};
