# DuePulse UI registry

Updated 2026-10-01. Texas State (San Marcos) Canvas theme requested by the user.
Research, palette and implementation schema: [docs/DESIGN.md](docs/DESIGN.md).
Runtime tokens: `src/app/globals.css`. Vendor `src/components/ui/` files remain unchanged.

## Consistency audit

Public, auth, install, dashboard, assignments, insights, settings, loading, error, 404 and notification components share semantic tokens. Primary/navigation #4B1610 and ivory labels #E1D9CE match the live TXST Canvas account theme. White content, sandstone secondary surfaces and restrained gold accents replace the generic blue/charcoal theme. Imported course colors remain data accents; course names use readable neutral text.

### Auth brand panel

File: `src/components/AuthBrandPanel.tsx` · Updated 2026-10-01

| Property | Pattern |
| --- | --- |
| Background | `bg-sidebar` |
| Text | `text-sidebar-foreground`, `text-sidebar-muted` |
| Heading | `text-3xl font-bold leading-tight` |
| Divider | `border-sidebar-border` |
| Spacing | `p-10`, `mt-4`, `mt-8` |
| Shadow | None |
| Accent | `text-brand-gold`, `border-brand-gold/40` on maroon only |

Shared by login and password reset. Keep content surfaces white and use the panel only at desktop widths.

### Navigation

File: `src/components/DashboardSidebar.tsx` · Updated 2026-10-01

| Property | Pattern |
| --- | --- |
| Background | `bg-sidebar` |
| Border | `border-sidebar-border` |
| Radius | `rounded-sm` |
| Inactive text | `text-sidebar-muted` |
| Active | `bg-sidebar-primary text-sidebar-primary-foreground`, `aria-current="page"` |
| Hover | `hover:bg-sidebar-accent hover:text-sidebar-foreground` |
| Row spacing | `px-3 py-2.5 gap-3` |
| Focus | White outline inside maroon navigation |
| Shadow | Drawer/dialog only: `shadow-lg` |

Collapsed links retain accessible names. The mobile menu button needs clear space in headers and banners.

### Panels and charts

Files: `WorkloadHeatmap.tsx`, `ProductiveWindowsChart.tsx`, `BehavioralInsightCard.tsx`, dashboard pages · Updated 2026-10-01

| Property | Pattern |
| --- | --- |
| Background | `bg-card` |
| Border | `border border-border` |
| Radius | `rounded-sm` |
| Heading | `text-foreground font-semibold text-base` |
| Supporting text | `text-muted-foreground text-xs` or `text-sm` |
| Spacing | `p-5 sm:p-6`, `gap-5` |
| Shadow | None |
| SVG colors | `var(--primary)`, `var(--primary-hover)`, `var(--muted-foreground)`, `var(--chart-empty)` |

D3 interpolates resolved token values. Cell numbers choose black/white from fill luminance with at least 4.5:1 contrast. Charts expose headings and accessible descriptions. Dense activity grids scroll within their panel on mobile.

### Assignment cards and filters

Files: `src/components/AssignmentCard.tsx`, `AssignmentsClient.tsx` · Updated 2026-10-01

| Property | Pattern |
| --- | --- |
| Card | `bg-card border-border rounded-sm p-4 gap-2 shadow-none` |
| Completed surface | `bg-surface-subtle` |
| Title | `text-foreground font-semibold text-base` |
| Course label | `text-muted-foreground text-xs`, reserve space for card actions |
| Hover | `hover:border-primary/40 hover:bg-surface-subtle` |
| Selected filter | `bg-primary-soft border-primary/25 text-primary`, `aria-pressed` |
| Selected course | `bg-primary-soft border-primary text-foreground` |
| Status | `bg-danger-soft text-danger`, `bg-warning-soft text-warning`, `bg-success-soft text-success` |

Status must include text. Keep card text fully opaque; use course colors only as accents.
Assignment actions use visible labels and a 40px minimum height. Mark complete uses
`bg-primary text-primary-foreground`; Dismiss uses `border-input` and opens an inline
confirmation (`bg-warning-soft border-warning`). Explain that these actions update
DuePulse only. Disable both actions while either request is pending.

### Forms and actions

Files: auth pages, `OnboardingWizard.tsx`, `SettingsForm.tsx`, sync/push/test buttons · Updated 2026-10-01

| Property | Pattern |
| --- | --- |
| Input | `rounded-sm bg-background border border-input text-foreground` |
| Placeholder | `placeholder:text-muted-foreground` |
| Label | `text-body text-sm`, associated with the field |
| Primary action | `rounded-sm bg-primary hover:bg-primary-hover text-primary-foreground shadow-none` |
| Secondary action | `bg-card border-border text-muted-foreground hover:bg-surface-subtle` |
| Focus | 2px semantic maroon outline; radios highlight their containing label |
| Switch | `bg-input peer-checked:bg-primary`, named `role="switch"` |
| Selected radio | `border-primary bg-primary-soft`; native keyboard selection |

Keep controlled settings stable after save. Hidden pause-duration buttons are disabled. Password/token visibility controls have explicit names.

### Alerts, dialogs and toasts

Files: `StressAlert.tsx`, `TokenExpiredBanner.tsx`, `DashboardSidebar.tsx`, root layout · Updated 2026-10-01

| Property | Pattern |
| --- | --- |
| Warning | `bg-warning-soft border-warning/25 text-warning` |
| Error | `bg-danger-soft border-danger/30 text-danger` |
| Dialog | `rounded-md bg-card border-border p-6 shadow-lg` |
| Overlay | `bg-overlay/55` |
| Toast | Light theme, white popover, neutral text/border, maroon action |
| Spacing | `p-4 gap-3`; banner stacks on mobile |

Errors and warnings include icons/text. Reserve left space for the mobile menu in shell banners. Dismiss buttons have accessible names.

### Public and installation screens

Files: home, features, how-it-works, install, `MobileInstallGuide.tsx`, error/loading/404 · Updated 2026-10-01

| Property | Pattern |
| --- | --- |
| Page | `bg-background text-foreground` |
| Header | `bg-sidebar text-sidebar-foreground border-brand-gold/40`, ivory nav links, white action with maroon text |
| Blocks | `bg-card border-border rounded-sm` |
| Accent | `text-primary`, `bg-primary-soft` |
| Body | `text-muted-foreground`, readable opaque text |
| Skeleton | `bg-surface-subtle` or `bg-muted` |
| Shadow | None |

Public header brand marks use `text-brand-gold` on maroon, with `bg-sidebar-accent`. Header actions use `bg-sidebar-primary text-sidebar-primary-foreground hover:bg-primary-soft`. White focus outlines keep header links visible. Body actions remain maroon with white text.

PWA uses a white splash background and TXST Canvas maroon browser chrome. App icons share the authored maroon-and-white lightning SVG in `public/icons/icon.svg`.
