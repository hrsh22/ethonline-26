import { COLLECTION_SIZE } from "@orbit/config/collection-manifest";

export const parseCanonicalIdentityId = (value: string) => {
  if (!/^[1-9]\d{0,3}$/u.test(value)) return undefined;
  const identityId = Number(value);
  return identityId <= COLLECTION_SIZE ? identityId : undefined;
};
