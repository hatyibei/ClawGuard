import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

export interface WebSocketBroadcaster {
  broadcast(type: string, data: unknown): void;
}

export function createWebSocketServer(server: Server): WebSocketBroadcaster {
  const wss = new WebSocketServer({ server, path: "/ws" });

  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: "connected",
        data: { message: "Connected to LobsterGate WebSocket" },
      })
    );
  });

  return {
    broadcast(type: string, data: unknown) {
      const message = JSON.stringify({ type, data });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    },
  };
}
