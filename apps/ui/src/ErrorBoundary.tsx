import { Component, type ReactNode } from "react";

/**
 * Catches an error while its children draw, and shows `fallback` instead of a blank
 * screen. A new `resetKey` (another level, another map) tries the children again (G13).
 */
export class ErrorBoundary extends Component<
  { resetKey: unknown; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(prev: { resetKey: unknown }): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
