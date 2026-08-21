import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ when = true }: { when?: boolean }) {
  if (when) throw new Error("component exploded");
  return <div>recovered content</div>;
}

beforeEach(() => {
  // React logs every caught error to console.error. Silencing it keeps the
  // suite readable; the assertions below prove the boundary saw the error.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>healthy content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("healthy content")).toBeInTheDocument();
  });

  // Zero boundaries existed before this. One component throwing during render
  // unmounted the whole React tree, which is a blank window: the app is running
  // and looks dead.
  it("shows a fallback instead of unmounting the tree", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("names the region it guards, so the player knows what they lost", () => {
    render(
      <ErrorBoundary region="the item recommendations">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/the item recommendations/i)).toBeInTheDocument();
  });

  it("says the whole app broke when it guards no particular region", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert").textContent ?? "").toMatch(/champ sage/i);
  });

  it("hands the error to onError so it can be logged", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe("component exploded");
  });

  // A transient render error (a data shape that arrived half-built) is fixed by
  // rendering again. Without a way back, a one-off crash is permanent until the
  // player restarts the app.
  it("re-renders the children when the player asks it to try again", () => {
    function Flaky() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button onClick={() => setBroken(false)}>fix it</button>
          <ErrorBoundary>
            <Boom when={broken} />
          </ErrorBoundary>
        </>
      );
    }
    render(<Flaky />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /fix it/i }));
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered content")).toBeInTheDocument();
  });

  it("shows the fallback again if trying again throws again", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the error message, since the player is the one reporting it", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/component exploded/)).toBeInTheDocument();
  });
});
