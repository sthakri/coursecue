"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

// Routes that should never trigger the install gate
const EXCLUDED_PREFIXES = ["/install", "/auth"];

function isMobileBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return false;

  // Already running as a standalone PWA — never gate
  if ((window.navigator as { standalone?: boolean }).standalone === true)
    return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;

  // Desktop browsers — never gate. iPadOS 13+ reports "Mac" UA, so also
  // check for a touch device to catch Safari on iPad.
  const ua = navigator.userAgent;
  if (!/iPhone|iPad|iPod|Android/i.test(ua) && !(ua.includes("Mac") && "ontouchend" in document))
    return false;

  return true;
}

function hasBypassed(): boolean {
  try {
    return sessionStorage.getItem("duepulse_install_bypass") === "true";
  } catch {
    return false;
  }
}

export default function MobileBrowserGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Skip if this route is excluded
    if (EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p))) return;

    // Skip if user already bypassed during this session
    if (hasBypassed()) return;

    // Only intercept if on a mobile browser (not standalone PWA, not desktop)
    if (isMobileBrowser()) {
      router.replace("/install");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
