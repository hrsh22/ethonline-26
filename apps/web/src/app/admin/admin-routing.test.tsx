import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  required: vi.fn(),
}));

const panelState = vi.hoisted(() => ({
  diagnosticsRenders: vi.fn(),
  operationsRenders: vi.fn(),
}));

vi.mock("@/lib/admin-session.server", () => ({
  requireAdminSession: authState.required,
}));

vi.mock("@/components/admin/admin-shell", () => ({
  AdminShell: ({
    children,
    session,
  }: {
    readonly children: React.ReactNode;
    readonly session: { readonly address: string };
  }) => <section data-admin-shell={session.address}>{children}</section>,
}));

vi.mock("@/components/admin/admin-session-boundary", () => ({
  AdminSessionBoundary: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => children,
}));

vi.mock("@/components/admin/operations-panel", () => ({
  OperationsPanel: () => {
    panelState.operationsRenders();
    return <section>Protected operations</section>;
  },
}));

vi.mock("@/components/admin/admin-diagnostics-panel", () => ({
  AdminDiagnosticsPanel: () => {
    panelState.diagnosticsRenders();
    return <section>Protected diagnostics</section>;
  },
}));

import AdminPage from "./(protected)/page";
import AdminDiagnosticsPage from "./(protected)/diagnostics/page";

const session = {
  address: "0x1111111111111111111111111111111111111111",
  chainId: 84_532,
  csrfToken: "c".repeat(32),
  deploymentFingerprint: `0x${"f".repeat(64)}`,
  expiresAt: "2026-09-05T05:15:00.000Z",
  issuedAt: "2026-09-05T05:00:00.000Z",
  observedBlock: { hash: `0x${"a".repeat(64)}`, number: "31000000" },
  roles: ["keeper"],
};

describe("protected admin route tree", () => {
  beforeEach(() => {
    authState.required.mockReset();
    authState.required.mockResolvedValue(session);
    panelState.diagnosticsRenders.mockReset();
    panelState.operationsRenders.mockReset();
  });

  it("authenticates each route before rendering its shell and panel", async () => {
    const operations = renderToStaticMarkup(await AdminPage());
    const diagnostics = renderToStaticMarkup(await AdminDiagnosticsPage());

    expect(authState.required.mock.calls).toEqual([
      ["/admin"],
      ["/admin/diagnostics"],
    ]);
    expect(operations).toContain(`data-admin-shell="${session.address}"`);
    expect(diagnostics).toContain(`data-admin-shell="${session.address}"`);
    expect(operations).toContain("Protected operations");
    expect(diagnostics).toContain("Protected diagnostics");
    expect(panelState.operationsRenders).toHaveBeenCalledOnce();
    expect(panelState.diagnosticsRenders).toHaveBeenCalledOnce();
  });

  it("does not evaluate a protected panel when its route gate redirects", async () => {
    authState.required.mockRejectedValueOnce(new Error("redirected"));

    await expect(AdminDiagnosticsPage()).rejects.toThrow("redirected");

    expect(authState.required).toHaveBeenCalledWith("/admin/diagnostics");
    expect(panelState.diagnosticsRenders).not.toHaveBeenCalled();
  });
});
