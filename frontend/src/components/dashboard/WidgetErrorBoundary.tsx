import { Component, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WidgetErrorBoundaryProps {
  children: ReactNode;
}

interface WidgetErrorBoundaryState {
  hasError: boolean;
  retryKey: number;
}

export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      retryKey: 0,
    };
  }

  static getDerivedStateFromError(): WidgetErrorBoundaryState {
    return {
      hasError: true,
      retryKey: 0,
    };
  }

  componentDidCatch(error: unknown) {
    // Widget errors are isolated and should not break the full dashboard.
    console.error('[DashboardWidget] render error', error);
  }

  private handleRetry = () => {
    this.setState((previous) => ({
      hasError: false,
      retryKey: previous.retryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-5 w-5 text-red-400" />
          <p className="text-xs text-muted-foreground">Impossible de charger</p>
          <Button type="button" size="sm" variant="outline" onClick={this.handleRetry}>
            Réessayer
          </Button>
        </div>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
