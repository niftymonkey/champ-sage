import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import { OverlayApp } from "./OverlayApp";

createRoot(document.getElementById("overlay-root")!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
);
