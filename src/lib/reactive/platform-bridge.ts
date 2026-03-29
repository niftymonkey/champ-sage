/**
 * Platform-agnostic bridge interface for native runtime communication.
 *
 * Implementations:
 * - electron-bridge.ts — Electron IPC (via preload contextBridge)
 *
 * The reactive engine and all business logic depend on this interface,
 * never on a specific runtime.
 */

export interface LcuEventPayload {
  uri: string;
  event_type: string;
  data: unknown;
}

export interface LcuDisconnectPayload {
  reason: string;
}

export interface PlatformBridge {
  /** Read the LCU lockfile and return connection credentials. */
  discoverLcu(): Promise<{ port: number; token: string }>;

  /** Proxy fetch to the LCU REST API with Basic auth. */
  fetchLcu(port: number, token: string, endpoint: string): Promise<string>;

  /** Proxy fetch to the Riot Live Client Data API. */
  fetchRiotApi(endpoint: string): Promise<string>;

  /** Connect the LCU WebSocket (main process spawns reader, emits events). */
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
