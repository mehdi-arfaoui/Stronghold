import { Link } from 'react-router-dom';

export default function NotFoundPage(): JSX.Element {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="panel max-w-xl p-10 text-center">
        <p className="text-xs uppercase tracking-[0.24em] text-subtle-foreground">404</p>
        <h1 className="mt-3 text-3xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The requested view does not exist in the DR workspace.
        </p>
        <Link
          to="/"
          className="btn-primary mt-6 inline-flex"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
