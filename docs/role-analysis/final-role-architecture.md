# KASAM360 Final Role Architecture

## 1. System Role Philosophy

KASAM360 employs a strict, 6-tier hierarchical role architecture that separates platform administration from tenant administration, and further divides local tenant operations into specialized operational workflows (Management, Cash, Table Service, and Kitchen). 

The fundamental rule is isolation: Platform roles (MASTER) do not perform restaurant tasks, and Restaurant roles (OWNER, MANAGER, CASHIER, WAITER, KITCHEN) do not overlap their distinct operational boundaries unless explicitly authorized.

## 2. 1111 MASTER

### Responsibilities
Platform Control Center. Managing tenants, global users, licenses, subscriptions, devices, system health, and global security. MASTER does not operate a restaurant POS.

### Screens
- Platform Dashboard
- Tenant Management
- Global Users & Roles
- License & Subscription Management
- Devices & System Health
- Global Audit & Security

### Features
- Tenant activation/suspension
- Cross-tenant user management
- Global event logging and DLQ resolution
- Support access / diagnostic impersonation

### Actions
- Create/Suspend Tenant, Revoke License, Terminate Session.

### Permissions
- Complete Platform Administration. No local POS/KDS permissions.

### Security
- Requires strict global session management, potentially MFA. Support access requires audit trails.

### Approval
- Platform-level actions (e.g. restoring backups, deleting tenants) require strong confirmations.

### Data
- Global PostgreSQL/Cloud DB (multi-tenant schema).

### Existing
- Local `audit_ledger` exists (needs global sync).

### Missing
- Stats tracking, global user registry, session management, license/device management, OTA updates.

### Wrongly Placed
- `App.tsx` and `roles.types.ts` incorrectly map MASTER to local restaurant views (POS, KDS, FLOOR).

### Backend Gaps
- Entire multi-tenant schema (`tenant_id`), global API endpoints, and subscription/plan schemas are missing. Local SQLite does not support this natively.

## 3. 2222 OWNER

### Responsibilities
Business Control Center. Manages a single tenant. Focuses on financial health, business reports, overall staff and inventory, and configuration.

### Screens
- Owner Dashboard (KPIs, Sales)
- Receipts & Refunds
- Menu Management
- Inventory & Stock
- Branch & Staff Management
- Business Settings

### Features
- Business overview, Z reports, historical sales, product/pricing creation.

### Actions
- View financial reports, edit prices, create users, configure branches.

### Permissions
- Full Tenant Administration. 

### Security
- Tenant isolation. Cannot see other tenants.

### Approval
- None locally (highest authority in tenant).

### Data
- Tenant-scoped data (Orders, Products, Staff, Sales).

### Existing
- Dashboard KPI cards, Receipts history, Menu Management (create/update products), Floor plan configuration.

### Missing
- Cash shift tracking, formal Z report, Inventory, Staff management UI, Branch management, Device/Integration config.

### Wrongly Placed
- None explicitly, but MANAGER currently shares too much menu capability.

### Backend Gaps
- Inventory/Stock schema missing. Branch schema missing. External integrations missing.

## 4. 3333 MANAGER

### Responsibilities
Operations Center. Manages daily restaurant operations, staff shifts, cash monitoring, and issue resolution (voids/refunds).

### Screens
- Operations Dashboard
- Live Floor & Orders
- Shift & Cash Visibility
- Approvals (Voids/Refunds)

### Features
- Operational overview, table merges/splits, discount/void approvals, daily operational reports.

### Actions
- Open/Close/Merge/Transfer Tables, Approve Cashier Refunds, View basic EOD.

### Permissions
- Daily operations. Cannot change core pricing or strategic settings.

### Security
- PIN-based quick approval workflows.

### Approval
- Approves Cashier voids and waiter modifications.

### Data
- Live session data, Orders, Daily Cash.

### Existing
- Floor plan container, Table transfer, `EndOfDayContainer` (high-level), `AuditLogsPanel`.

### Missing
- Dashboard metrics, Table Merge, Orders view, KDS monitoring, Staff shifts, Inventory tracking, Approvals UI, Detailed cash visibility.

### Wrongly Placed
- Manager currently has access to edit product `price_cents` via Menu Management.

### Backend Gaps
- Product update commands do not enforce role-based pricing locks. Table Split/Close lack backend execution in modal. Approval workflow engine lacks frontend UI.

## 5. 4444 CASHIER

### Responsibilities
Transaction Workstation. Focused purely on speed of checkout and payment collection.

### Screens
- Cashier Workstation (Open Orders & Payment Numpad)
- Receipts

### Features
- Fast payment processing, cash drawer tracking, split payments, shift management.

### Actions
- Apply payment, Print Receipt, Request Void.

### Permissions
- Payment execution. No menu editing, no user management.

### Security
- Voids/Refunds require MANAGER approval.

### Approval
- Cannot self-approve major voids/refunds.

### Data
- Active un-paid orders, Cash movements.

