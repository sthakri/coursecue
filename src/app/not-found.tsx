import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-background">
      <div className="text-center max-w-md">
        <h1 className="text-foreground font-bold text-4xl mb-3">404</h1>
        <p className="text-muted-foreground text-base mb-6">Page not found.</p>
        <Link
          href="/"
          className="rounded-sm bg-primary hover:bg-primary-hover text-white px-6 py-3 text-base font-semibold transition-colors shadow-none"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
