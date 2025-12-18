import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          padding: '20px',
          fontFamily: 'sans-serif',
          backgroundColor: '#fef2f2',
          border: '2px solid #ef4444',
          borderRadius: '8px',
          color: '#dc2626',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>
            <span style={{ marginRight: '8px' }}>⚠️</span>
            <span>Render Error</span>
          </div>
          <pre style={{
            fontSize: '12px',
            backgroundColor: 'white',
            padding: '16px',
            borderRadius: '4px',
            border: '1px solid #fca5a5',
            overflow: 'auto',
            maxWidth: '90%',
            maxHeight: '400px'
          }}>
            <strong>Error Message:</strong>
            {this.state.error?.message || 'Unknown error'}
            
            {'\n\n'}
            <strong>Stack Trace:</strong>
            {this.state.error?.stack || 'No stack trace available'}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