### Existing
- Fast Payment UI, Numpad, Payment Method integration, Payment Validation, Receipt printing. Restricted access in `App.tsx`.

### Missing
- Search by table/order, Cash shift tracking (open/close shift), Cash movements (drops).

### Wrongly Placed
- None.

### Backend Gaps
- No cash shift schema in DB. `void_order` backend command executes without Manager approval. `get_daily_summary` rejects CASHIER role.

## 6. 5555 WAITER

### Responsibilities
Restaurant POS. Focused on taking orders at the table with minimum interaction.

### Screens
- Floor Plan
- Table Detail & POS Catalog
- Cart

### Features
- Table status, quick add to cart, order notes, send to kitchen.

### Actions
- Open table, Add items, Send order, Transfer table.

### Permissions
- Order creation. Cannot process payment, cannot delete sent items without approval.

### Security
- PIN login. Cannot access management views.

### Approval
- Needs MANAGER approval for modifying/canceling items after they are sent to the kitchen.

### Data
- Active table orders.

### Existing
- Floor plan, PIN Login, Table opening, Catalog (with out-of-stock disabled), Quick add, Cart, Notes, Table transfer. Restricted access.

### Missing
- Shift clock-in, Table 'preparing/ready' states, Modifiers UI, Customer count, Ready order notification.

### Wrongly Placed
- None.

### Backend Gaps
- Modifiers schema missing. Table merge missing. Re-fetching active order items into POS cart after reopening table is missing.

## 7. 6666 KITCHEN

### Responsibilities
KDS (Kitchen Display System). Focused on fast ticket processing and station routing.

### Screens
- KDS Main Board

### Features
- Ticket status lanes, elapsed time, one-tap status advancement.

### Actions
- Mark preparing, Mark ready, Complete.

### Permissions
- KDS access only. No cash, no reports.

### Security
- Restricted solely to KDS view.

### Approval
- N/A

### Data
- Active tickets, Order items.

### Existing
- KDS UI layout, Pending->Preparing->Ready->Completed flow, elapsed time calculation, one-tap buttons, restricted role.

### Missing
- Station routing, item-level status, KDS notifications/sounds, offline queue, ticket filtering.

### Wrongly Placed
- None.

### Backend Gaps
- `order_items` schema lacks `station`, `modifiers`, and `notes`. `get_active_tickets` returns nested product object instead of flat format. Priority is hardcoded to "NORMAL".

## 8. Global Permission Matrix

| Capability | MASTER | OWNER | MANAGER | CASHIER | WAITER | KITCHEN |
|---|---|---|---|---|---|---|
| Tenant Mgmt | ADMIN | VIEW (self) | NONE | NONE | NONE | NONE |
| Users | ADMIN | ADMIN (tenant) | VIEW | NONE | NONE | NONE |
| Settings | ADMIN (Global) | ADMIN (Biz) | VIEW | NONE | NONE | NONE |
| Products | NONE | ADMIN | VIEW | NONE | NONE | NONE |
| Pricing | NONE | ADMIN | NONE | NONE | NONE | NONE |
| Orders | NONE | VIEW | EDIT | VIEW | CREATE | VIEW |
| Payments | NONE | VIEW | VIEW | CREATE | NONE | NONE |
| Refunds | NONE | ADMIN | APPROVE | REQUEST | NONE | NONE |
| KDS | NONE | VIEW | VIEW | NONE | NONE | EDIT |

## 9. Role Conflict Matrix

1. **MASTER vs OWNER:** Major conflict in current codebase. MASTER inherits local POS/Floor/KDS access. This violates platform separation.
2. **OWNER vs MANAGER:** Manager currently has access to edit `price_cents` via the `ManagementContainer`. This should be an OWNER-only capability.
3. **MANAGER vs CASHIER:** Backend currently allows Cashier to perform `void_order` without any Manager approval prompt.
4. **MANAGER vs WAITER:** Modifying sent orders lacks Manager approval constraint.

## 10. Critical Cross-Role Workflows

1. **Order Flow:** WAITER (Creates) -> KITCHEN (Prepares -> Ready) -> WAITER (Notified) -> CASHIER (Payment)
2. **Void Flow:** CASHIER (Requests Void) -> MANAGER (PIN Approval) -> AUDIT (Logged)
3. **Menu Flow:** OWNER (Sets Prices) -> MANAGER (Sets Stock Status) -> WAITER (Views Catalog)

## 11. Backend Capability Matrix

| Feature | Frontend | Backend | DB Schema | Status |
|---|---|---|---|---|
| Payments | YES | YES | YES | EXISTS |
| KDS Flow | YES | YES | YES | EXISTS |
| Audit Log | YES | YES | YES | EXISTS |
| Multi-Tenancy | NO | NO | NO | GAP |
| Global Users | NO | NO | NO | GAP |
| Cash Shifts | NO | NO | NO | GAP |
| Inventory | NO | NO | NO | GAP |
| Approvals | NO | PARTIAL | NO | GAP |
| Subscriptions | NO | NO | NO | GAP |

