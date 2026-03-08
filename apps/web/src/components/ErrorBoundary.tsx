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
          style={{
            padding: '20px',
            fontFamily: 'sans-serif',
            backgroundColor: '#fef2f2',
            border: '2px solid #ef4444',
            borderRadius: '8px',
            color: '#dc2626',
            minHeight: '200px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
            <AlertCircle style={{ marginRight: '8px', width: 20, height: 20 }} aria-hidden="true" />
            <span>Something went wrong</span>
          </div>
          <p style={{ color: '#666', marginBottom: '16px', fontSize: '14px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            style={{ padding: '8px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

