import {
  createIdentityApplicationCopy,
  selectedIdentityConfiguration,
} from "@orbit/config/identity";

export const identity = selectedIdentityConfiguration;
export const applicationCopy = createIdentityApplicationCopy(identity);