## 12. Financial Permission Matrix

- **Calculations:** Done securely via backend integer cents.
- **Display:** Handled via frontend formatters.
- **Action (Take Payment):** CASHIER.
- **Action (Set Price):** OWNER.
- **Action (Discount/Void):** MANAGER (Approves), CASHIER (Executes).

## 13. Security Matrix

- **Navigation:** Enforced via `App.tsx` (WAITER, CASHIER, KITCHEN are restricted).
- **Audit:** SQLite trigger-enforced `audit_ledger` exists but needs scaling to multi-tenant.
- **Vulnerabilities:** Price editing by Manager, Voiding by Cashier without approval, MASTER mapped to POS.

## 14. UI/UX Requirements

- **MASTER:** Data-heavy tables, global search, administrative forms.
- **OWNER:** High-level dashboard charts, comprehensive data grids.
- **MANAGER:** Operational alerts, grid lists, fast PIN approval modals.
- **CASHIER:** High-contrast numpad, split-pane active orders, no scrolling.
- **WAITER:** Touch-friendly large targets, fast cart drawer, visual floor plan.
- **KITCHEN:** High-visibility kanban lanes, color-coded elapsed times, one-tap big buttons.

## 15. Existing Features

- POS UI (Cart, Catalog)
- Floor Plan layout
- Cashier Workstation (Numpad, Payment flow)
- Receipts viewer
- Basic KDS lanes
- Audit ledger UI

## 16. Missing Features

- Tenant Platform Module
- Advanced Cash Shift Management
- Manager Approval UI
- Station Routing in KDS
- Modifiers & Inventory

## 17. Features To Remove

- MASTER access from `App.tsx` local views.

## 18. Features To Move Between Roles

- **Price Editing:** Move completely to OWNER.
- **Voiding:** Move execution to CASHIER but enforce MANAGER PIN approval.

## 19. Backend Requirements

- Add `tenant_id` multi-tenant architecture.
- Add Shift/Session database tables.
- Update `order_items` with `station`, `modifiers`, `notes`.
- Implement `ApprovalWorkflowEngine` hooks in Rust commands.
- Fix KDS DTO (flatten product).

## 20. Frontend Requirements

- Create a separate Platform App shell for MASTER.
- Build Cash Shift Modals for CASHIER.
- Build Manager Approval Modals.
- Add KDS notifications/Polling enhancements.

## 21. Implementation Dependencies

1. Multi-tenant DB Schema must be completed before MASTER UI.
2. DB Shift schema must be completed before CASHIER shift UI.
3. Order Items DTO must be fixed before KDS Station Routing.

## 22. Recommended Implementation Order

1. **Schema & DTO Fixes** (Tenants, Shifts, KDS Fields).
2. **Backend Commands Fixes** (Permissions, Approvals, DTO mapping).
3. **Role Decoupling** (Remove MASTER from POS).
4. **UI Workflows** (Cashier Shifts, Manager Approvals).
5. **Platform UI** (Master Dashboard).

## 23. BLOCKERS

- Single-tenant SQLite architecture prevents true MASTER role implementation.
- Hardcoded roles in backend commands (e.g. `get_daily_summary` rejecting Cashier).
- Data mapping mismatch on `get_active_tickets` will break KDS rendering.

## 24. FINAL IMPLEMENTATION SPECIFICATION

### 1111 MASTER
- **Route:** `/platform/*`
- **Action:** Build distinct React app entry or isolated route group for platform administration.
- **Backend Dependency:** Migrate from local SQLite to cloud DB or implement strict logical tenant ID isolation.

### 2222 OWNER
- **Route:** `/owner/*`
- **Action:** Expand Dashboard. Add Branch & Integration settings.
- **Backend Dependency:** Add reporting aggregation endpoints.

### 3333 MANAGER
- **Route:** `/management/*`
- **Action:** Implement PIN Approval Modal overlay for system-wide hooks. Remove price editing fields from Menu UI for this role.
- **Backend Dependency:** Secure `update_product` backend command against non-owners updating prices.

### 4444 CASHIER
- **Route:** `/cashier`
- **Action:** Add Shift Open/Close modals.
- **Backend Dependency:** Implement `shifts` table, `open_shift`, `close_shift` Rust commands. Modify `get_daily_summary` to accept Cashier role for their own shift.

### 5555 WAITER
- **Route:** `/floor`, `/pos`
- **Action:** Fetch existing active items into cart when table is opened.
- **Backend Dependency:** `get_order_items` endpoint for active orders.

### 6666 KITCHEN
- **Route:** `/kds`
- **Action:** Implement `item.station` rendering and sound notifications.
- **Backend Dependency:** Flatten `KdsOrderDto` items mapping in `get_active_tickets`. Read priority dynamically. Add `station`, `notes`, `modifiers` to `order_items`.
