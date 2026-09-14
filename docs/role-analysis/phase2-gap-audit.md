# PHASE 2 - INTERNAL GAP AUDIT

Based on `final-role-architecture.md` and the existing codebase, here is the strict validation of what is truly done vs missing.

## 1. 1111 MASTER (Platform)
- **UI Shell:** `DONE` (PlatformContainer exists)
- **DB/Schema (Tenants, Plans, Subscriptions, Devices):** `MISSING`
- **Backend (Tenant Isolation Middleware, Cross-Tenant logic):** `MISSING`
- **Verdict:** `PLACEHOLDER` - UI exists but zero backend data models.

## 2. 2222 OWNER (Business Management)
- **UI (Dashboard Tabs):** `PARTIAL` (Menu works, Stock/Branch are placeholders)
- **DB/Schema (Inventory, Branches, Staff):** `MISSING`
- **Backend (Inventory logic, Branch CRUD, Staff management):** `MISSING`
- **Verdict:** `PARTIAL` - Menu pricing is secure, but Inventory & Branches are non-existent.

## 3. 3333 MANAGER (Operations & Approvals)
- **Price Security:** `DONE` (Enforced in UI and Backend)
- **DB/Schema (Approvals Table):** `MISSING`
- **Backend Workflow (Approval Engine):** `MISSING` (Currently just checks PIN in the command, no real request/pending state workflow)
- **Verdict:** `PARTIAL` - Operations visibility is incomplete, approval engine is not fully decoupled.

## 4. 4444 CASHIER (Shift & Financial)
- **UI (Shift open/close):** `PARTIAL` (UI exists, API exists)
- **DB/Schema (Shifts):** `PARTIAL` (Table exists, but Z-closing details, cash movements table missing)
- **Void Workflow:** `PARTIAL` (PIN check works, but requires true Approval Engine integration)
- **Verdict:** `PARTIAL` - Shift schema needs cash movements breakdown, Z-closing totals missing.

## 5. 5555 WAITER (POS & Modifiers)
- **Order Hydration:** `DONE` (get_order_items implemented)
- **UI/POS:** `PARTIAL` (Modifiers are just text fields, not real products)
- **DB/Schema (Modifier Groups, Options):** `MISSING`
- **Backend (Pricing impact of modifiers, Table Lifecycle states):** `MISSING`
- **Verdict:** `PARTIAL` - Modifiers are fake (just strings). Table states don't map to real DB `status` enum correctly.

## 6. 6666 KITCHEN (KDS)
- **DTO / Parsing:** `DONE` (Flat array working)
- **DB/Schema (Stations):** `MISSING` (Hardcoded UI only)
- **Offline/Retry:** `MISSING`
- **Verdict:** `PARTIAL` - Station logic is hardcoded, item-level status missing from DB.

---

## EXECUTION PLAN FOR ORCHESTRATOR
1. **Schema Expansion:** Add all missing tables (`tenants`, `branches`, `modifier_groups`, `modifier_options`, `product_modifier_groups`, `inventory_items`, `stock_movements`, `approvals`, `cash_movements`, `stations`, `plans`, `subscriptions`, `licenses`, `devices`).
2. **Backend Engine Implementation:**
   - **Multi-Tenant Middleware:** Enforce `tenant_id` on all queries.
   - **Approval Engine:** Create `request_approval`, `process_approval` IPCs.
   - **Modifier Engine:** Update `order_items` and cart logic to calculate modifier prices.
   - **Inventory Engine:** Create IPCs for stock adjustment.
3. **Dispatch 6 Subagents:** To connect the new backend structures to their respective UIs.
