import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createOrder, getProduct } from "../api";
import { useCart } from "../state/CartContext";
import type { Product } from "../types";

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { add } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (!id) return;
    getProduct(id)
      .then(setProduct)
      .catch((err) => console.error(err));
  }, [id]);

  if (!product) return <p>Loading...</p>;

  async function buyNow() {
    if (!product) return;
    try {
      const order = await createOrder({
        customerId: "customer_001",
        items: [{ productId: product.id, quantity }],
      });
      navigate(`/orders/${order.id}`);
    } catch (err) {
      alert("Order failed. Please try again.");
    }
  }

  return (
    <div className="page">
      <h1>{product.name}</h1>
      <p className="sku">{product.sku}</p>
      {/* <div
        className="description"
        dangerouslySetInnerHTML={{ __html: product.description }}
      /> */}
      <p className="description">{product.description}</p>
      <p className="price">${product.price}</p>
      <p className="stock">
        {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
      </p>
      <div className="qty-row">
        {product.stock > 0 && <label htmlFor="quantity">Quantity:</label>}
        {product.stock > 0 && (
          <input
            type="number"
            min={1}
            max={product.stock}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        )}
      </div>
      <div className="actions">
        <button onClick={() => add(product, quantity)}>Add to cart</button>
        <button onClick={buyNow} disabled={product.stock === 0}>
          Buy now
        </button>
      </div>
    </div>
  );
}
