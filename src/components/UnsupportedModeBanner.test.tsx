import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UnsupportedModeBanner } from "./UnsupportedModeBanner";

describe("UnsupportedModeBanner", () => {
  it("renders nothing when the mode was recognized", () => {
    const { container } = render(<UnsupportedModeBanner gameMode={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells the player coaching is off for an unrecognized mode", () => {
    render(<UnsupportedModeBanner gameMode="KIWI_JADE" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/coaching is off/i);
  });

  it("names the mode so the report is actionable", () => {
    render(<UnsupportedModeBanner gameMode="KIWI_JADE" />);
    expect(screen.getByRole("status")).toHaveTextContent("KIWI_JADE");
  });

  // The whole point of this banner is that staying silent was the bug: an
  // unmodeled mode used to resolve to the nearest registered one and produce
  // confident advice about the wrong item shop. Saying nothing beats saying
  // something wrong, but only if the player is told which one is happening.
  it("says why it is quiet rather than implying the app is broken", () => {
    render(<UnsupportedModeBanner gameMode="KIWI_JADE" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /does not support this game mode yet/i
    );
  });
});
