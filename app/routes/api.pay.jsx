import { json } from "react-router";
import { useLoaderData } from "react-router";
import { useEffect } from "react";
import crypto from "crypto";
import prisma from "../db.server";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

// Helper to format date as YYYYMMDDHHMMSS
const formatDateTime = (date) => {
  const pad = (num) => String(num).padStart(2, "0");
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
};

// Helper to format Pakistani mobile number to 11 digits (e.g., 03001234567)
const formatPhoneNumber = (phone) => {
  if (!phone) return "";
  // Strip all non-numeric characters
  let cleaned = phone.replace(/\D/g, "");
  
  // Handle country code +92 or 92
  if (cleaned.startsWith("92")) {
    cleaned = "0" + cleaned.substring(2);
  }
  // Handle number without leading 0
  else if (cleaned.length === 10 && cleaned.startsWith("3")) {
    cleaned = "0" + cleaned;
  }
  
  return cleaned.length === 11 ? cleaned : "";
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id");
  const shop = url.searchParams.get("shop");

  if (!orderId || !shop) {
    return json({ error: "Missing order_id or shop parameter" }, { status: 400 });
  }

  try {
    // 1. Fetch credentials and shop session
    const config = await prisma.jazzCashConfig.findUnique({
      where: { shop },
    });

    const session = await prisma.session.findFirst({
      where: {
        shop,
        isOnline: false,
      },
    });

    if (!config || !session) {
      return json({ error: "JazzCash configuration or shop session not found. Please configure the app settings first." }, { status: 404 });
    }

    // 2. Query order details from Shopify Admin API
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

    // 3. Generate transaction parameters
    const now = new Date();
    const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours expiry

    const txnDateTime = formatDateTime(now);
    const txnExpiryDateTime = formatDateTime(expiry);

    // Generate random 15-character transaction reference number
    const randomSuffix = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
    const txnRefNo = "T" + txnDateTime.substring(2, 10) + String(randomSuffix); // e.g. T260824123456

    const amount = Math.round(parseFloat(order.totalPriceSet.shopMoney.amount) * 100).toString(); // Convert to paisa
    const customerPhone = formatPhoneNumber(order.phone || order.customer?.phone || "");
    const billRef = order.name;
    const description = `Shopify Payment for Order ${order.name}`;

    // App URL for return endpoint
    const appUrl = process.env.SHOPIFY_APP_URL || `${url.protocol}//${url.host}`;
    const returnUrl = `${appUrl}/api/return`;

    const payload = {
      pp_Version: "1.1",
      pp_TxnType: "MWALLET",
      pp_Language: "EN",
      pp_MerchantID: config.merchantId,
      pp_Password: config.password,
      pp_TxnRefNo: txnRefNo,
      pp_Amount: amount,
      pp_TxnCurrency: "PKR",
      pp_TxnDateTime: txnDateTime,
      pp_TxnExpiryDateTime: txnExpiryDateTime,
      pp_BillReference: billRef,
      pp_Description: description,
      pp_ReturnURL: returnUrl,
      ppmpf_1: customerPhone,
      ppmpf_2: "",
      ppmpf_3: "",
      ppmpf_4: "",
      ppmpf_5: "",
    };

    // Calculate Secure Hash (HMAC-SHA256)
    // For Form Redirect flow, only keys starting with 'pp_' are hashed (excluding ppmpf_* fields)
    const hashKeys = Object.keys(payload)
      .filter((k) => k.startsWith("pp_") && k !== "pp_SecureHash" && payload[k] !== undefined && payload[k] !== "")
      .sort();

    let hashString = config.integritySalt;
    for (const k of hashKeys) {
      hashString += "&" + payload[k];
    }

    const secureHash = crypto
      .createHmac("sha256", config.integritySalt)
      .update(hashString)
      .digest("hex")
      .toUpperCase();

    payload.pp_SecureHash = secureHash;

    // 4. Save transaction mapping to the database
    await prisma.jazzCashTransaction.create({
      data: {
        txnRefNo,
        orderId,
        shop,
        amount,
      },
    });

    const formUrl = "https://onlinepayments.jazzcash.com.pk/payment-orchestrator/CustomerPortal/transactionmanagement/merchantform";

    return {
      payload,
      formUrl,
    };

  } catch (error) {
    console.error("Payment initiation API error:", error);
    return json({ error: "Failed to initiate payment", details: error.message }, { status: 500 });
  }
};

export default function Pay() {
  const data = useLoaderData();

  useEffect(() => {
    if (data?.payload && data?.formUrl) {
      document.getElementById("jazzcash-form").submit();
    }
  }, [data]);

  if (data?.error) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "40px", textAlign: "center", color: "#d32f2f" }}>
        <h2>Payment Error</h2>
        <p>{data.error}</p>
        {data.details && <pre style={{ background: "#f5f5f5", padding: "10px", display: "inline-block" }}>{data.details}</pre>}
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "system-ui, sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      backgroundColor: "#fafafa"
    }}>
      <div style={{ textAlign: "center" }}>
        <h3 style={{ color: "#333", marginBottom: "8px" }}>Redirecting to JazzCash...</h3>
        <p style={{ color: "#666", fontSize: "14px" }}>Please do not close this window or click back.</p>
        <div style={{
          border: "4px solid #f3f3f3",
          borderTop: "4px solid #d32f2f",
          borderRadius: "50%",
          width: "40px",
          height: "40px",
          animation: "spin 1s linear infinite",
          margin: "20px auto"
        }} />
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}} />

      {data?.payload && data?.formUrl && (
        <form id="jazzcash-form" method="POST" action={data.formUrl}>
          {Object.keys(data.payload).map((key) => (
            <input key={key} type="hidden" name={key} value={data.payload[key]} />
          ))}
        </form>
      )}
    </div>
  );
}
