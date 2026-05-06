import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import App from "./App";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
