import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  moduleName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ModuleErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[${this.props.moduleName ?? 'Module'}] Error:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8">
          <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-semibold">Une erreur est survenue</h3>
          {this.props.moduleName && (
            <p className="text-sm text-muted-foreground mt-1">
              Module : {this.props.moduleName}
            </p>
          )}
          <p className="text-muted-foreground mt-2 text-sm max-w-md text-center">
            {this.state.error?.message || 'Erreur inattendue'}
          </p>
          <Button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4"
          >
            Reessayer
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export class GlobalErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Global] Unhandled error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-8 bg-background">
          <AlertTriangle className="w-16 h-16 text-red-500 mb-6" />
          <h2 className="text-xl font-bold mb-2">Erreur critique</h2>
          <p className="text-muted-foreground mb-6 text-center max-w-md">
            L'application a rencontre une erreur inattendue. Veuillez rafraichir la page.
          </p>
          <p className="text-xs text-muted-foreground mb-4 font-mono">
            {this.state.error?.message}
          </p>
          <div className="flex gap-3">
            <Button
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Reessayer
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Rafraichir la page
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
