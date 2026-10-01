import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardSidebar from "@/components/DashboardSidebar";
import AutoSync from "@/components/AutoSync";
import ProductiveWindowTracker from "@/components/ProductiveWindowTracker";
import TokenExpiredBanner from "@/components/TokenExpiredBanner";
import MobileBrowserGate from "@/components/MobileBrowserGate";

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
