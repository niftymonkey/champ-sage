import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getLogger } from "./lib/logger";
import {
  ALL_SETTINGS,
  createElectronSettingsIO,
  loadSettings,
} from "./lib/settings";

// Boot-time hydration of every persisted user preference. We don't
// await — blocking first paint on an IPC round-trip is a worse
// failure mode than briefly rendering with declared defaults. The
// settings$ subject re-emits once load resolves and any subscriber
// re-renders with persisted values.
void loadSettings(createElectronSettingsIO(), ALL_SETTINGS);

const uiLog = getLogger("ui");

// The last boundary. Anything that escapes the region-level ones lands here,
// and the alternative to catching it is an unmounted tree: a blank window on a
// process that is alive and logging normally.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      onError={(err, info) =>
        uiLog.error(
          `Unhandled render error: ${err.message}\n${err.stack ?? ""}\n${info.componentStack ?? ""}`
        )
      }
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
