import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBanners } from "./StatusBanners";
import type { SubsystemStatus } from "../lib/app-status";

function status(over: Partial<SubsystemStatus> = {}): SubsystemStatus {
  return {
    id: "gep",
    level: "broken",
    message: "Augment coaching is out of date and needs a restart.",
    ...over,
  };
}

function renderBanners(statuses: SubsystemStatus[]) {
  const onAction = vi.fn();
  render(<StatusBanners statuses={statuses} onAction={onAction} />);
  return { onAction };
}

describe("StatusBanners", () => {
  it("renders nothing when the app is healthy", () => {
    const { container } = render(
      <StatusBanners statuses={[]} onAction={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the message for each reported subsystem", () => {
    renderBanners([
      status({ id: "gep", message: "gep message" }),
      status({
        id: "settings",
        level: "degraded",
        message: "settings message",
      }),
    ]);
    expect(screen.getByText("gep message")).toBeInTheDocument();
    expect(screen.getByText("settings message")).toBeInTheDocument();
  });

  it("renders the list in the order it was given, worst first", () => {
    renderBanners([
      status({ id: "boot", message: "first" }),
      status({ id: "settings", level: "degraded", message: "second" }),
    ]);
    const texts = screen
      .getAllByRole("alert")
      .concat(screen.getAllByRole("status"))
      .map((el) => el.textContent);
    expect(texts[0]).toContain("first");
  });

  // A broken subsystem is an alert; a degraded one is a status. Screen readers
  // interrupt for the first and not the second, which is the whole difference
  // between "your app is missing a feature" and "here is a note".
  it("marks a broken subsystem as an alert and a degraded one as a status", () => {
    renderBanners([
      status({ id: "boot", level: "broken" }),
      status({ id: "settings", level: "degraded" }),
    ]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the detail when there is one", () => {
    renderBanners([status({ detail: "GEP v1 is below the floor v2." })]);
    expect(
      screen.getByText("GEP v1 is below the floor v2.")
    ).toBeInTheDocument();
  });

  it("offers no button when the status has no action", () => {
    renderBanners([status({ action: undefined })]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("labels a relaunch action as a restart", () => {
    const { onAction } = renderBanners([status({ action: "relaunch" })]);
    fireEvent.click(screen.getByRole("button", { name: /restart/i }));
    expect(onAction).toHaveBeenCalledWith("relaunch");
  });

  it("labels an open-logs action as opening logs", () => {
    const { onAction } = renderBanners([
      status({ level: "degraded", action: "open-logs" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /logs/i }));
    expect(onAction).toHaveBeenCalledWith("open-logs");
  });

  it("labels a retry action as a retry", () => {
    const { onAction } = renderBanners([
      status({ id: "data", level: "broken", action: "retry" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onAction).toHaveBeenCalledWith("retry");
  });

  // The updating level is the B track's seam. It must already render as
  // something calm rather than falling through to the red treatment.
  it("renders an updating status quietly, not as an alert", () => {
    renderBanners([
      status({ id: "app-update", level: "updating", message: "Update ready." }),
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
