import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * What the player loses if this boundary catches, in their words, e.g.
   * "the item recommendations". Omit for the whole-app boundary.
   */
  region?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Stops one broken component from taking the window with it.
 *
 * There were no boundaries at all before this. A component that threw during
 * render unmounted the entire React tree, which shows up as a blank window: the
 * process is alive, the logs look normal, and the app appears dead. That is the
 * same class of failure as a boot step killing the main process, and it gets
 * the same answer.
 *
 * Wrap regions, not just the root. A root-only boundary is honest but blunt:
 * a crash in the item list should cost the item list, not the whole surface.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  /**
   * Clears the caught error so the children render again.
   *
   * Worth offering because a render crash is often transient: a data shape that
   * arrived half-built resolves on the next render. Without a way back, one
   * unlucky frame stays broken until the player restarts the app.
   */
  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { region } = this.props;
    return (
      <div className="error-boundary" role="alert">
        <p className="error-boundary__message">
          {region
            ? `Something went wrong in ${region}. The rest of Champ Sage is still working.`
            : "Something went wrong and Champ Sage could not draw this screen."}
        </p>
        <p className="error-boundary__detail">{error.message}</p>
        <button
          type="button"
          className="error-boundary__action"
          onClick={this.reset}
        >
          Try again
        </button>
      </div>
    );
  }
}
