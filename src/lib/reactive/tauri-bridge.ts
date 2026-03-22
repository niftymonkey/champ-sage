import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface LcuEventPayload {
  uri: string;
  event_type: string;
  data: unknown;
}

export interface LcuDisconnectPayload {
  reason: string;
}

export interface TauriBridge {
  /** Read the LCU lockfile and return connection credentials. */
  discoverLcu(): Promise<{ port: number; token: string }>;

  /** Proxy fetch to the LCU REST API with Basic auth. */
  fetchLcu(port: number, token: string, endpoint: string): Promise<string>;

  /** Proxy fetch to the Riot Live Client Data API. */
  fetchRiotApi(endpoint: string): Promise<string>;

  /** Connect the LCU WebSocket (Rust spawns reader, emits events). */
  connectLcuWebSocket(port: number, token: string): Promise<void>;

  /** Listen for LCU WebSocket events. Returns an unlisten function. */
  listenLcuEvent(
    handler: (event: LcuEventPayload) => void
  ): Promise<() => void>;

  /** Listen for LCU WebSocket disconnects. Returns an unlisten function. */
  listenLcuDisconnect(
    handler: (event: LcuDisconnectPayload) => void
  ): Promise<() => void>;
}

/** Real implementation that delegates to Tauri invoke/listen. */
export function createRealTauriBridge(): TauriBridge {
  return {
    discoverLcu() {
      return invoke<{ port: number; token: string }>("discover_lcu");
    },

    fetchLcu(port: number, token: string, endpoint: string) {
      return invoke<string>("fetch_lcu", { port, token, endpoint });
    },

    fetchRiotApi(endpoint: string) {
      return invoke<string>("fetch_riot_api", { endpoint });
    },

    connectLcuWebSocket(port: number, token: string) {
      return invoke<void>("connect_lcu_websocket", { port, token });
    },

    async listenLcuEvent(handler) {
      const unlisten = await listen<LcuEventPayload>("lcu-event", (event) => {
        handler(event.payload);
      });
      return unlisten;
    },

    async listenLcuDisconnect(handler) {
      const unlisten = await listen<LcuDisconnectPayload>(
        "lcu-disconnect",
        (event) => {
          handler(event.payload);
        }
      );
      return unlisten;
    },
  };
}
