const ordersRepository = require("../repositories/ordersRepository");
const productsRepository = require("../repositories/productsRepository");
const paymentsRepository = require("../repositories/paymentsRepository");
const paymentGateway = require("./paymentGateway");
const redis = require("../db/redis");
const db = require("../db/postgres");

async function withTransaction(callback) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function createOrder({ customerId, items }) {
  if (!customerId || !Array.isArray(items) || items.length === 0) {
    const error = new Error("customerId and items are required");
    error.status = 400;
    throw error;
  }

  return withTransaction(async (client) => {
    const enrichedItems = [];
    for (const item of items) {
      const product = await productsRepository.getProductByIdForUpdate(item.productId, client);
      if (!product) {
        const error = new Error(`Product ${item.productId} not found`);
        error.status = 404;
        throw error;
      }
      if (product.stock < item.quantity) {
        const error = new Error(`Insufficient stock for ${product.name}`);
        error.status = 409;
        throw error;
      }
      enrichedItems.push({
        productId: product.id,
        quantity: item.quantity,
        unitPrice: Number(product.price),
      });
    }

    for (const item of enrichedItems) {
      const result = await productsRepository.decrementStock(item.productId, item.quantity, client);
      if (!result) {
        const error = new Error(`Stock conflict for product ${item.productId}`);
        error.status = 409;
        throw error;
      }
    }

    const totalAmount = enrichedItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity, 0
    );

    const order = await ordersRepository.createOrder({
      customerId,
      totalAmount,
      items: enrichedItems,
    }, client);

    return order;
  });
}

async function chargeOrder({ orderId, idempotencyKey }) {
  if (idempotencyKey) {
    const cached = await redis.get(`idem:${idempotencyKey}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  return withTransaction(async (client) => {
    const order = await ordersRepository.getOrderByIdForUpdate(orderId, client);
    if (!order) {
      const error = new Error("Order not found");
      error.status = 404;
      throw error;
    }

    if (order.status !== "PENDING") {
      const error = new Error("Only pending orders can be charged");
      error.status = 409;
      throw error;
    }

    const gatewayResponse = await paymentGateway.charge({
      orderId: order.id,
      amount: order.totalAmount,
    });

    const payment = await paymentsRepository.createPayment({
      orderId: order.id,
      amount: gatewayResponse.chargedAmount,
      providerTxnId: gatewayResponse.providerTxnId,
      status: "SUCCESS",
      idempotencyKey,
    }, client);

    const updatedOrder = await ordersRepository.markOrderAsPaid(order.id, client);

    if (idempotencyKey) {
      await redis.set(
        `idem:${idempotencyKey}`,
        JSON.stringify({ order: updatedOrder, payment }),
        "EX",
        3600,
      );
    }

    return { order: updatedOrder, payment };
  });
}

async function processPaymentWebhook({
  providerEventId,
  orderId,
  eventType,
  payload,
}) {
  await paymentsRepository.createWebhookEvent({
    providerEventId,
    orderId,
    eventType,
    payload,
  });

  if (eventType === "payment_succeeded") {
    await ordersRepository.markOrderAsPaid(orderId);
  }

  return { accepted: true };
}

async function getOrderById(orderId) {
  const order = await ordersRepository.getOrderWithDetails(orderId);
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  return order;
}

async function listOrders(params) {
  return ordersRepository.listOrders(params);
}

module.exports = {
  withTransaction,
  createOrder,
  chargeOrder,
  processPaymentWebhook,
  getOrderById,
  listOrders,
};
