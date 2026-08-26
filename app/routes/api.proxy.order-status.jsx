const json = (data, init) => Response.json(data, init);
import crypto from "crypto";
import prisma from "../db.server";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

// Helper to verify Shopify App Proxy signature
const verifySignature = (query, apiSecret) => {
  const { signature, ...rest } = query;
  if (!signature) return false;

  // Sort and concatenate query parameters
  const sortedKeys = Object.keys(rest).sort();
  const inputString = sortedKeys
    .map((key) => {
      const val = rest[key];
      // Arrays should be joined with commas, values as string
      return `${key}=${Array.isArray(val) ? val.join(",") : val}`;
    })
    .join("");

  const calculatedSignature = crypto
    .createHmac("sha256", apiSecret)
    .update(inputString)
    .digest("hex");

  return calculatedSignature === signature;
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  
  const shop = query.shop;
  const orderId = query.order_id; // Added by our UI extension in the query

  if (!shop || !orderId) {
    return json({ error: "Missing required parameters: shop or order_id" }, { status: 400 });
  }

  // Verify signature from Shopify
  const apiSecret = process.env.SHOPIFY_API_SECRET || "";
  const isValid = verifySignature(query, apiSecret);

  if (!isValid) {
    console.error("Shopify proxy signature verification failed!");
    return json({ error: "Unauthorized. Signature verification failed." }, { status: 401 });
  }

  try {
    // 1. Fetch offline session for the shop
    const session = await prisma.session.findFirst({
      where: {
        shop,
        isOnline: false,
      },
    });

    if (!session) {
      return json({ error: "Shop session not found" }, { status: 404 });
    }

    // 2. Initialize Shopify API client
    const shopify = new shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      apiVersion: ApiVersion.July26,
      scopes: process.env.SCOPES?.split(","),
      isEmbeddedApp: true,
    });

    const client = new shopify.clients.Graphql({
      session: {
        shop: session.shop,
        accessToken: session.accessToken,
      },
    });

    // 3. Query the order from Shopify Admin API
    const response = await client.request(
      `#graphql
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          financialStatus
          paymentGatewayNames
        }
      }`,
      {
        variables: {
          id: orderId,
        },
      }
    );

    const order = response.data?.order;
    if (!order) {
      return json({ error: "Order not found on Shopify" }, { status: 404 });
    }

    const isPaid = order.financialStatus === "PAID";
    
    // If already paid, don't show the payment button
    if (isPaid) {
      return json({
        paid: true,
        showPaymentButton: false,
      });
    }

    // Build the checkout redirect URL to our app's pay route
    const appUrl = process.env.SHOPIFY_APP_URL || `${url.protocol}//${url.host}`;
    const checkoutUrl = `${appUrl}/api/pay?order_id=${encodeURIComponent(orderId)}&shop=${shop}`;

    return json({
      paid: false,
      showPaymentButton: true,
      checkoutUrl,
    });

  } catch (error) {
    console.error("Proxy Order status API error:", error);
    return json({ error: "Internal Server Error", details: error.message }, { status: 500 });
  }
};
