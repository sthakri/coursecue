import type { Metadata } from "next";
import { Lato } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  display: "swap",
  variable: "--font-lato",
});

export const metadata: Metadata = {
  title: "CourseCue",
  applicationName: "CourseCue",
  description: "Your Canvas assignments, organised around what’s next. Plan your coursework and get reminders that know when to stop.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="theme-color" content="#4B1610" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="CourseCue" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="default"
        />
      </head>
      <body
        className={`${lato.variable} font-sans min-h-full flex flex-col bg-background`}
      >
        {children}
        <Toaster theme="light" toastOptions={{ classNames: { toast: "!rounded-sm !border-border !bg-popover !text-popover-foreground", description: "!text-muted-foreground", actionButton: "!bg-primary !text-primary-foreground" } }} />
      </body>
    </html>
  );
}
