# StorePOS Web

Modern retail-store POS and cloud operations dashboard by **Mark Reymuel Pascual**.

## Product identity
- App code: `storepos`
- Business type: `retail`
- Shared Supabase backend with MotoPOS
- StorePOS shops, plans and app updates are isolated from MotoPOS

## Core modules
POS, inventory, barcode/SKU, customers, suppliers, cashier operations, receivables, physical counts, loyalty/store credit, reports, staff, branches, stock transfers, support and licensing.

## Deployment
GitHub Pages is deployed from the `web/` directory by GitHub Actions.


## v1.3.0
- Retail Control Center
- Price checker
- Existing barcode-assisted physical stocktake surfaced in cloud operations
- Supplier cost comparison with reorder-to-PO suggestions
- GCash/Maya/card/bank reconciliation
- Live X reports plus existing finalized Z reports
- Manager approval queue
- Audited receipt reprints with numbered copies
- StorePOS data-health checks


## v1.4.0 — Commercial UI Rework
- Reworked the StorePOS public website into a retail-focused commercial product experience.
- Redesigned the Cloud Console with a dark operational sidebar and clean light workspace.
- Refined dashboard cards, tables, forms, modals, alerts, support, manual and customer-portal surfaces.
- Improved retail product messaging and removed workshop-oriented positioning from the StorePOS landing page.
- Improved responsive layouts for tablet and mobile browsers without changing existing StorePOS data workflows.


## v1.4.1 — MotoPOS Interface Parity
- Restored the same dark visual system used by MotoPOS Cloud.
- Matched the MotoPOS sidebar, top bar, cards, metrics, tables, forms, dialogs, animations and responsive behavior.
- Kept StorePOS branding, retail copy, routes and retail-only modules intact.
- Preserved StorePOS Turnstile verification styling and existing data workflows.


## v1.5.0 — Retail Cloud Redesign
- Rebuilt the StorePOS visual identity around a clean green-and-slate retail cloud design.
- Added a new commercial public website with product, workflow, hardware, pricing and trial sections.
- Reorganized Cloud navigation into Workspace, Products, Operations, Business and System groups.
- Added a global StorePOS search surface for products, customers and receipt numbers.
- Reworked Overview into a retail command center with KPI cards, 7-day sales visualization, attention center, quick actions and recent transactions.
- Reworked Sales with dashboard metrics, search and status filtering.
- Reworked Inventory with product search, category/status filters, margin visibility and cleaner product rows.
- Updated authentication, dialogs, reports, portal/manual surfaces and responsive tablet/mobile styling to the new StorePOS design system.
- Existing StorePOS Supabase workflows and retail modules remain intact.


## v1.5.1 — Resources Hub
- Added a dedicated public `#/resources` page.
- Official StorePOS Android v1.6.1 APK and release notes are surfaced directly.
- Official StorePOS Terminal Launcher v1.2.0 APK, release notes and checksum file are surfaced directly.
- Added SHA-256 verification values and copy controls.
- Added Device Owner / kiosk provisioning guidance with the official launcher component.
- Added direct access to the StorePOS manual from the Resources hub.
- Removed the StorePOS-Web repository as the primary public Resources destination; it remains available only as website source.


## v1.5.2 — Turnstile Recovery
- Switched the StorePOS web Turnstile widget to the light, flexible presentation used by the redesigned login card.
- Enabled automatic Turnstile retry with a shorter recovery interval.
- Enabled automatic refresh for expired and timed-out challenges.
- Added exact Cloudflare Turnstile error-code display instead of the previous generic failure toast.
- Added an in-page Retry action and specific messages for invalid site key, unauthorized hostname, timeout, clock/cache issues and browser challenge failures.
- Added unsupported-browser and script-load diagnostics.


## v1.5.2 — StorePOS Staff Fix
- Rebuilt the live `invite-staff` Edge Function around StorePOS-native shop and license rules.
- Removed MotoPOS plan names and motorcycle/mechanic role logic from StorePOS staff creation.
- StorePOS owners and shop admins can create Cashier, Inventory Staff, Manager and Shop Admin accounts.
- Validates the target shop as `app_code = storepos` and `business_type = retail`.
- Uses StorePOS plan features and custom feature overrides when checking Staff Management access.
- Enforces the StorePOS license/trial expiry and max-staff limit.
- Creates the Auth user, user profile, shop membership and audit event as one guarded workflow with cleanup on failure.


## v1.5.3 — Staff Management v2
- Upgraded the live `invite-staff` Supabase Edge Function to StorePOS-native v4.
- Owner/shop-admin authorization is validated server-side against the exact StorePOS shop.
- New staff roles are limited to Cashier, Inventory Staff and Manager.
- StorePOS plan, Staff feature, expiration and active-account limits are enforced server-side.
- Existing Supabase accounts can be linked safely without resetting their existing password.
- Newly created staff accounts are marked for a required password change on first StorePOS Cloud sign-in.
- Added server-side role changes and deactivate/reactivate actions.
- Added Staff page account metrics and management controls.
- Staff creation, linking, role changes and activation changes are written to StorePOS audit logs.
- StorePOS shop isolation remains enforced with `app_code = storepos` and retail workspace validation.


## v1.5.4 — Android v1.6.2 Resources
- Updated the Resources hub to StorePOS Android v1.6.2.
- Updated direct APK and release-note links.
- Updated Android version code to 21.
- Updated the displayed SHA-256 checksum for the v1.6.2 APK.
