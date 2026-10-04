export type InstallPlatform = "ios" | "android";

const steps = {
  ios: [
    "Open CourseCue in Safari. If you arrived from an app such as LinkedIn, use its menu to open the page in Safari first.",
    "Tap More (•••) beside the address bar, then Share (the square with an upward arrow). Some Safari layouts show Share directly.",
    "Scroll down the share sheet and choose Add to Home Screen. If it is missing, choose Edit Actions and add it to the list.",
    "Leave Open as Web App turned on if shown, then tap Add.",
    "Open the CourseCue icon on your Home Screen, sign in, and tap Enable Nudges. Choose Allow when asked.",
  ],
  android: [
    "Open CourseCue in Chrome, outside the browser inside apps such as LinkedIn.",
    "Tap More (⋮) beside the address bar, then Install and create shortcut, then Install. Other versions show Install app or Add to Home screen.",
    "Confirm Install in the prompt. Follow any Home Screen placement prompt from your phone.",
    "Open CourseCue from your Home Screen or app drawer, sign in, and tap Enable Nudges. Allow notifications when asked.",
  ],
};

export default function InstallSteps({ platform }: { platform: InstallPlatform }) {
  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {steps[platform].map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-sm leading-relaxed">
            <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info-soft font-bold text-info">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        {platform === "ios"
          ? "Notifications need iOS or iPadOS 16.4 or later and the Home Screen app. You can still use the planner in a browser."
          : "If only Create shortcut appears, check that you are using an updated Chrome browser. Chrome notifications can also work without installation."}
      </p>
      <a className="inline-block text-sm text-info underline underline-offset-4" target="_blank" rel="noopener noreferrer"
        href={platform === "ios" ? "https://support.apple.com/guide/iphone/iphea86e5236/ios" : "https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en"}>
        {platform === "ios" ? "Apple’s installation guide" : "Google’s installation guide"} (opens in a new tab)
      </a>
    </div>
  );
}
