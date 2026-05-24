import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi, describe, it, expect, afterEach } from "vitest";
import OrderDetailPage from "../pages/OrderDetailPage";

// Mock the api module
vi.mock("../api", () => ({
    getOrder: vi.fn(),
    chargeOrder: vi.fn(),
}));

import { getOrder } from "../api";

const mockOrder = {
    id: 1,
    status: "PENDING",
    totalAmount: "29.99",
    customerId: "customer_001",
    createdAt: new Date().toISOString(),
    items: [{ name: "Test Product", quantity: 1, unitPrice: "29.99" }],
    payments: [],
};

function renderPage() {
    return render(
        <MemoryRouter initialEntries={["/orders/1"]}>
            <Routes>
                <Route path="/orders/:id" element={<OrderDetailPage />} />
            </Routes>
        </MemoryRouter>
    );
}

afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
});

describe("OrderDetailPage", () => {
    it("clears the polling interval when the component unmounts", async () => {
        vi.useFakeTimers();
        (getOrder as ReturnType<typeof vi.fn>).mockResolvedValue(mockOrder);

        const { unmount } = renderPage();

        // Wait for initial load
        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByText(/Order #1/i)).toBeInTheDocument();

        // getOrder called once on mount
        expect(getOrder).toHaveBeenCalledTimes(1);

        // Advance timer — interval fires
        await act(async () => {
            vi.advanceTimersByTime(2000);
            await Promise.resolve();
        });

        expect(getOrder).toHaveBeenCalledTimes(2);

        // Unmount — interval should be cleared
        unmount();

        // Advance timer again — getOrder should NOT be called again
        await act(async () => {
            vi.advanceTimersByTime(4000);
            await Promise.resolve();
        });

        expect(getOrder).toHaveBeenCalledTimes(2); // still 2, not 3 or 4
    });

    it("displays order details correctly", async () => {
        vi.useFakeTimers();
        (getOrder as ReturnType<typeof vi.fn>).mockResolvedValue(mockOrder);

        renderPage();

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByText(/Order #1/i)).toBeInTheDocument();
        expect(screen.getByText(/PENDING/i)).toBeInTheDocument();
        expect(screen.getByText(/Pay now/i)).toBeInTheDocument();
    });
});