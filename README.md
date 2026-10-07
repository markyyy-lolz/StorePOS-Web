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
