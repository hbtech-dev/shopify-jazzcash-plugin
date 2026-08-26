/**
 * JazzCash Thank You Page Extension - jaazcash-9
 *
 * FIXED: Always renders something immediately.
 * Never returns early without showing UI.
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

// ── Main Target ──────────────────────────────────────────────────────────────
export default extension(
  "purchase.thank-you.block.render",
  (root, api) => {
    run(root, api);
  }
);

// ── Order Status Target ───────────────────────────────────────────────────────
export const orderStatusExtension = extension(
  "customer-account.order-status.block.render",
  (root, api) => {
    run(root, api);
  }
);

// ── Core Logic ────────────────────────────────────────────────────────────────
function run(root, api) {
  // Step 1: ALWAYS show loading banner immediately so something is visible
  showLoading(root);

  // Step 2: Get shop domain (plain string in this API)
  const shopDomain =
    (typeof api.shop?.myshopifyDomain === "string"
      ? api.shop.myshopifyDomain
      : null) || "";

  // Step 3: Try to render from current value
  try {
    const current = api.orderConfirmation?.current;
    if (current) {
      renderFromOrder(root, current, shopDomain);
      return;
    }
  } catch (e) {
    // keep loading banner, try subscription below
  }

  // Step 4: Subscribe for when order data becomes available
  try {
    if (typeof api.orderConfirmation?.subscribe === "function") {
      api.orderConfirmation.subscribe((orderData) => {
        try {
          renderFromOrder(root, orderData, shopDomain);
        } catch (e) {
          showPayButton(root, "", shopDomain);
        }
      });
    } else {
      // No subscription API — show generic pay button
      showPayButton(root, "", shopDomain);
    }
  } catch (e) {
    showPayButton(root, "", shopDomain);
  }
}

function renderFromOrder(root, orderData, shopDomain) {
  if (!orderData) return;

  // Handle both wrapped { order: {...} } and flat formats
  const order = orderData.order || orderData;
  const orderId = order.id || order.gid || "";
  const financialStatus = (order.financialStatus || "").toUpperCase();

  if (financialStatus === "PAID") {
    // Already paid — show success
    root.clear();
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

  showPayButton(root, orderId, shopDomain);
}

function showLoading(root) {
  root.clear();
  root.appendChild(
    root.createComponent(
      Banner,
      { title: "JazzCash Mobile Wallet", tone: "info" },
      [
        root.createComponent(BlockStack, {}, [
          root.createComponent(
            Text,
            {},
            "Loading your JazzCash payment details..."
          ),
        ]),
      ]
    )
  );
}

function showPayButton(root, orderId, shopDomain) {
  root.clear();

  // Build pay URL — works even without orderId (user can still reach our page)
  let payUrl = APP_URL + "/api/pay";
  const params = [];
  if (orderId) params.push("order_id=" + encodeURIComponent(orderId));
  if (shopDomain) params.push("shop=" + encodeURIComponent(shopDomain));
  if (params.length) payUrl += "?" + params.join("&");

  root.appendChild(
    root.createComponent(
      Banner,
      { title: "⚠️ Complete Your JazzCash Payment", tone: "critical" },
      [
        root.createComponent(BlockStack, {}, [
          root.createComponent(
            Text,
            {},
            "Your order is placed but payment is not yet complete. Tap below to pay via JazzCash Mobile Wallet."
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