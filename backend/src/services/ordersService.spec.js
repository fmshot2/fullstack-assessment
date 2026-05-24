const request = require("supertest");
const app = require("../app");
const pool = require("../db/postgres");

// Helper to reset DB state before each test
async function resetDb() {
  await pool.query("DELETE FROM payment_events");
  await pool.query("DELETE FROM payments");
  await pool.query("DELETE FROM order_items");
  await pool.query("DELETE FROM orders");
  await pool.query("DELETE FROM products");
}

async function createTestProduct({ stock = 1, price = 10.00 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO products (sku, name, description, price, stock)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [`SKU-TEST-${Date.now()}`, "Test Product", "A test product", price, stock]
  );
  return rows[0];
}

afterAll(async () => {
  await pool.end();
});

// ─── Test 1: Concurrency / overselling ───────────────────────────────────────
describe("createOrder - concurrency", () => {
  beforeEach(resetDb);

  it("prevents overselling when two concurrent orders race for the last item", async () => {
    const product = await createTestProduct({ stock: 1 });

    const orderBody = {
      customerId: "customer_test",
      items: [{ productId: product.id, quantity: 1 }],
    };

    // Fire two requests simultaneously
    const [res1, res2] = await Promise.all([
      request(app).post("/orders").send(orderBody),
      request(app).post("/orders").send(orderBody),
    ]);

    const statuses = [res1.status, res2.status].sort();

    // Exactly one should succeed (201) and one should fail (409)
    expect(statuses).toEqual([201, 409]);

    // Stock should never go negative
    const { rows } = await pool.query(
      "SELECT stock FROM products WHERE id = $1",
      [product.id]
    );
    expect(rows[0].stock).toBe(0);
  });

  it("allows order when sufficient stock exists", async () => {
    const product = await createTestProduct({ stock: 5 });

    const res = await request(app).post("/orders").send({
      customerId: "customer_test",
      items: [{ productId: product.id, quantity: 3 }],
    });

    expect(res.status).toBe(201);

    const { rows } = await pool.query(
      "SELECT stock FROM products WHERE id = $1",
      [product.id]
    );
    expect(rows[0].stock).toBe(2);
  });

  it("rejects order when stock is insufficient", async () => {
    const product = await createTestProduct({ stock: 1 });

    const res = await request(app).post("/orders").send({
      customerId: "customer_test",
      items: [{ productId: product.id, quantity: 2 }],
    });

    expect(res.status).toBe(409);
  });
});

// ─── Test 2: Idempotency / double charge ─────────────────────────────────────
describe("chargeOrder - idempotency", () => {
  beforeEach(resetDb);

  it("charges only once when the same Idempotency-Key is used twice", async () => {
    const product = await createTestProduct({ stock: 1, price: 29.99 });

    // Create order first
    const orderRes = await request(app).post("/orders").send({
      customerId: "customer_test",
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id;

    const idempotencyKey = `idem-test-${Date.now()}`;

    // Fire two charge requests simultaneously with the same key
    const [charge1, charge2] = await Promise.all([
      request(app)
        .post("/payments/charge")
        .set("Idempotency-Key", idempotencyKey)
        .send({ orderId }),
      request(app)
        .post("/payments/charge")
        .set("Idempotency-Key", idempotencyKey)
        .send({ orderId }),
    ]);

    // Both should return success (idempotent)
    expect(charge1.status).toBe(200);
    expect(charge2.status).toBe(200);

    // But only one payment should exist in the DB
    const { rows } = await pool.query(
      "SELECT * FROM payments WHERE order_id = $1",
      [orderId]
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects a second charge attempt on an already paid order without idempotency key", async () => {
    const product = await createTestProduct({ stock: 1, price: 29.99 });

    const orderRes = await request(app).post("/orders").send({
      customerId: "customer_test",
      items: [{ productId: product.id, quantity: 1 }],
    });
    const orderId = orderRes.body.id;

    // First charge
    const first = await request(app)
      .post("/payments/charge")
      .send({ orderId });
    expect(first.status).toBe(200);

    // Second charge — should be rejected
    const second = await request(app)
      .post("/payments/charge")
      .send({ orderId });
    expect(second.status).toBe(409);
  });
});

// ─── Test 3: Auth on admin routes ────────────────────────────────────────────
describe("admin routes - authentication", () => {
  it("rejects POST /admin/products without a token", async () => {
    const res = await request(app).post("/admin/products").send({
      sku: "SKU-UNAUTH",
      name: "Unauthorized Product",
      price: 9.99,
      stock: 10,
    });
    expect(res.status).toBe(401);
  });

  it("rejects PATCH /admin/products/:id without a token", async () => {
    const res = await request(app)
      .patch("/admin/products/1")
      .send({ price: 0.01 });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a wrong token", async () => {
    const res = await request(app)
      .post("/admin/products")
      .set("Authorization", "Bearer wrong-token")
      .send({
        sku: "SKU-WRONG",
        name: "Wrong Token Product",
        price: 9.99,
        stock: 10,
      });
    expect(res.status).toBe(401);
  });

  it("allows POST /admin/products with a valid token", async () => {
    const res = await request(app)
      .post("/admin/products")
      .set("Authorization", `Bearer ${process.env.ADMIN_TOKEN}`)
      .send({
        sku: `SKU-AUTH-${Date.now()}`,
        name: "Authorized Product",
        description: "Created by admin",
        price: 19.99,
        stock: 5,
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Authorized Product");
  });
});