import crypto from "crypto";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import prisma from "../prismaClient.js";
import { onDiscoveryProgress } from "../services/discoveryProgressService.js";

type TenantSocketRegistry = Map<string, Set<WebSocket>>;

function resolveApiKeyHeader(value: string | string[] | undefined) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.find((item) => item && item.trim()) || null;
  }
  return value.trim() || null;
}

async function resolveTenantIdFromApiKey(apiKey: string): Promise<string | null> {
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const now = new Date();
  const existingApiKey = await prisma.apiKey.findFirst({
    where: { keyHash: apiKeyHash, revokedAt: null },
  });

  if (existingApiKey?.expiresAt && existingApiKey.expiresAt <= now) {
    return null;
  }

  if (existingApiKey && (!existingApiKey.expiresAt || existingApiKey.expiresAt > now)) {
    return existingApiKey.tenantId;
  }

  const tenant = await prisma.tenant.findUnique({ where: { apiKey } });
  return tenant?.id ?? null;
}

function registerSocket(registry: TenantSocketRegistry, tenantId: string, socket: WebSocket) {
  const existing = registry.get(tenantId) ?? new Set<WebSocket>();
  existing.add(socket);
  registry.set(tenantId, existing);

  socket.on("close", () => {
    const current = registry.get(tenantId);
    if (!current) return;
    current.delete(socket);
    if (current.size === 0) {
      registry.delete(tenantId);
    }
  });
}

export function initDiscoveryWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  const registry: TenantSocketRegistry = new Map();

  server.on("upgrade", (req, socket, head) => {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "", `http://${host}`);
    if (url.pathname !== "/discovery/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const headerKey = resolveApiKeyHeader(req.headers["x-api-key"]);
    const queryKey = url.searchParams.get("apiKey");
    const apiKey = headerKey || queryKey;
    if (!apiKey) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    void resolveTenantIdFromApiKey(apiKey)
      .then((tenantId) => {
        if (!tenantId) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          registerSocket(registry, tenantId, ws);
          ws.send(
            JSON.stringify({
              type: "discovery.connected",
              tenantId,
            })
          );
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  const unsubscribe = onDiscoveryProgress((event) => {
    const sockets = registry.get(event.tenantId);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify({
      type: "discovery.progress",
      ...event,
    });
    sockets.forEach((socketInstance) => {
      if (socketInstance.readyState === WebSocket.OPEN) {
        socketInstance.send(payload);
      }
    });
  });

  return {
    close() {
      unsubscribe();
      wss.close();
    },
  };
}
