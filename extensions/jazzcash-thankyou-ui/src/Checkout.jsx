/**
 * JazzCash Thank You Page Extension
 *
 * Uses @shopify/ui-extensions/checkout extension() API.
 * The `api` object provides order + shop data directly.
 * Shows a prominent "Pay Now" button that navigates to our payment page.
 */

import { extension, Banner, BlockStack, Button, Text } from "@shopify/ui-extensions/checkout";

const APP_URL = "https://shopify-jazzcash-plugin-production.up.railway.app";

export default extension(
  "purchase.thank-you.block.render",
  async (root, api) => {
    await renderJazzCashPayment(root, api);
  }
);

export const orderStatusExtension = extension(
  "customer-account.order-status.block.render",
  async (root, api) => {
    await renderJazzCashPayment(root, api);
  }
);

async function renderJazzCashPayment(root, api) {
  // Get order and shop from the api object
  const order = api.orderConfirmation?.current;
  const shopDomain =
    api.shop?.myshopifyDomain?.current ||
    api.shop?.myshopifyDomain ||
    "";

  // If no order data yet, subscribe to changes
  if (!order) {
    // Try subscribing to orderConfirmation
    if (api.orderConfirmation?.subscribe) {
      api.orderConfirmation.subscribe((newOrder) => {
        if (newOrder) {
          renderPaymentUI(root, api, newOrder, shopDomain);
        }
      });
    }
    return;
  }

  renderPaymentUI(root, api, order, shopDomain);
}

function renderPaymentUI(root, api, order, shopDomain) {
  const orderId = order?.order?.id || order?.id || "";
  const financialStatus =
    order?.order?.financialStatus || order?.financialStatus || "";

  // Clear any existing content
  root.clear();

  // Already paid — show success
  if (financialStatus === "PAID" || financialStatus === "paid") {
    root.appendChild(
      root.createComponent(Banner, { title: "Payment Verified ✅", tone: "success" }, [
        root.createComponent(BlockStack, {}, [
          root.createComponent(
            Text,
            {},
            "Your JazzCash payment has been received. Thank you!"
          ),
        ]),
      ])
    );
    return;
  }

  if (!orderId || !shopDomain) {
    // No data available — show a generic loading message
    root.appendChild(
      root.createComponent(Banner, { title: "JazzCash Mobile Wallet", tone: "info" }, [
        root.createComponent(BlockStack, {}, [
          root.createComponent(Text, {}, "Loading payment details..."),
        ]),
      ])
    );
    return;
  }

  // Build payment URL
  const payUrl =
    `${APP_URL}/api/pay` +
    `?order_id=${encodeURIComponent(orderId)}` +
    `&shop=${encodeURIComponent(shopDomain)}`;

  // Show prominent payment banner with button
  root.appendChild(
    root.createComponent(
      Banner,
      { title: "⚠️ Complete Your JazzCash Payment", tone: "critical" },
      [
        root.createComponent(BlockStack, { spacing: "loose" }, [
          root.createComponent(
            Text,
            {},
            "Your order is placed but payment is not yet complete. Please tap the button below to pay via JazzCash Mobile Wallet."
          ),
          root.createComponent(
            Button,
            { kind: "primary", to: payUrl, target: "_top" },
            "👉 Pay Now with JazzCash Mobile Wallet"
          ),
          root.createComponent(
            Text,
            { size: "small", appearance: "subdued" },
            "Securely redirected to Ultra Digital Connect payment gateway."
          ),
        ]),
      ]
    )
  );
}