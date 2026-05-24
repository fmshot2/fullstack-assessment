import { useEffect, useState } from "react";
import { listOrdersAdmin, listProducts, updateProductAdmin } from "../api";
import type { Order, Product } from "../types";

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Record<number, Partial<Product>>>({});

  useEffect(() => {
    listOrdersAdmin().then(setOrders);
    listProducts().then(setProducts);
  }, []);

  function onChangeField(id: number, field: keyof Product, value: string) {
    setEditing((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  const [saving, setSaving] = useState<Record<number, boolean>>({});

  async function save(p: Product) {
    const draft = editing[p.id] || {};
    setSaving((prev) => ({ ...prev, [p.id]: true }));
    try {
      const updated = await updateProductAdmin(p.id, {
        price: draft.price !== undefined ? Number(draft.price) : undefined,
        stock: draft.stock !== undefined ? Number(draft.stock) : undefined,
        description: draft.description as string | undefined,
        name: draft.name as string | undefined,
      });
      // ✅ Only update UI after server confirms
      setProducts((current) =>
        current.map((it) => (it.id === p.id ? updated : it))
      );
      setEditing((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
    } catch (err) {
      alert(`Failed to save product ${p.name}. Please try again.`);
    } finally {
      setSaving((prev) => ({ ...prev, [p.id]: false }));
    }
  }

  return (
    <div className="page">
      <h1>Admin</h1>

      <section>
        <h2>Orders</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, idx) => (
              <tr key={idx}>
                <td>{o.id}</td>
                <td>{o.customerId}</td>
                <td>${o.totalAmount}</td>
                <td>{o.status}</td>
                <td>{new Date(o.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Products</h2>
        <ul className="admin-products">
          {products.map((p, idx) => (
            <li key={idx} className="admin-product">
              <input
                type="text"
                defaultValue={p.name}
                onChange={(e) => onChangeField(p.id, "name", e.target.value)}
              />
              <input
                type="text"
                defaultValue={p.price}
                onChange={(e) => onChangeField(p.id, "price", e.target.value)}
              />
              <input
                type="text"
                defaultValue={String(p.stock)}
                onChange={(e) => onChangeField(p.id, "stock", e.target.value)}
              />
              <textarea
                defaultValue={p.description}
                onChange={(e) =>
                  onChangeField(p.id, "description", e.target.value)
                }
              />
              <button onClick={() => save(p)} disabled={saving[p.id]}>
                {saving[p.id] ? "Saving..." : "Save"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
