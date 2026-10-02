# DuePulse UI registry

Updated 2026-10-01. The user's two Texas State Canvas dashboard screenshots are the current visual reference and supersede the wine/parchment/brass treatment.
Runtime tokens: `src/app/globals.css`. Vendor `src/components/ui/` files stay unchanged.

## Reference and consistency audit

Sampled reference colors: white workspace/cards #FFFFFF, maroon navigation #4B1610, ivory navigation labels #E1D9CE, dark headings #273540, neutral controls #F2F4F4, borders #D7DADE, and blue coursework accents #E0EBF5. DuePulse's blue text #0069B5, muted text #526575 and status text are chosen to meet text contrast requirements. These are screenshot-based adaptations; DuePulse keeps its own lightning identity.

The reference has no tan workspace, gold selection, or dark page title banners. Maroon belongs to navigation and primary/selected controls. Content surfaces stay white. Blue identifies coursework and links; gray separates controls and sections. Green/red indicate labeled status. Existing course colors remain small data markers, never text colors.

### Navigation

File: `src/components/DashboardSidebar.tsx`

| Property | Pattern |
| --- | --- |
| Rail | `bg-sidebar`, 96px desktop, icon above label |
| Inactive | `text-sidebar-muted` |
| Active | `bg-sidebar-primary text-sidebar-primary-foreground`, white row with maroon text and `aria-current="page"` |
| Hover | `hover:bg-sidebar-accent hover:text-sidebar-foreground` |
| Focus | Ivory outline on maroon; blue inset outline on the selected white row |
| Mobile | 256px drawer with horizontal icon/label rows |
| Identity | Ivory lightning; own DuePulse identity |

Collapsed links and sign out retain explicit accessible names. Collapse/expand remains available by keyboard.

### Page headings and panels

Files: dashboard, assignments, insights, settings, `WorkloadHeatmap.tsx`, `SettingsForm.tsx`

| Property | Pattern |
| --- | --- |
| Page | `bg-background text-foreground` (white) |
| Page heading | `text-2xl sm:text-3xl font-semibold`, white toolbar and neutral bottom border |
| Supporting section heading | `text-2xl font-semibold` or `text-lg font-semibold` in cards |
| Description | `text-muted-foreground text-sm` |
| Panel | `bg-card border border-border rounded-md`, subtle `shadow-sm` where grouped content needs separation |
| Spacing | `p-5 sm:p-6`, `gap-5`/`gap-6` |
| Charts | Blue data fills `--chart-1`, `--chart-high`, gray `--chart-empty`; maroon may mark today |

No maroon-and-gold page banners or decorative thick card borders. Chart labels choose black/white from fill luminance. Charts have accessible descriptions; wide activity grids scroll inside their panel.

### Assignment rows and controls

Files: `AssignmentCard.tsx`, `AssignmentsClient.tsx`, `assignments/AssignmentGroups.tsx`

| Property | Pattern |
| --- | --- |
| Row | `bg-card border-b border-border p-4 rounded-sm shadow-none` |
| Icon tile | `bg-info-soft text-info`, desktop only |
| Title | `text-info font-semibold text-sm`; completed text stays muted and struck through |
| Course | `text-muted-foreground text-xs`, small course-color marker |
| Deadline | `bg-info-soft text-info`; overdue uses labeled danger status |
| Completed | `bg-surface-subtle`, visible status and restore action |
| Date heading | `text-foreground text-sm font-semibold`, natural case |
| Selected view | `bg-primary border-primary text-primary-foreground`, `aria-pressed` |
| Search/select | White background, `border-input`, labels and 44px minimum height |
| Action | Maroon primary, neutral outlined secondary, 40px minimum height |

Date groups, pages of 20, range choices, URL filters and overdue resolution behavior remain in place. Dismiss uses an inline confirmation. Both actions explain that they update DuePulse only and are disabled during pending requests.

### Forms, alerts and auth

Files: auth, `AuthBrandPanel.tsx`, onboarding, settings, notifications and banners

| Property | Pattern |
| --- | --- |
| Input | `bg-background border-input rounded-sm text-foreground` |
| Primary button | `bg-primary hover:bg-primary-hover text-primary-foreground` |
| Secondary | White/neutral gray, visible border, dark text |
| Text link | `text-info hover:text-info-hover` |
| Focus | 2px blue outline, 3px offset |
| Auth brand panel | Maroon/ivory, neutral sidebar divider; white form workspace |
| Error | `bg-danger-soft text-danger`, text and icon |
| Warning | `bg-warning-soft text-warning`, text and icon |
| Success | `bg-success-soft text-success`, visible label |
| Dialog/toast | White semantic card/popover, neutral border, maroon primary action |

Settings headings use foreground text and subtle neutral panel borders. All existing notification, login and onboarding behavior is preserved.

### Public and install pages

Files: home, features, how-it-works, install, `MobileInstallGuide.tsx`, loading/error/404

White page backgrounds, dark headings, neutral separators and blue information tiles. Public navigation is maroon/ivory with a white action; body calls to action are maroon/white. Home hero stays white. PWA splash is white, browser chrome is #4B1610, and existing maroon/white icons match the palette.

## Verification

Contrast regression covers normal text at 4.5:1, input boundaries at 3:1, and chart interpolation. Browser checks cover the actual planner/settings/chart components using a removable synthetic fixture and public/auth/install pages at mobile and desktop widths. No fixture is shipped.
