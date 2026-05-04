import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/tokens.css";
import { CoachingStripWindow } from "./CoachingStripWindow";

createRoot(document.getElementById("strip-root")!).render(
  <StrictMode>
    <CoachingStripWindow />
  </StrictMode>
);
