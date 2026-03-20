import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [rustMessage, setRustMessage] = useState("");

  async function testBridge() {
    const message = await invoke<string>("greet", { name: "Champ Sage" });
    setRustMessage(message);
  }

  return (
    <main className="container">
      <h1>Champ Sage</h1>
      <p>State machine visualizer — modules will appear here as they are built.</p>
      <button onClick={testBridge}>Test Rust Bridge</button>
      {rustMessage && <p data-testid="rust-message">{rustMessage}</p>}
    </main>
  );
}

export default App;
