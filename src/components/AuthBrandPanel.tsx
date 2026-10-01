import { BookOpen, Zap } from "lucide-react";

export default function AuthBrandPanel() {
  return (
    <aside className="hidden min-h-screen w-80 shrink-0 flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex xl:w-96">
      <div className="flex items-center gap-3 text-xl font-bold">
        <Zap size={28} className="text-brand-gold" aria-hidden="true" />
        DuePulse
      </div>
      <div>
        <BookOpen size={40} className="mb-6 text-brand-gold" aria-hidden="true" />
        <h2 className="text-3xl font-bold leading-tight">A clearer view of your coursework.</h2>
        <p className="mt-4 text-base leading-relaxed text-sidebar-muted">
          Your Canvas assignments, upcoming deadlines, and timely reminders in one place.
        </p>
        <div className="mt-8 border-t border-brand-gold/40 pt-6 text-sm text-sidebar-muted">
          Connected to Canvas. Built around you.
        </div>
      </div>
      <p className="text-xs text-sidebar-muted">Built for students, by a student.</p>
    </aside>
  );
}
