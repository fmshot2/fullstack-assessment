# Findings

## Backend

### Issue: SQL Injection in product search

- **Where:** `backend/src/repositories/productsRepository.js` — `listProducts()`, the `WHERE name ILIKE '%${q}%'` clause
- **Why:** The search query parameter `q` was interpolated directly into the SQL string instead of being passed as a parameterized value. Any user input containing SQL metacharacters (quotes, semicolons, `--`) is executed as part of the query.
- **Impact:** An attacker could exfiltrate all data from the database, bypass filters, or in some configurations drop tables. This is a critical security vulnerability.
- **Fix:** Replaced string interpolation with a parameterized query using `$1`, passing `%${q}%` as the bound value. The `pg` driver escapes it safely before sending to Postgres.
- **Trade-offs:** None. Parameterized queries are strictly safer and have no performance cost.

---

### Issue: Race condition / overselling in order creation

- **Where:** `backend/src/services/ordersService.js` — `createOrder()`. Stock was checked with `getProductById`, then decremented with `decrementStock` in separate steps with no transaction or row lock.
- **Why:** Two concurrent requests could both read the same stock value before either decremented it, causing both to pass the stock check and both to decrement — resulting in negative stock.
- **Impact:** Products could be oversold. A product with stock of 1 could be sold to multiple customers simultaneously, causing fulfilment failures and financial loss.
- **Fix:** Wrapped the entire `createOrder` flow in `withTransaction()`. Replaced `getProductById` with `getProductByIdForUpdate` which issues `SELECT ... FOR UPDATE`, locking the product row for the duration of the transaction. Added `AND stock >= $2` to `decrementStock` as a second safety guard so the UPDATE itself never produces negative stock. Also removed `totalAmount` from the function signature — it is now computed server-side from real DB prices (see cross-cutting issue).
- **Trade-offs:** `FOR UPDATE` serialises concurrent orders for the same product, which adds some latency under high concurrency. For most e-commerce loads this is acceptable. A more scalable approach would be optimistic locking with retry, but that adds significant complexity.

---

### Issue: Double-charge vulnerability in payment flow

- **Where:** `backend/src/services/ordersService.js` — `chargeOrder()`. The order status check and the payment gateway call happened outside a transaction with no row lock.
- **Why:** Two simultaneous charge requests both read `status = PENDING` before either marked the order as paid, so both proceeded to charge the payment gateway.
- **Impact:** A customer could be charged twice for the same order. This is a critical financial bug.
- **Fix:** Wrapped `chargeOrder` in `withTransaction()` and replaced `getOrderById` with `getOrderByIdForUpdate` (`SELECT ... FOR UPDATE`). The row lock ensures only one charge request can read and act on a `PENDING` order at a time — the second request waits, then reads `PAID` and returns a 409.
- **Trade-offs:** Same serialisation trade-off as the overselling fix. The existing Redis idempotency key mechanism provides an additional fast-path cache for legitimate retries.

---

### Issue: Duplicate webhook processing

- **Where:** `backend/src/services/ordersService.js` — `processPaymentWebhook()`. `backend/src/db/schema.sql` — `payment_events` table had no UNIQUE constraint on `provider_event_id`.
- **Why:** Payment providers routinely redeliver webhooks on network failures or timeouts. There was no check for whether a webhook had already been processed, and no database constraint to prevent duplicate inserts.
- **Impact:** The same webhook delivered twice would insert duplicate `payment_events` rows and call `markOrderAsPaid` multiple times, corrupting the payment audit trail.
- **Fix:** Added a `UNIQUE` constraint on `payment_events.provider_event_id` in the schema as a hard database-level guarantee. Added an application-level duplicate check inside a transaction that returns `{ accepted: true, duplicate: true }` early if the event has already been processed. Two layers: the app check handles the common case efficiently; the DB constraint handles simultaneous duplicate deliveries.
- **Trade-offs:** The UNIQUE constraint requires a schema migration on existing deployments. The app-level check adds one extra SELECT per webhook, which is negligible.

---

### Issue: No authentication on admin routes

- **Where:** `backend/src/routes/adminRoutes.js` — `POST /admin/products` and `PATCH /admin/products/:id` had no authentication middleware.
- **Why:** The `ADMIN_TOKEN` environment variable was defined but never wired up to any route protection.
- **Impact:** Any anonymous user could create products, change prices to $0.01, or inflate stock levels without any credentials.
- **Fix:** Created `backend/src/middleware/auth.js` with a `requireAdminToken` middleware that reads the `Authorization: Bearer <token>` header and compares it against `ADMIN_TOKEN` from the environment. Applied to both admin routes. Requests without a valid token receive a 401.
- **Trade-offs:** This is a shared-secret pattern — appropriate for internal/server-to-server admin use, but not suitable for multi-user admin access. A production system would use JWT or session-based auth with role management. The token should be rotated from the default `change-me` value before any deployment.

---

## Frontend

### Issue: Buy Now Button text Does Not Show — 

