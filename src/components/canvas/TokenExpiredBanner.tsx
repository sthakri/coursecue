"use client";

import Link from "next/link";
import { useCourseCueStore } from "@/lib/store";
import { AlertCircle, X } from "lucide-react";
import { useState } from "react";

export default function TokenExpiredBanner() {
  const tokenExpired = useCourseCueStore((s) => s.tokenExpired);
  const [dismissed, setDismissed] = useState(false);

  if (!tokenExpired || dismissed) return null;

  return (
    <div className="border-b border-danger/30 bg-danger-soft pl-14 pr-5 py-3 lg:pl-5">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5 text-sm">
          <AlertCircle size={16} className="shrink-0 text-danger" />
          <p className="text-foreground">
            <span className="font-semibold text-danger">Canvas connection issue.</span>{" "}
            <span className="text-body">Your Canvas token is invalid or expired — reconnect your account to resume syncing.</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/onboarding"
            className="rounded-sm bg-danger px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-danger-hover"
          >
            Reconnect
          </Link>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss banner"
            className="text-muted-foreground transition hover:text-body"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
