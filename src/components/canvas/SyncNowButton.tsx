"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCourseCueStore } from "@/lib/store";

export default function SyncNowButton() {
  const router = useRouter();
  const isSyncing = useCourseCueStore((s) => s.isSyncing);
  const setIsSyncing = useCourseCueStore((s) => s.setIsSyncing);
  const setTokenExpired = useCourseCueStore((s) => s.setTokenExpired);

  async function handleSync() {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/canvas/sync?source=manual", { method: "POST" });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        synced?: number;
        tokenExpired?: boolean;
        decryptFailed?: boolean;
      };
      if (!res.ok) {
        if (res.status === 401 && (data.tokenExpired || data.decryptFailed)) {
          setTokenExpired(true);
          const message = data.decryptFailed
            ? "Could not decrypt Canvas token — please reconnect your account"
            : "Canvas token expired — regenerate and reconnect";
          toast.error(message, {
            action: { label: "Reconnect", onClick: () => router.push("/onboarding") },
          });
        } else {
          toast.error(data.error ?? "Sync failed");
        }
        return;
      }
      setTokenExpired(false);
      toast.success(`Synced ${data.synced ?? 0} assignments`);
      router.refresh();
    } catch { toast.error("Network error — sync failed"); }
    finally { setIsSyncing(false); }
  }

  if (isSyncing) return <Skeleton className="h-9 w-24 rounded-sm bg-surface-subtle" />;

  return (
    <Button onClick={handleSync} className="bg-primary hover:bg-primary-hover text-white font-semibold text-sm rounded-sm shadow-none h-9 px-4">
      Sync Now
    </Button>
  );
}
