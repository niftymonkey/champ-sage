import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  SummonerSpellImport,
  type SummonerSpellImportProps,
} from "./SummonerSpellImport";

const FLASH_ICON = "https://ddragon/cdn/16.13.1/img/spell/SummonerFlash.png";
const MARK_ICON = "https://ddragon/cdn/16.13.1/img/spell/SummonerSnowball.png";

function renderImport(overrides: Partial<SummonerSpellImportProps> = {}) {
  const props: SummonerSpellImportProps = {
    spell1Id: 4,
    spell2Id: 32,
    spell1Icon: FLASH_ICON,
    spell2Icon: MARK_ICON,
    status: "idle",
    onImport: () => {},
    ...overrides,
  };
  return render(<SummonerSpellImport {...props} />);
}

describe("SummonerSpellImport", () => {
  it("shows the recommended pair as icons with accessible names", () => {
    renderImport();
    // Icons are images; the spell name lives in alt text (so naming quirks
    // like Mark vs Snowball never surface visually).
    expect(screen.getByAltText("Flash")).toHaveAttribute("src", FLASH_ICON);
    expect(screen.getByAltText("Mark")).toHaveAttribute("src", MARK_ICON);
  });

  it("invokes onImport when the button is clicked", () => {
    const onImport = vi.fn();
    renderImport({ onImport });
    fireEvent.click(screen.getByRole("button"));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("disables the button while importing", () => {
    renderImport({ status: "importing" });
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("confirms once imported", () => {
    renderImport({ status: "done" });
    expect(
      screen.getByRole("button", { name: /imported/i })
    ).toBeInTheDocument();
  });

  it("surfaces a retryable error state", () => {
    renderImport({ status: "error" });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText(/couldn't set spells/i)).toBeInTheDocument();
  });
});
