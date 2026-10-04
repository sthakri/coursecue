"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";

export default function FeedbackPage() {
  const [kind, setKind] = useState("Suggestion");
  const [message, setMessage] = useState("");
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 text-sm text-info hover:underline"><ArrowLeft size={16} /> Back to CourseCue</Link>
      <MessageSquare className="mb-4 mt-8 text-primary" size={28} aria-hidden="true" />
      <h1 className="text-3xl font-bold">Help make CourseCue better</h1>
      <p className="mt-3 text-muted-foreground">Something confusing, a bug, or an idea that would help you study? I’d like to hear it.</p>
      <form className="mt-7 space-y-5" onSubmit={(event) => {
        event.preventDefault();
        if (!message.trim()) return;
        window.location.href = `mailto:sthakritagya123@gmail.com?subject=${encodeURIComponent(`CourseCue ${kind.toLowerCase()}`)}&body=${encodeURIComponent(message.trim())}`;
      }}>
        <label className="block text-sm font-semibold">What would you like to share?
          <select value={kind} onChange={e => setKind(e.target.value)} className="mt-2 min-h-11 w-full rounded-sm border border-input bg-background px-3">
            <option>Suggestion</option><option>Bug report</option><option>Question</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">Your feedback
          <textarea required maxLength={2000} rows={7} value={message} onChange={e => setMessage(e.target.value)} placeholder="What happened, and what were you hoping to do? For a bug, include your browser and device." className="mt-2 w-full resize-y rounded-sm border border-input bg-background p-3 font-normal" aria-describedby="feedback-privacy" />
        </label>
        <p id="feedback-privacy" className="text-sm text-muted-foreground">Please leave out passwords, Canvas tokens, grades, and other private coursework. Nothing is sent automatically.</p>
        <button type="submit" disabled={!message.trim()} className="min-h-11 rounded-sm bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50">Open email draft</button>
        <p className="text-sm text-muted-foreground">Review and send the draft in your email app. If it doesn’t open, copy your message and email <a href="mailto:sthakritagya123@gmail.com" className="break-all text-info underline">sthakritagya123@gmail.com</a>.</p>
      </form>
      <p className="mt-8 border-t border-border pt-5 text-sm text-muted-foreground">Prefer GitHub? <a href="https://github.com/sthakri/coursecue/issues/new" target="_blank" rel="noopener noreferrer" className="text-info underline">Open a public issue</a> (requires a GitHub account).</p>
    </main>
  );
}
