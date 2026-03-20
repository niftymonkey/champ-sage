import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";

vi.mock("./hooks/useGameData", () => ({
  useGameData: () => ({
    data: null,
    loading: true,
    error: null,
  }),
}));

describe("App", () => {
  it("renders the app title", () => {
    render(<App />);
    expect(screen.getByText("Champ Sage")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<App />);
    expect(screen.getByText("Loading game data...")).toBeInTheDocument();
  });
});
