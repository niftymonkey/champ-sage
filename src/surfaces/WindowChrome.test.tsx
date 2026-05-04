import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { WindowChrome } from "./WindowChrome";

describe("WindowChrome", () => {
  it("renders the wordmark and all four nav tabs", () => {
    render(<WindowChrome surface="idle" onNavigate={() => {}} />);

    expect(screen.getByText("Champ Sage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In Game" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Settings" })
    ).toBeInTheDocument();
  });

  it("calls onNavigate with the tab id when a tab is clicked", () => {
    const onNavigate = vi.fn();
    render(<WindowChrome surface="idle" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("highlights IN GAME while the surface is champ-select", () => {
    // champ-select has no tab of its own; while the redesign's champ-select
    // surface is live, the IN GAME tab should read as the active one so the
    // user knows which tab "owns" the current screen.
    const { container } = render(
      <WindowChrome surface="champ-select" onNavigate={() => {}} />
    );

    const inGameTab = screen.getByRole("button", { name: "In Game" });
    expect(inGameTab.className).toContain("tabActive");
    // Sanity: only one tab should be active.
    const actives = container.querySelectorAll("[class*='tabActive']");
    expect(actives.length).toBe(1);
  });

  it("renders the eyebrow text and status slot when provided", () => {
    render(
      <WindowChrome
        surface="idle"
        onNavigate={() => {}}
        eyebrow="WELCOME BACK"
        statusContent={<span data-testid="status">live</span>}
      />
    );

    expect(screen.getByText("WELCOME BACK")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toBeInTheDocument();
  });
});
