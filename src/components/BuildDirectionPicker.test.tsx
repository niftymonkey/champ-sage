import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BuildDirectionPicker } from "./BuildDirectionPicker";
import type { Champion } from "../lib/data-ingest/types";

function makeChampion(tag: string): Champion {
  return {
    id: "X",
    key: 1,
    name: "X",
    title: "",
    tags: [tag],
    partype: "Mana",
    stats: {
      hp: 600,
      hpperlevel: 100,
      mp: 300,
      mpperlevel: 50,
      movespeed: 340,
      armor: 30,
      armorperlevel: 4,
      spellblock: 30,
      spellblockperlevel: 2,
      attackrange: 175,
      hpregen: 5,
      hpregenperlevel: 0.5,
      mpregen: 7,
      mpregenperlevel: 0.5,
      attackdamage: 60,
      attackdamageperlevel: 3,
      attackspeed: 0.65,
      attackspeedperlevel: 3,
    },
    image: "",
  };
}

describe("BuildDirectionPicker", () => {
  it("renders one button per direction", () => {
    render(<BuildDirectionPicker value={null} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "AD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tank" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Support" })).toBeInTheDocument();
  });

  it("calls onChange with the clicked direction", () => {
    const onChange = vi.fn();
    render(<BuildDirectionPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "AP" }));
    expect(onChange).toHaveBeenCalledWith("ap");
  });

  it("marks the selected direction with aria-pressed=true", () => {
    render(<BuildDirectionPicker value="tank" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Tank" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "AD" }).getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("highlights the champion's stereotype when value is null", () => {
    render(
      <BuildDirectionPicker
        value={null}
        onChange={() => {}}
        champion={makeChampion("Mage")}
      />
    );
    const ap = screen.getByRole("button", { name: "AP" });
    expect(ap.getAttribute("data-stereotype")).toBe("true");
    const ad = screen.getByRole("button", { name: "AD" });
    expect(ad.getAttribute("data-stereotype")).toBe("false");
  });

  it("does not mark stereotype when an explicit value is set", () => {
    render(
      <BuildDirectionPicker
        value="ad"
        onChange={() => {}}
        champion={makeChampion("Mage")}
      />
    );
    const ap = screen.getByRole("button", { name: "AP" });
    expect(ap.getAttribute("data-stereotype")).toBe("false");
  });

  it("uses vertical orientation when prop set", () => {
    const { container } = render(
      <BuildDirectionPicker
        value={null}
        onChange={() => {}}
        orientation="vertical"
      />
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "pickerVertical"
    );
  });
});
