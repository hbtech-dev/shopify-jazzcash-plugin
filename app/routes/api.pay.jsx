import { json } from "react-router";
import { useLoaderData } from "react-router";
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
  const shop = url.searchParams.get("shop");

  if (!orderId || !shop) {
    return json({ error: "Missing order_id or shop parameter" }, { status: 400 });
  }

  try {
    const session = await prisma.session.findFirst({
      where: {
        shop,
        isOnline: false,
      },
    });

    if (!session) {
      return json({ error: "Shopify session not found. Please re-authenticate the app." }, { status: 404 });
    }

    // Query order details from Shopify Admin GraphQL API
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

    const response = await client.request(
      `#graphql
      query getOrderDetails($id: ID!) {
        order(id: $id) {
          id
          name
          financialStatus
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
          id: orderId,
        },
      }
    );

    const order = response.data?.order;
    if (!order) {
      return json({ error: "Order not found on Shopify" }, { status: 404 });
    }

    if (order.financialStatus === "PAID") {
      return json({ error: "This order has already been paid." }, { status: 400 });
    }

    const amountPKR = parseFloat(order.totalPriceSet.shopMoney.amount);
    const customerPhone = formatPhoneNumber(order.phone || order.customer?.phone || "");
    const storeCode = sanitizeStoreName(shop);
    const billRef = order.name;

    // FORWARD TO CENTRAL GATEWAY API (api.ultradigital.cc)
    const gatewayUrl = "https://api.ultradigital.cc/api/payment";
    
    const gatewayPayload = {
      subMerchantName: storeCode,
      amountPKR: amountPKR,
      mobileNo: customerPhone,
      billRef: billRef,
      description: `Shopify Order ${order.name} at ${storeCode}`,
      returnUrl: `https://api.ultradigital.cc/api/result`
    };

    const gatewayRes = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gatewayPayload),
    });

    const gatewayData = await gatewayRes.json();

    // Save transaction mapping to local DB
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
        console.error("Local Prisma transaction log error:", e);
      }
    }

    return {
      orderName: order.name,
      amountPKR: amountPKR,
      storeName: storeCode,
      gatewayResponse: gatewayData,
    };

  } catch (error) {
    console.error("Shopify Gateway Proxy Error:", error);
    return json({ error: "Failed to initiate payment through gateway", details: error.message }, { status: 500 });
  }
};

export default function Pay() {
  const data = useLoaderData();

  if (data?.error) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "40px", textAlign: "center", color: "#d32f2f" }}>
        <h2>Payment Error</h2>
        <p>{data.error}</p>
        {data.details && <pre style={{ background: "#f5f5f5", padding: "10px", display: "inline-block" }}>{data.details}</pre>}
      </div>
    );
  }

  const res = data?.gatewayResponse || {};
  const isSuccess = res.pp_ResponseCode === '000' || res.responseCode === '000' || res.success === true;
  const isPending = res.pp_ResponseCode === '124' || res.pp_ResponseCode === '157' || res.responseCode === '124';

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
        padding: "28px",
        textAlign: "center",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.7)"
      }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>
          {isSuccess ? "✅" : (isPending ? "⏳" : "❌")}
        </div>

        <h2 style={{ fontSize: "20px", margin: "0 0 6px 0", color: isSuccess ? "#34d399" : (isPending ? "#fcd34d" : "#fda4af") }}>
          {isSuccess ? "Payment Successful!" : (isPending ? "Payment Pending / MPIN Prompted" : "Payment Request Submitted")}
        </h2>

        <p style={{ fontSize: "13px", color: "#9ca3af", margin: "0 0 20px 0" }}>
          {isPending ? "Please check your mobile phone for the JazzCash MPIN prompt to authorize payment." : (res.responseMessage || res.pp_ResponseMessage || "Processed via Ultra Digital Connect Gateway")}
        </p>

        <div style={{ backgroundColor: "#030712", borderRadius: "10px", padding: "16px", border: "1px solid #1f2937", textAlign: "left", fontSize: "12px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#9ca3af" }}>Store:</span>
            <strong style={{ color: "#38bdf8" }}>{data?.storeName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#9ca3af" }}>Shopify Order:</span>
            <strong style={{ color: "#ffffff" }}>{data?.orderName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#9ca3af" }}>Amount:</span>
            <strong style={{ color: "#10b981", fontSize: "14px" }}>Rs. {data?.amountPKR?.toLocaleString()}</strong>
          </div>
          {res.txnRefNo && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#9ca3af" }}>Txn Ref:</span>
              <strong style={{ color: "#d1d5db", fontFamily: "monospace" }}>{res.txnRefNo}</strong>
            </div>
          )}
        </div>

        <div style={{ fontSize: "11px", color: "#6b7280" }}>
          Powered by <strong>Ultra Digital Connect Gateway</strong> &bull; Synced with MongoDB Atlas
        </div>
      </div>
    </div>
  );
}
