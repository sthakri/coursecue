import Link from "next/link";
import { Zap, PlugZap, CalendarDays, Cpu, Bell } from "lucide-react";

export const metadata = {
  title: "How It Works — CourseCue",
  description:
    "Connect Canvas, let CourseCue learn your patterns, and receive exactly the right nudge at the right moment.",
};

const steps = [
  {
    number: "01",
    icon: PlugZap,
    title: "Connect your Canvas account",
    body: "Enter your Canvas domain and a personal access token — one-time setup that takes under two minutes. CourseCue immediately reads your courses, assignments, and due dates.",
    detail: "Canvas → Account → Settings → New Access Token. Your token is encrypted at rest and never shared.",
  },
  {
    number: "02",
    icon: CalendarDays,
    title: "CourseCue reads your deadlines",
    body: "Every assignment, every due date, every course color — pulled straight from Canvas. No copy-pasting. No manual calendar entries. Everything stays in sync.",
    detail: "Hit Sync Now to pull the latest at any time. Sync also runs automatically in the background via scheduled jobs.",
  },
  {
    number: "03",
    icon: Cpu,
    title: "Your focus patterns are learned",
    body: "While you use the dashboard — on any device, at any hour — CourseCue quietly logs your active time. Over days and weeks, a personal model forms.",
    detail: 'Your "Focus Persona" (Early Bird, Night Owl, Weekend Grinder…) and your personal Power Block emerge automatically.',
  },
  {
    number: "04",
    icon: Bell,
    title: "You get the right nudge at the right moment",
    body: "When an assignment is coming up AND you're historically likely to sit down and work, CourseCue sends a push notification — written by AI for that specific assignment.",
    detail: "Three modes: Aggressive, Normal, Minimal. Quiet Hours blocks late-night nudges.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-background min-h-screen flex flex-col text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-sidebar-border bg-sidebar-accent shadow-none">
              <Zap size={15} className="text-sidebar-foreground" fill="currentColor" />
            </div>
            <span className="font-bold text-sidebar-foreground tracking-tight">CourseCue</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/features" className="text-sm text-sidebar-muted hover:text-sidebar-foreground transition-colors">Features</Link>
            <Link href="/how-it-works" className="text-sm text-sidebar-foreground font-medium">How it works</Link>
          </nav>
          <Link href="/login" className="rounded-sm bg-sidebar-primary hover:bg-secondary text-sidebar-primary-foreground text-sm font-semibold px-4 py-2 transition-colors shadow-none">
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-5 pt-20 pb-16 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info-soft px-3 py-1 text-xs font-medium text-info mb-6">
          <Zap size={11} fill="currentColor" /> 4 steps
        </span>
        <h1 className="text-foreground font-extrabold text-4xl sm:text-5xl leading-tight tracking-tight mb-4">
          From Canvas to calm —{" "}
          <span className="text-info">here&apos;s how it works.</span>
        </h1>
        <p className="text-body text-lg leading-relaxed max-w-xl mx-auto">
          CourseCue is a system, not just an app. Each piece builds on the last, creating something that gets smarter the longer you use it.
        </p>
      </section>

      {/* Steps */}
      <section className="max-w-3xl mx-auto px-5 pb-24 w-full">
        <div className="relative flex flex-col gap-0">
          <div className="absolute left-[27px] top-14 bottom-14 w-px     hidden sm:block" />
          {steps.map(({ number, icon: Icon, title, body, detail }, i) => (
            <div key={number} className="flex gap-6 sm:gap-8 pb-10 last:pb-0">
              <div className="flex flex-col items-center gap-0 shrink-0">
                <div className="w-14 h-14 rounded-sm bg-card border border-info/30 flex items-center justify-center relative z-10 shadow-none">
                  <Icon size={22} className="text-info" />
                </div>
              </div>
              <div className="flex-1 min-w-0 pt-2 pb-2">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-info font-bold text-sm font-mono">{number}</span>
                  <h2 className="text-foreground font-bold text-xl leading-tight">{title}</h2>
                </div>
                <p className="text-body text-base leading-relaxed mb-3">{body}</p>
                <div className="rounded-sm bg-card border border-border px-4 py-3">
                  <p className="text-muted-foreground text-sm leading-relaxed">{detail}</p>
                </div>
                {i < steps.length - 1 && (
                  <div className="flex items-center gap-2 mt-6 mb-2 sm:hidden">
                    <div className="flex-1 h-px bg-muted" />
                    <span className="text-muted-foreground text-xs">↓</span>
                    <div className="flex-1 h-px bg-muted" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-5 pb-20 w-full">
        <div className="rounded-sm border border-border bg-card divide-y divide-border/50">
          {[
            { q: "Is my Canvas token safe?", a: "Yes. Your token is stored encrypted in our database (Supabase with row-level security) and is never exposed in responses or logs." },
            { q: "Do notifications work on iPhone?", a: "Yes, but only when CourseCue is installed as a standalone app (Add to Home Screen). Safari browser tabs can't receive background push notifications — it's an iOS limitation." },
            { q: "How long until CourseCue learns my patterns?", a: "You'll see basic stats immediately. A meaningful focus model forms after 3–7 days of regular visits." },
          ].map(({ q, a }) => (
            <div key={q} className="px-6 py-5">
              <p className="text-foreground font-semibold text-sm mb-1.5">{q}</p>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-2xl mx-auto px-5 pb-24 text-center">
        <div className="rounded-sm border border-info/25 bg-info-soft p-10">
          <h2 className="text-foreground font-bold text-2xl mb-3">See it for yourself</h2>
          <p className="text-body text-base mb-6">It takes two minutes to connect Canvas and the rest happens on its own.</p>
          <Link href="/login" className="inline-flex items-center gap-2 rounded-sm bg-primary hover:bg-primary-hover text-white font-semibold px-7 py-3 text-base transition-colors shadow-none">
            Get Started — it&apos;s free
          </Link>
        </div>
      </section>

      <footer className="border-t border-border mt-auto py-6 text-center">
        <p className="text-muted-foreground text-xs">CourseCue — Built for students, by a student.</p>
      </footer>
    </div>
  );
}
