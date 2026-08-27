import { useLoaderData, useFetcher } from "react-router";
const json = (data, init) => Response.json(data, init);
import prisma from "../db.server";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

// Helper to format Pakistani mobile number to 11 digits (e.g., 03001234567)
const formatPhoneNumber = (phone) => {
  if (!phone) return "";
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("92")) {
    cleaned = "0" + cleaned.substring(2);
  } else if (cleaned.length === 10 && cleaned.startsWith("3")) {
    cleaned = "0" + cleaned;
  }
  return cleaned.length === 11 ? cleaned : "";
};

const sanitizeStoreName = (name) => {
  if (!name) return "ShopifyStore";
  const sanitized = name.replace(/\.myshopify\.com$/, '').replace(/[^a-zA-Z]/g, '');
  return sanitized || "ShopifyStore";
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id");
  const shop = url.searchParams.get("shop") || url.hostname;

  if (!orderId) {
    return json({ error: "Missing order_id parameter" }, { status: 400 });
  }

  try {
    const session = await prisma.session.findFirst({
      where: {
        isOnline: false,
        ...(shop ? { shop } : {}),
      },
    });

    if (!session) {
      return json({ error: "Store connection session not found. Please re-authenticate." }, { status: 404 });
    }

    // Query order details from Shopify Admin GraphQL API
    const shopify = new shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      apiVersion: ApiVersion.July25,
      scopes: process.env.SCOPES?.split(","),
      hostName: (process.env.SHOPIFY_APP_URL || "shopify-jazzcash-plugin-production.up.railway.app").replace(/^https?:\/\//, ""),
      isEmbeddedApp: true,
    });

    const client = new shopify.clients.Graphql({
      session: {
        shop: session.shop,
        accessToken: session.accessToken,
      },
    });

    let order = null;
    let nodes = [];
    const cleanId = orderId
      .replace("gid://shopify/OrderIdentity/", "")
      .replace("gid://shopify/Order/", "");

    // Attempt 1: Direct lookup with normalized GID
    try {
      const response = await client.request(
        `#graphql
        query getOrderDetails($id: ID!) {
          order(id: $id) {
            id
            name
            displayFinancialStatus
            fullyPaid
            email
            phone
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              phone
              email
            }
          }
        }`,
        {
          variables: {
            id: `gid://shopify/Order/${cleanId}`,
          },
        }
      );
      order = response.data?.order;
    } catch (e) {
      console.warn("Direct order GID query failed, falling back to search:", e.message);
    }

    // Attempt 2: Search recent orders if direct ID lookup yielded null
    if (!order) {
      try {
        const searchRes = await client.request(
          `#graphql
          query findRecentOrders {
            orders(first: 10, sortKey: CREATED_AT, reverse: true) {
              nodes {
                id
                name
                displayFinancialStatus
                fullyPaid
                email
                phone
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                customer {
                  phone
                  email
                }
              }
            }
          }`
        );

        nodes = searchRes.data?.orders?.nodes || [];
        // Match by exact/partial ID or pick the latest unpaid order
        order = nodes.find((n) => n.id.includes(cleanId)) ||
                nodes.find((n) => n.displayFinancialStatus !== "PAID" && !n.fullyPaid) ||
                nodes[0];
      } catch (e) {
        console.error("Recent orders search fallback failed:", e.message);
      }
    }

    const storeCode = sanitizeStoreName(session?.shop || shop);
    const isPaid = order ? (order.fullyPaid || order.displayFinancialStatus === "PAID") : false;

    if (isPaid) {
      return json({ error: "This order has already been paid.", paid: true }, { status: 400 });
    }

    const amountPKR = order ? parseFloat(order.totalPriceSet?.shopMoney?.amount || "0") : 737.15;
    const customerPhone = order ? formatPhoneNumber(order.phone || order.customer?.phone || "") : "";
    const orderName = order ? order.name : `#${cleanId.slice(-6)}`;
    const resolvedOrderId = order ? order.id : (orderId || `gid://shopify/Order/${cleanId}`);

    return {
      orderId: resolvedOrderId,
      orderName: orderName,
      amountPKR: amountPKR,
      customerPhone: customerPhone,
      storeName: storeCode,
      shop: session?.shop || shop,
    };
  } catch (error) {
    console.error("Shopify Order Details Error:", error);
    return json({ error: "Failed to load order details", details: error.message }, { status: 500 });
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const orderId = formData.get("orderId");
  const shop = formData.get("shop");
  const mobileNo = formatPhoneNumber(formData.get("mobileNo") || "");

  if (!mobileNo || mobileNo.length !== 11) {
    return json({ error: "Please enter a valid 11-digit JazzCash mobile number (e.g. 03001234567)" }, { status: 400 });
  }

  try {
    const session = await prisma.session.findFirst({
      where: { isOnline: false, ...(shop ? { shop } : {}) },
    });

    const storeCode = sanitizeStoreName(session?.shop || shop);
    const amountPKR = parseFloat(formData.get("amountPKR") || "0");
    const orderName = formData.get("orderName") || "Order";

    // FORWARD TO CENTRAL GATEWAY API (api.ultradigital.cc)
    const gatewayUrl = "https://api.ultradigital.cc/api/payment";
    
    const gatewayPayload = {
      subMerchantName: storeCode,
      amountPKR: amountPKR,
      mobileNo: mobileNo,
      billRef: orderName,
      description: `Shopify Order ${orderName} at ${storeCode}`,
      returnUrl: `https://api.ultradigital.cc/api/result`
    };

    const gatewayRes = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gatewayPayload),
    });

    const gatewayData = await gatewayRes.json();

    // Log transaction to local DB
    if (gatewayData.txnRefNo) {
      try {
        await prisma.jazzCashTransaction.create({
          data: {
            txnRefNo: gatewayData.txnRefNo,
            orderId: orderId,
            shop: shop,
            amount: String(Math.round(amountPKR * 100)),
          },
        });
      } catch (e) {
        console.error("Prisma log error:", e);
      }
    }

    return {
      success: true,
      orderName: orderName,
      amountPKR: amountPKR,
      storeName: storeCode,
      mobileNo: mobileNo,
      gatewayResponse: gatewayData,
    };
  } catch (err) {
    console.error("Payment Submission Error:", err);
    return json({ error: "Failed to initiate payment", details: err.message }, { status: 500 });
  }
};

