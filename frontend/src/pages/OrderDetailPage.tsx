import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { chargeOrder, getOrder } from "../api";
import type { Order } from "../types";

export default function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!id) return;
    getOrder(id).then(setOrder);

    const intervalId = setInterval(() => {
      getOrder(id).then(setOrder);
    }, 2000);

    return () => clearInterval(intervalId);
  }, [id]);

  if (!order) return <p>Loading order...</p>;

  async function pay() {
    if (paying) return;
    setPaying(true);
    try {
      const result = await chargeOrder(order!.id);
      setOrder(result.order);
    } catch (err) {
      alert("Payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="page">
      <h1>Order #{order.id}</h1>
      <p>
        Status: <span className={`status ${order.status}`}>{order.status}</span>
      </p>
      <p>Total: ${order.totalAmount}</p>

      <h2>Items</h2>
      <ul>
        {(order.items || []).map((item, idx) => (
          <li key={idx}>
            {item.name} x {item.quantity} @ ${item.unitPrice}
          </li>
        ))}
      </ul>

      <h2>Payments</h2>
      {(order.payments || []).length === 0 && <p>No payments yet.</p>}
      <ul>
        {(order.payments || []).map((p, idx) => (
          <li key={idx}>
            {p.status} - ${p.amount} ({p.providerTxnId})
          </li>
        ))}
      </ul>

      {order.status === "PENDING" && (
        <button className="primary" onClick={pay} disabled={paying}>
          {paying ? "Charging..." : "Pay now"}
        </button>
      )}
    </div>
  );
}
