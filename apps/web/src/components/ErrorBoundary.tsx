import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { logger } from '@/utils/logger';
import { captureException } from '@/utils/sentry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional name for identifying which boundary caught the error */
  name?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("Uncaught error:", error, errorInfo);
    captureException(error, {
      componentStack: errorInfo.componentStack ?? undefined,
      boundary: this.props.name ?? 'unknown',
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div
          role="alert"
          aria-live="assertive"
          className="m-4 p-6 bg-pastel-surface-tile ring-1 ring-red-400/40 rounded-2xl text-pastel-cream flex flex-col items-center justify-center min-h-[200px]"
        >
          <div className="flex items-center gap-2 mb-3 text-base font-calistoga text-red-400">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            <span>Something went wrong</span>
          </div>
          <p className="text-sm text-white/55 mb-4 text-center max-w-md">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-6 py-2 bg-pastel-orange hover:bg-pastel-orange-soft text-pastel-surface rounded-md text-sm font-bold transition-all hover:-translate-y-0.5"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

