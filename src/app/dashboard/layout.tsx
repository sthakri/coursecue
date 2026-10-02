import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import AutoSync from "@/components/canvas/AutoSync";
import ProductiveWindowTracker from "@/components/insights/ProductiveWindowTracker";
import TokenExpiredBanner from "@/components/canvas/TokenExpiredBanner";
import MobileBrowserGate from "@/components/pwa/MobileBrowserGate";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Onboarding gate — an authenticated-but-not-onboarded user landing here
  // sees an empty dashboard with no way forward. Send them through the wizard.
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_complete, canvas_token")
    .eq("id", user.id)
    .single();
  if (!profile?.onboarding_complete || !profile?.canvas_token) redirect("/onboarding");

  const initial = user.email?.charAt(0).toUpperCase() ?? "?";

  return (
    <div className="bg-background min-h-screen flex">
      <MobileBrowserGate />
      <DashboardSidebar email={user.email ?? ""} initial={initial} />
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <TokenExpiredBanner />
        <AutoSync />
        <ProductiveWindowTracker />
        {children}
      </div>
    </div>
  );
}
