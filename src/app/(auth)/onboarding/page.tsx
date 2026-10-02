import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OnboardingWizard from "@/components/auth/OnboardingWizard";

export const metadata = {
  title: "Get Started — DuePulse",
  description: "Connect your Canvas account and set up DuePulse.",
};

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <OnboardingWizard userEmail={user?.email} />
    </main>
  );
}
