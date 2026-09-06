import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";

import { decodeOperatorCommandRequest } from "@orbit/config/operator-control";
import type { Address } from "viem";
import { getAddress } from "viem";

import {
  applyOperatorControlCommand,
  readOperatorControlState,
  readPublicDeliveryStatus,
  type OperatorControlDependencies,
} from "./service.ts";

/**
 * The control plane is a separate, token-authorized loopback surface. It is
 * never publicly routed: the public API proxies to it only after its own admin
 * session, role, and CSRF checks pass, so the public API stays a data plane.
 */
export interface OperatorControlServerOptions {
  readonly dependencies: OperatorControlDependencies;
  readonly host: string;
  readonly port: number;
  readonly serviceToken: string;
}

const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
};

const authorized = (request: IncomingMessage, token: string): boolean => {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return (
    provided.byteLength === expected.byteLength &&
    timingSafeEqual(provided, expected)
  );
};

const body = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4_096) {
        reject(new Error("Operator command body is too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Operator command body is not JSON"));
      }
    });
    request.on("error", reject);
  });

/**
 * The proxy supplies the authenticated actor and role it verified. The control
 * plane never derives them from the request body.
 */
const actorFrom = (
  request: IncomingMessage,
): { readonly address: Address; readonly role: string } | undefined => {
  const address = request.headers["x-operator-actor"];
  const role = request.headers["x-operator-role"];
  if (typeof address !== "string" || typeof role !== "string") return undefined;
  try {
    return { address: getAddress(address), role };
  } catch {
    return undefined;
  }
};

const readOnlyResponse = (
  url: URL,
  options: OperatorControlServerOptions,
): unknown => {
  if (url.search !== "") return undefined;
  if (url.pathname === "/v1/delivery-status")
    return readPublicDeliveryStatus(options.dependencies);
  if (url.pathname === "/v1/state")
    return { state: readOperatorControlState(options.dependencies) };
  return undefined;
};

export const createOperatorControlServer = (
  options: OperatorControlServerOptions,
) =>
  createServer((request, response) => {
    void (async () => {
      if (!authorized(request, options.serviceToken)) {
        json(response, 401, { error: { code: "operator-unauthorized" } });
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const read =
        request.method === "GET" ? readOnlyResponse(url, options) : undefined;
      if (read !== undefined) {
        json(response, 200, read);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/command") {
        const actor = actorFrom(request);
        if (actor === undefined) {
          json(response, 400, {
            error: {
              code: "operator-actor-required",
              message: "The proxy did not supply an authenticated actor.",
            },
          });
          return;
        }
        let command;
        try {
          command = decodeOperatorCommandRequest(await body(request));
        } catch {
          json(response, 400, {
            error: {
              code: "operator-command-invalid",
              message:
                "Only a fixed command name, a command id, and an optional signed command are accepted.",
            },
          });
          return;
        }
        const outcome = await applyOperatorControlCommand(
          options.dependencies,
          actor,
          command,
        );
        if (!outcome.ok) {
          json(response, outcome.status, {
            error: { code: outcome.code, message: outcome.message },
          });
          return;
        }
        json(response, 200, {
          command: {
            applied: outcome.applied,
            command: command.command,
            commandId: command.commandId,
            result: outcome.result,
          },
          state: readOperatorControlState(options.dependencies),
        });
        return;
      }
      json(response, 404, { error: { code: "operator-route-not-found" } });
    })().catch(() => {
      if (!response.headersSent) {
        json(response, 500, { error: { code: "operator-internal-error" } });
      }
    });
  });
