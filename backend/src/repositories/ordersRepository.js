const pool = require("../db/postgres");

async function createOrder(
  { customerId, totalAmount, items },
  client = pool,
) {
  const orderQuery = `
    INSERT INTO orders (customer_id, total_amount, status)
    VALUES ($1, $2, 'PENDING')
    RETURNING id, customer_id AS "customerId", total_amount AS "totalAmount",
              status, created_at AS "createdAt"
  `;
  const { rows } = await client.query(orderQuery, [customerId, totalAmount]);
  const order = rows[0];

  for (const item of items) {
    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4)`,
      [order.id, item.productId, item.quantity, item.unitPrice],
    );
  }

  return order;
}

async function listOrders({ limit = 50, offset = 0 } = {}) {
  const query = `
    SELECT id, customer_id AS "customerId", total_amount AS "totalAmount",
           status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM orders
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;
  const { rows } = await pool.query(query, [limit, offset]);
  return rows;
}

async function getOrderById(orderId) {
  const query = `
    SELECT id, customer_id AS "customerId", total_amount AS "totalAmount",
           status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM orders
    WHERE id = $1
  `;
  const { rows } = await pool.query(query, [orderId]);
  return rows[0] || null;
}

async function getOrderByIdForUpdate(orderId, client) {
  const query = `
    SELECT id, customer_id AS "customerId", total_amount AS "totalAmount",
           status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM orders
    WHERE id = $1
    FOR UPDATE
  `;
  const { rows } = await client.query(query, [orderId]);
  return rows[0] || null;
}

async function markOrderAsPaid(orderId, client = pool) {
  const query = `
    UPDATE orders
    SET status = 'PAID', updated_at = NOW()
    WHERE id = $1
    RETURNING id, customer_id AS "customerId", total_amount AS "totalAmount",
              status, created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  const { rows } = await client.query(query, [orderId]);
  return rows[0] || null;
}

async function getOrderWithDetails(orderId) {
  const orderQuery = `
    SELECT id, customer_id AS "customerId", total_amount AS "totalAmount",
           status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM orders
    WHERE id = $1
  `;
  const itemsQuery = `
    SELECT oi.id, oi.product_id AS "productId", oi.quantity, oi.unit_price AS "unitPrice",
           p.name, p.sku
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC
  `;
  const paymentsQuery = `
    SELECT id, order_id AS "orderId", amount, provider_txn_id AS "providerTxnId",
           status, created_at AS "createdAt"
    FROM payments
    WHERE order_id = $1
    ORDER BY created_at ASC
  `;

  const [orderResult, itemsResult, paymentsResult] = await Promise.all([
    pool.query(orderQuery, [orderId]),
    pool.query(itemsQuery, [orderId]),
    pool.query(paymentsQuery, [orderId]),
  ]);

  if (orderResult.rowCount === 0) {
    return null;
  }

  return {
    ...orderResult.rows[0],
    items: itemsResult.rows,
    payments: paymentsResult.rows,
  };
}

module.exports = {
  createOrder,
  listOrders,
  getOrderById,
  getOrderByIdForUpdate,
  markOrderAsPaid,
  getOrderWithDetails,
};