- **Where:** `frontend/src/pages/ProductDetailPage.tsx` — Buy Now Button text Does Not Show on the browser.
- **Why:** The primary class has a text color of #ffff, and the buuton itself has no background color, it is white. So the text "Buy Now" doesn't show up.
- **Impact:** Users will be confused on where and how to actually buy the product therby leading to low selling rate of products.
- **Fix:** I removed the primary class. It's not necessary for that button since the white button is consisten with its neighbour, it's the text that should be change to black, which removing the primary class does.

---

### Issue: Memory leak — `setInterval` not cleared on unmount

- **Where:** `frontend/src/pages/OrderDetailPage.tsx` — `useEffect` hook. `setInterval` was called but its return value (the interval ID) was never stored, and no cleanup function was returned.
- **Why:** React calls the cleanup function returned from `useEffect` when the component unmounts or when its dependencies change. Without it, the interval runs indefinitely even after the user navigates away.
- **Impact:** Every visit to an order detail page leaks a polling interval. Over a session with multiple order page visits, leaked intervals accumulate — making redundant API calls, attempting to update state on unmounted components, and degrading performance. React will also emit warnings about state updates on unmounted components.
- **Fix:** Stored the interval ID in a variable and returned `() => clearInterval(intervalId)` from the `useEffect`. React calls this automatically on unmount and when `id` changes.
- **Trade-offs:** None. This is the correct React pattern for any side effect that needs cleanup.

---

### Issue: Double-submit on Pay button

- **Where:** `frontend/src/pages/OrderDetailPage.tsx` — the Pay button had no `disabled` attribute despite a `paying` state variable being present.
- **Why:** The `paying` state was used to change button text but was never passed as `disabled={paying}`. A fast double-click fired two `chargeOrder` requests before the first completed.
- **Impact:** Two simultaneous charge requests to the backend, potentially charging the customer twice. The backend double-charge fix is the last line of defence — the UI should be the first.
- **Fix:** Added `disabled={paying}` to the button and added `if (paying) return` as a guard at the top of the `pay()` handler as a second safety net.
- **Trade-offs:** None.

---

### Issue: No error handling on async actions

- **Where:** `frontend/src/pages/OrderDetailPage.tsx` — `pay()`. `frontend/src/pages/CartPage.tsx` — `checkout()`.
- **Why:** Both functions `await`ed API calls with no try/catch. Any network error, server error, or validation failure was silently swallowed.
- **Impact:** On `pay()` failure, `paying` state stayed `true` permanently — the button remained disabled with no way to retry. On `checkout()` failure, the user saw nothing and could not tell whether the order was created or not.
- **Fix:** Wrapped both functions in try/catch/finally. `finally` guarantees state is always reset. `catch` shows an `alert` with an actionable message. Added `checkingOut` state and `disabled={checkingOut}` to the Checkout button for parity with the Pay button fix.
- **Trade-offs:** `alert()` is used for simplicity. A production UI would use a toast or inline error component for better UX.

---

### Issue: Optimistic UI update before server confirmation

- **Where:** `frontend/src/pages/AdminPage.tsx` — `save()`. `setProducts` was called before `updateProductAdmin` completed.
- **Why:** The state update and the API call were not sequenced correctly — the UI was updated speculatively without waiting for server confirmation.
- **Impact:** If the API call failed, the UI permanently showed the edited (incorrect) values with no rollback and no error feedback. The admin would see data that did not match what was actually in the database.
- **Fix:** Moved `setProducts` to after the API call succeeds, using the server's response as the source of truth. Added per-product `saving` state, try/catch/finally, and `disabled={saving[p.id]}` on the Save button.
- **Trade-offs:** The UI now feels slightly less instant since it waits for server confirmation before updating. This is the correct trade-off — correctness over perceived speed.

---

## Cross-cutting

### Issue: `totalAmount` trusted from client / floating point money arithmetic

- **Where:** `backend/src/services/ordersService.js` — `createOrder()` accepted `totalAmount` from the request body. `frontend/src/state/CartContext.tsx` — used `parseFloat` and float multiplication for cart totals.
- **Why:** The backend took `totalAmount` at face value from the frontend instead of computing it from authoritative database prices. The frontend used JavaScript's native float arithmetic for money, which is subject to binary rounding errors (e.g. `10.99 * 3 = 32.97000000000001`).
- **Impact:** A malicious user could send `totalAmount: 0.01` for a $500 order and be charged $0.01. Floating point errors in cart totals could cause display inconsistencies and potential rounding discrepancies at scale.
- **Fix:** Removed `totalAmount` from the `createOrder` request body entirely — the backend now fetches prices from the DB and computes the total itself. All money arithmetic converted to integer cents (multiply by 100, compute as integers, divide by 100 for display/storage). No third-party library needed — integer arithmetic in JavaScript is always exact.
- **Trade-offs:** Integer cents arithmetic requires disciplined conversion at every boundary (DB read, display, storage). A `Decimal` library would be safer at larger scale, but introduces a dependency. For this codebase the cents approach is sufficient and dependency-free.