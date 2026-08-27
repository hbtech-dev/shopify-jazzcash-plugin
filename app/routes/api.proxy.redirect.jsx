/**
 * App Proxy Route: /apps/jazzcash/redirect
 *
 * Called via fetch() from Shopify Order Status Page Additional Scripts.
 * Returns { shouldRedirect: true, payUrl } for unpaid JazzCash orders.
 * The customer's browser script then does: window.location.href = payUrl
 */

import prisma from "../db.server";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, init) =>
  Response.json(data, {
    ...(init || {}),
    headers: { ...corsHeaders, ...((init || {}).headers || {}) },
  });

// Handle CORS preflight
export const options = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const orderNumber = url.searchParams.get("order_number"); // e.g. "1001"
  const orderId = url.searchParams.get("order_id"); // e.g. "gid://shopify/Order/12345"

  if (!shop) {
    return json({ error: "Missing shop parameter", shouldRedirect: false }, { status: 400 });
  }

  if (!orderNumber && !orderId) {
    return json(
      { error: "Missing order_number or order_id", shouldRedirect: false },
      { status: 400 }
    );
  }

  try {
    // 1. Fetch offline session for shop
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
    });

    if (!session) {
      return json(
        { error: "Shop not installed. Please reinstall the app.", shouldRedirect: false },
        { status: 404 }
      );
    }

    const requestHost = (url.hostname || request.headers.get("host") || "jazzcash.ultradigital.cc").replace(/^https?:\/\//, "");

    // 2. Init Shopify API client
    const shopify = new shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      apiVersion: ApiVersion.July25,
      scopes: process.env.SCOPES?.split(","),
      hostName: requestHost,
      isEmbeddedApp: true,
    });

    const client = new shopify.clients.Graphql({
      session: {
        shop: session.shop,
        accessToken: session.accessToken,
      },
    });

    let resolvedOrderId = orderId;

    // 3. If we only have order_number, look it up via Admin API
    if (!resolvedOrderId && orderNumber) {
      const searchRes = await client.request(
        `#graphql
        query findOrderByName($query: String!) {
          orders(first: 1, query: $query) {
            nodes {
              id
              name
              displayFinancialStatus
              paymentGatewayNames
            }
          }
        }`,
        { variables: { query: `name:#${orderNumber}` } }
      );

      const foundOrder = searchRes.data?.orders?.nodes?.[0];
      if (!foundOrder) {
        return json({ error: "Order not found", shouldRedirect: false });
      }

      resolvedOrderId = foundOrder.id;

      // Check if already paid
      if (foundOrder.displayFinancialStatus === "PAID") {
        return json({ shouldRedirect: false, reason: "already_paid" });
      }

      // Check if JazzCash was selected (includes "manual" for custom payment methods)
      const gateways = (foundOrder.paymentGatewayNames || []).map((g) =>
        g.toLowerCase()
      );
      const isJazzCash =
        gateways.some((g) => g.includes("jazz")) ||
        gateways.includes("manual") ||
        gateways.length === 0;

      if (!isJazzCash) {
        return json({
          shouldRedirect: false,
          reason: "not_jazzcash",
          gateways,
        });
      }
    }

    // 4. Build payment page URL dynamically based on incoming host
    const scheme = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "https";
    const currentHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || requestHost;
    const appUrl = `${scheme}://${currentHost}`;

    const payUrl = `${appUrl}/api/pay?order_id=${encodeURIComponent(
      resolvedOrderId
    )}&shop=${encodeURIComponent(shop)}`;

    return json({
      shouldRedirect: true,
      payUrl,
      orderId: resolvedOrderId,
    });
  } catch (err) {
    console.error("Proxy redirect error:", err);
    return json(
      { error: "Internal error", details: err.message, shouldRedirect: false },
      { status: 500 }
    );
  }
};
