import * as Sentry from "@sentry/react";
import React from "react";
import { ErrorDisplay } from "./error-display";

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
  errorId?: string;
};

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ComponentType<{
    error: Error;
    resetError: () => void;
    errorId?: string;
  }>;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    const eventId = Sentry.captureReactException(error, errorInfo, {
      tags: { area: "react.errorBoundary" },
    });
    // Only an ID that was actually reported is worth showing to the user.
    if (Sentry.getClient()) {
      this.setState({ errorId: eventId });
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined, errorId: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback && this.state.error) {
        const FallbackComponent = this.props.fallback;
        return (
          <FallbackComponent
            error={this.state.error}
            errorId={this.state.errorId}
            resetError={this.resetError}
          />
        );
      }

      return (
        <ErrorDisplay
          error={this.state.error}
          errorId={this.state.errorId}
          onRetry={this.resetError}
        />
      );
    }

    return this.props.children;
  }
}
