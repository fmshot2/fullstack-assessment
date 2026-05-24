# AI Usage Notes

## 1. Tools used

- **Claude (Anthropic) — claude.ai chat interface** — used throughout the assessment for code review, bug identification, fix suggestions, and document drafting.

---

## 2. Prompt journal

### Prompt 1

```
brain storm some suggestions for the totalAmount calculation. The backend currently trusts totalAmount
from the client request body. Also the frontend uses parseFloat and float
multiplication for money. Suggest a fix that does not require installing
a third-party package. Don't write code just float some ideas.
```

The model initially suggested using `decimal.js`. I rejected that and decided to use 
integer kobo arithmetic — multiply by 100 on read, compute as integers, divide by 100 before 
storage or display. See section 3 for detail on the rejected output.

---

### Prompt 2

```
Write integration tests for: (1) concurrent order creation with stock=1,
(2) idempotent charge with same Idempotency-Key, (3) auth on admin routes.
Use Jest and supertest against a real Postgres DB.
```

The model produced three test suites with `beforeEach` DB reset helpers,
`Promise.all` for concurrency tests, and coverage for both the happy path
and failure cases. I reviewed each test for correctness — particularly the
concurrency test, where I verified that `Promise.all` actually fires requests
simultaneously and that the assertions (`[201, 409]` sorted) correctly
handle either request winning the race. I kept all tests with minor
formatting adjustments.

---

### Prompt 3

```
The payment gateway has PAYMENT_FAILURE_RATE=0.1. The charge tests could
randomly fail 10% of the time. How should I handle this in tests?
```

The model suggested setting `PAYMENT_FAILURE_RATE=0` in `.env` before
running tests. I kept this — it is the correct approach for deterministic
tests against a non-deterministic external dependency.

---

## 3. AI got it wrong

**Context:** When asked to fix the floating point money arithmetic, the model
initially produced:

```
npm install decimal.js

const Decimal = require("decimal.js");

const totalAmount = enrichedItems
  .reduce(
    (sum, item) => sum.plus(new Decimal(item.unitPrice).times(item.quantity)),
    new Decimal(0)
  )
  .toFixed(2);
```

**What was wrong:** This introduces a third-party runtime dependency
(`decimal.js`) that anyone pulling the branch must install. The assessment
repo has no mention of this package anywhere — a reviewer pulling the branch
and running `npm install` would get it, but it is an undocumented addition.
More importantly, the same precision guarantee can be achieved with integer
cents arithmetic using only JavaScript builtins — no dependency needed.

**How I detected it:** I asked myself whether the fix required a package at
all, and whether the package would be installed automatically for a reviewer.
The answer to both made the suggestion unsuitable.

**What I did instead:** I pushed back and decided to use a package-free
approach. I came up with the integer kobo solution (`Math.round(price * 100)`,
integer arithmetic, divide by 100 on output), which I kept.

---

## 4. Validation strategy

- **Manual code review:** Read every file in the repo before writing any fix.
  Verified each bug independently against the source — did not rely solely on
  the model's identification.
- **Postgres documentation:** Cross-referenced `FOR UPDATE` locking behaviour
  in the official Postgres docs before applying the race condition fix.
- **Local runs:** Ran the backend with `npm run dev` and exercised the UI
  manually after each fix to confirm the app still functioned correctly.
- **Integration tests:** Wrote Jest + supertest tests for the three
  highest-impact backend bugs (concurrency, idempotency, auth) and ran them
  against the real Docker Postgres database.
- **DB inspection:** Used `docker compose exec postgres psql` to inspect table
  contents and verify stock levels after manual concurrent order tests.

---

## 5. What you did NOT delegate

### Money arithmetic
I did not accept the model's first suggestion of `decimal.js`. I reasoned
through the options myself — integer cents is sufficient for this codebase,
requires no dependency, and is easier to audit. The model does not always
flag float precision risks unprompted; I caught this by reading the README
note about AI failure modes and reviewing the arithmetic manually.

### Row locking strategy
I verified the `FOR UPDATE` approach against Postgres documentation myself
rather than taking the model's word for it. The model correctly identified
that the lock must be acquired at the SELECT step, but I confirmed this
independently because getting it wrong (locking at the wrong point, or
outside a transaction) would give a false sense of safety with no actual
protection.

### Using DB Transactions strategy
I used withTransaction in the createOrder  in ordersService.js to prevent decrementing a product that's less than one in stock. i also used it in chargeOrder to prevent double charging.

### Authentication design
I chose the shared-secret Bearer token pattern deliberately over more complex
alternatives (JWT, session) because the admin endpoints are internal-facing
and the complexity of JWT would not be justified here. The model suggested
the same pattern but I made the decision independently based on the scope of
the app.

### Webhook idempotency — two-layer defence
The model suggested the application-level duplicate check. I independently
decided to also add the `UNIQUE` constraint at the DB level, reasoning that
the app-level check alone does not protect against two simultaneous webhook
deliveries that both pass the check before either inserts. The DB constraint
is the hard guarantee; the app check is the optimisation. This two-layer
decision was mine.

### Moving Total Amount from frontend to Backend
romeved all traces of total amount from frontend to the backend for safety and security reasons.


### Capping What quantity users can select for purchase and Capping Cart updates for adding products
I capped what the users and purchase to be less than or equal to product quantity. 
Also did the same for adding to Cart. You can't add more to cart than what's in the product quantity.


### Removing dangerouslySetInnerHTML
I remove this from product detail page