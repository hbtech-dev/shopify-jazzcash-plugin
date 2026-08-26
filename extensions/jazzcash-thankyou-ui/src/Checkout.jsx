/**
 * JazzCash Thank You Page Extension - jaazcash-10
 *
 * FIXED: Removed root.clear() - it doesn't exist in this API.
 * Render ONCE, synchronously. No updates.
 * Order data is available immediately on the Thank You page.
 */

import {
  extension,
  Banner,
  BlockStack,
  Button,
  Text,
} from "@shopify/ui-extensions/checkout";

const APP_URL =
  "https://shopify-jazzcash-plugin-production.up.railway.app";

export default extension("purchase.thank-you.block.render", (root, api) => {
  renderPayment(root, api);
});

export const orderStatusExtension = extension(
  "customer-account.order-status.block.render",
  (root, api) => {
    renderPayment(root, api);
  }
);

function renderPayment(root, api) {
  // Get shop domain (plain string)
  const shopDomain = api.shop?.myshopifyDomain || "";

  // Get order data — available synchronously on Thank You page
  const orderConfirmation = api.orderConfirmation?.current;
  const order = orderConfirmation?.order || orderConfirmation || {};
  const orderId = order.id || "";
  const financialStatus = (order.financialStatus || "").toUpperCase();

  // If already fully paid, show success banner
  if (financialStatus === "PAID") {
    root.appendChild(
      root.createComponent(
        Banner,
        { title: "✅ Payment Complete", tone: "success" },
        [
          root.createComponent(BlockStack, {}, [
            root.createComponent(
              Text,
              {},
              "Your JazzCash payment has been received. Thank you!"
            ),
          ]),
        ]
      )
    );
    return;
  }

  // Build payment URL
  const params = new URLSearchParams();
  if (orderId) params.set("order_id", orderId);
  if (shopDomain) params.set("shop", shopDomain);
  const payUrl = APP_URL + "/api/pay" + (params.toString() ? "?" + params.toString() : "");

  // Show payment banner with button
  root.appendChild(
    root.createComponent(
      Banner,
      { title: "⚠️ Action Required: Complete JazzCash Payment", tone: "critical" },
      [
        root.createComponent(BlockStack, {}, [
          root.createComponent(
            Text,
            {},
            "Your order is confirmed but payment is not yet complete. Please pay via JazzCash Mobile Wallet to proceed."
          ),
          root.createComponent(
            Button,
            { kind: "primary", to: payUrl, target: "_top" },
            "👉 Pay Now with JazzCash Mobile Wallet"
          ),
          root.createComponent(
            Text,
            { appearance: "subdued" },
            "Secured by Ultra Digital Connect Gateway"
          ),
        ]),
      ]
    )
  );
}