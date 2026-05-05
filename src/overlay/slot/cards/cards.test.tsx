import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VoiceRestingCard } from "./VoiceRestingCard";
import { PlanRevisionCard } from "./PlanRevisionCard";
import { ThreatSpikeCard } from "./ThreatSpikeCard";
import { EmptyPromptCard } from "./EmptyPromptCard";

describe("VoiceRestingCard", () => {
  it("renders the player question and the coach answer", () => {
    render(
      <VoiceRestingCard
        payload={{
          question: "should I rush rabadons?",
          answer: "yes - their team has 0 MR",
          timestamp: 0,
        }}
        pinned={false}
      />
    );
    expect(screen.getByText("should I rush rabadons?")).toBeInTheDocument();
    expect(screen.getByText("yes - their team has 0 MR")).toBeInTheDocument();
    expect(screen.getByText(/answering you/i)).toBeInTheDocument();
  });

  it("applies the pinned class when pinned is true", () => {
    const { container } = render(
      <VoiceRestingCard
        payload={{ question: "?", answer: "!", timestamp: 0 }}
        pinned
      />
    );
    const card = container.querySelector(
      "[data-testid='slot-card-voice-resting']"
    );
    expect(card?.className).toMatch(/pinned/);
  });
});

describe("PlanRevisionCard", () => {
  it("renders the rev number and pivot summary", () => {
    render(
      <PlanRevisionCard
        payload={{
          summary: "Pivoting from Collector to Kraken vs the armor stack.",
          rev: 3,
          timestamp: 0,
        }}
      />
    );
    expect(screen.getByText(/plan rev 3/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Pivoting from Collector to Kraken/)
    ).toBeInTheDocument();
  });

  it("invokes onAskWhy when the hint is clicked", () => {
    const onAskWhy = vi.fn();
    render(
      <PlanRevisionCard
        payload={{ summary: "x", rev: 1, timestamp: 0 }}
        onAskWhy={onAskWhy}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /tap to ask why/i }));
    expect(onAskWhy).toHaveBeenCalledOnce();
  });
});

describe("ThreatSpikeCard", () => {
  it("front-loads the threat noun and renders the reason", () => {
    render(
      <ThreatSpikeCard
        payload={{
          threat: "Veigar ult",
          reason: "stay outside cage range",
          timestamp: 0,
        }}
      />
    );
    expect(screen.getByText("Veigar ult")).toBeInTheDocument();
    expect(screen.getByText(/stay outside cage range/)).toBeInTheDocument();
    expect(screen.getByText(/threat/i)).toBeInTheDocument();
  });
});

describe("EmptyPromptCard", () => {
  it("renders the configured hotkey label inside the prompt", () => {
    render(<EmptyPromptCard hotkeyLabel="Num -" />);
    expect(screen.getByText("Num -")).toBeInTheDocument();
    expect(screen.getByText(/hold/i)).toBeInTheDocument();
    expect(screen.getByText(/listening/i)).toBeInTheDocument();
  });
});
