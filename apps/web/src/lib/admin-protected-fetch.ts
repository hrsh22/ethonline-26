export const ADMIN_SESSION_INVALIDATED_EVENT =
  "orbit:admin-session-invalidated";
export const ADMIN_SESSION_ENDED_EVENT = "orbit:admin-session-ended";
export const ADMIN_SESSION_STARTED_EVENT = "orbit:admin-session-started";
export const ADMIN_SESSION_STORAGE_KEY = "orbit:admin-session-ended-at";

/**
 * Records that this browser may hold an admin session, so the root lifecycle
 * can tell an operator from an ordinary collector.
 *
 * `ADMIN_SESSION_STORAGE_KEY` marks an *end* and is removed immediately; it
 * cannot answer "could there be a session here". The session cookie itself is
 * HttpOnly, so script cannot read it either. Without this marker the lifecycle
 * probed `/api/admin/auth/session` on every collector route as soon as any
 * wallet connected -- a 401 per page load, relayed upstream to the API, for
 * every visitor who has never opened the console.
 */
export const ADMIN_SESSION_PRESENCE_KEY = "orbit:admin-session-present";

export const markAdminSessionPresent = (): void => {
  try {
    window.localStorage.setItem(ADMIN_SESSION_PRESENCE_KEY, "1");
  } catch {
    // Storage being unavailable only costs the optimisation: the lifecycle
    // still probes on every admin path and whenever a session is tracked.
  }
};

export const forgetAdminSessionPresence = (): void => {
  try {
    window.localStorage.removeItem(ADMIN_SESSION_PRESENCE_KEY);
  } catch {
    // See above: losing the marker never grants access, it only re-probes.
  }
};

export const adminSessionMayExist = (): boolean => {
  try {
    return window.localStorage.getItem(ADMIN_SESSION_PRESENCE_KEY) !== null;
  } catch {
    /* Unreadable storage must not suppress the check: fail towards probing,
       which is the behaviour that existed before the marker. */
    return true;
  }
};

export const adminProtectedFetch = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  fetcher: typeof fetch = fetch,
): Promise<Response> => {
  const response = await fetcher(input, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (
    (response.status === 401 || response.status === 403) &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(new Event(ADMIN_SESSION_INVALIDATED_EVENT));
  }
  return response;
};
