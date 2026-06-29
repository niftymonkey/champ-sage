import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SummonerSpellImport } from "./SummonerSpellImport";

describe("SummonerSpellImport", () => {
  it("shows the recommended spell pair by name", () => {
    render(
      <SummonerSpellImport
        spell1Id={4}
        spell2Id={32}
        status="idle"
        onImport={() => {}}
      />
    );
    expect(screen.getByText(/Flash/)).toBeInTheDocument();
    expect(screen.getByText(/Mark/)).toBeInTheDocument();
  });

  it("invokes onImport when the button is clicked", () => {
    const onImport = vi.fn();
    render(
      <SummonerSpellImport
        spell1Id={4}
        spell2Id={32}
        status="idle"
        onImport={onImport}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("disables the button while importing", () => {
    render(
      <SummonerSpellImport
        spell1Id={4}
        spell2Id={32}
        status="importing"
        onImport={() => {}}
      />
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("confirms once imported", () => {
    render(
      <SummonerSpellImport
        spell1Id={4}
        spell2Id={32}
        status="done"
        onImport={() => {}}
      />
    );
    expect(
      screen.getByRole("button", { name: /imported/i })
    ).toBeInTheDocument();
  });

  it("surfaces a retryable error state", () => {
    render(
      <SummonerSpellImport
        spell1Id={4}
        spell2Id={32}
        status="error"
        onImport={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText(/couldn't set spells/i)).toBeInTheDocument();
  });
});