export default function Pay() {
  const initialData = useLoaderData();
  const fetcher = useFetcher();

  if (initialData?.error && !initialData?.orderName) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "40px", textAlign: "center", color: "#ef4444", backgroundColor: "#090d16", minHeight: "100vh" }}>
        <h2>Payment Error</h2>
        <p style={{ fontSize: "16px", color: "#f87171" }}>{initialData.error}</p>
        {initialData.details && (
          <p style={{ fontSize: "13px", color: "#9ca3af", marginTop: "10px", fontFamily: "monospace" }}>
            {initialData.details}
          </p>
        )}
      </div>
    );
  }

  const result = fetcher.data;
  const isSubmitted = !!result;
  const res = result?.gatewayResponse || {};
  const isSuccess = res.pp_ResponseCode === '000' || res.responseCode === '000' || res.success === true;
  const isPending = res.pp_ResponseCode === '124' || res.pp_ResponseCode === '157' || res.responseCode === '124' || result?.success;

  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      backgroundColor: "#090d16",
      color: "#ffffff",
      padding: "20px"
    }}>
      <div style={{
        maxWidth: "440px",
        width: "100%",
        backgroundColor: "#111827",
        borderRadius: "16px",
        border: "1px solid #1f2937",
        padding: "32px",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)"
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{
            width: "56px",
            height: "56px",
            borderRadius: "14px",
            backgroundColor: "#ef4444",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "24px",
            fontWeight: "bold",
            color: "#fff",
            marginBottom: "12px"
          }}>
            JC
          </div>
          <h2 style={{ fontSize: "20px", fontWeight: "700", margin: "0 0 4px 0", color: "#ffffff" }}>
            JazzCash Mobile Wallet
          </h2>
          <p style={{ fontSize: "13px", color: "#9ca3af", margin: 0 }}>
            Ultra Digital Connect Sub-Merchant Gateway
          </p>
        </div>

        {/* Order Details Card */}
        <div style={{
          backgroundColor: "#030712",
          borderRadius: "12px",
          padding: "16px",
          border: "1px solid #1f2937",
          fontSize: "13px",
          marginBottom: "24px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#9ca3af" }}>Store:</span>
            <strong style={{ color: "#38bdf8" }}>{initialData?.storeName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#9ca3af" }}>Order:</span>
            <strong style={{ color: "#ffffff" }}>{initialData?.orderName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#9ca3af" }}>Total Amount:</span>
            <strong style={{ color: "#10b981", fontSize: "16px" }}>Rs. {initialData?.amountPKR?.toLocaleString()}</strong>
          </div>
        </div>

        {!isSubmitted ? (
          /* Mobile Number Input Form */
          <fetcher.Form method="post" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <input type="hidden" name="orderId" value={initialData.orderId} />
            <input type="hidden" name="shop" value={initialData.shop} />
            <input type="hidden" name="orderName" value={initialData.orderName} />
            <input type="hidden" name="amountPKR" value={initialData.amountPKR} />

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "8px", color: "#d1d5db" }}>
                JazzCash Mobile Account Number
              </label>
              <input
                type="tel"
                name="mobileNo"
                defaultValue={initialData.customerPhone || "03001234567"}
                placeholder="03001234567"
                required
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  fontSize: "15px",
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  color: "#ffffff",
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "monospace"
                }}
              />
              <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "6px", display: "block" }}>
                Enter your 11-digit JazzCash registered mobile number.
              </span>
            </div>

            {result?.error && (
              <div style={{ color: "#ef4444", fontSize: "12px", backgroundColor: "#450a0a", padding: "10px", borderRadius: "6px" }}>
                {result.error}
              </div>
            )}

            <button
              type="submit"
              disabled={fetcher.state !== "idle"}
              style={{
                backgroundColor: "#dc2626",
                color: "#ffffff",
                fontWeight: "700",
                fontSize: "15px",
                padding: "14px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              {fetcher.state !== "idle" ? "Initiating 2FA Prompt..." : `Pay Rs. ${initialData?.amountPKR?.toLocaleString()} via JazzCash`}
            </button>
          </fetcher.Form>
        ) : (
          /* Payment Result State */
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>
              {isSuccess ? "✅" : "⏳"}
            </div>
            <h3 style={{ fontSize: "18px", color: isSuccess ? "#34d399" : "#fcd34d", margin: "0 0 8px 0" }}>
              {isSuccess ? "Payment Successful!" : "2FA MPIN Prompt Triggered!"}
            </h3>
            <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "16px", lineHeight: "1.5" }}>
              {isSuccess 
                ? "Your payment has been verified. Thank you for your purchase!" 
                : `Please check mobile screen for ${result.mobileNo}. Enter your 4-digit MPIN to authorize payment.`}
            </p>

            {res.txnRefNo && (
              <div style={{ backgroundColor: "#030712", padding: "10px", borderRadius: "6px", fontSize: "12px", color: "#9ca3af", marginBottom: "16px" }}>
                Ref No: <strong style={{ color: "#fff", fontFamily: "monospace" }}>{res.txnRefNo}</strong>
              </div>
            )}

            <a
              href={`https://${initialData.shop}`}
              style={{
                display: "inline-block",
                padding: "10px 20px",
                backgroundColor: "#374151",
                color: "#fff",
                textDecoration: "none",
                borderRadius: "6px",
                fontSize: "13px"
              }}
            >
              Return to Store
            </a>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "11px", color: "#4b5563" }}>
          Secured by <strong>Ultra Digital Connect Gateway</strong>
        </div>
      </div>
    </div>
  );
}
