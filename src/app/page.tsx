import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Brain, Bell, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const features = [
  {
    icon: BookOpen,
    title: "Real Canvas Data",
    body: "Pulls your actual assignments, due dates, and course load straight from Canvas LMS — no manual entry.",
  },
  {
    icon: Brain,
    title: "Find Your Rhythm",
    body: "Uses your activity in DuePulse to suggest useful times to start studying. The more you use it, the clearer the pattern.",
  },
  {
    icon: Bell,
    title: "Calm Nudges",
    body: "Deadline reminders with quiet hours and a pause button. Overdue reminders stop after three days.",
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_complete, canvas_token")
      .eq("id", user.id)
      .single();

    if (profile?.onboarding_complete && profile?.canvas_token) {
      redirect("/dashboard");
    }
    redirect("/onboarding");
  }

  return (
    <main className="flex flex-col flex-1 min-h-screen bg-background text-foreground">
      {/* ── Sticky nav ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="max-w-6xl mx-auto px-5 py-3 sm:px-8 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-sidebar-border bg-sidebar-accent shadow-none">
              <Zap size={15} className="text-sidebar-foreground" fill="currentColor" />
            </div>
            <span className="font-bold text-lg text-sidebar-foreground tracking-tight">
              DuePulse
            </span>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/features"
              className="text-sidebar-muted hover:text-sidebar-foreground text-sm transition-colors"
            >
              Features
            </Link>
            <Link
              href="/how-it-works"
              className="text-sidebar-muted hover:text-sidebar-foreground text-sm transition-colors"
            >
              How it works
            </Link>
          </nav>

          {/* CTA */}
          <Button
            asChild
            className="bg-sidebar-primary hover:bg-secondary text-sidebar-primary-foreground font-semibold text-sm h-9 px-4 rounded-sm shadow-none transition-all duration-200"
          >
            <Link href="/login">Get Started</Link>
          </Button>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="bg-background text-foreground flex flex-col items-center justify-center px-5 pt-16 pb-16 sm:pt-20 text-center w-full border-b border-border">
        {/* Eyebrow */}
        <div className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Zap size={13} />
          For students, by a student
        </div>

        <h1 className="font-bold text-3xl sm:text-4xl leading-tight max-w-2xl mb-5">
          Less sorting.{" "}
          <span className="text-foreground">More studying.</span>
        </h1>

        <p className="text-muted-foreground text-lg max-w-xl leading-relaxed mb-8">
          Your Canvas assignments, organised around what’s next.
          Plan the next two weeks, clear finished work, and get reminders that know when to stop.
        </p>

        <Button
          asChild
          className="bg-primary hover:bg-primary-hover text-primary-foreground font-semibold px-7 py-3 text-base h-auto rounded-sm shadow-none transition-colors"
        >
          <Link href="/login">Connect Your Canvas →</Link>
        </Button>
      </section>

      {/* ── Feature cards ───────────────────────────────────────────────────── */}
      <section id="features" className="py-16 px-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {features.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-sm bg-card border border-border p-6 shadow-none hover:border-info/40 hover:bg-surface-subtle transition-all duration-200"
            >
              <div className="w-10 h-10 rounded-sm bg-info-soft border border-info/20 flex items-center justify-center mb-4">
                <Icon className="text-info" size={18} />
              </div>
              <h2 className="text-foreground font-semibold text-base mb-2">
                {title}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="py-8 text-center border-t border-border mt-auto">
        <p className="text-muted-foreground text-sm">
          <Link href="/" className="text-info hover:text-info-hover transition-colors">
            DuePulse
          </Link>{" "}
          — Built for students, by a student.
        </p>
      </footer>
    </main>
  );
}
