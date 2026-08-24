import { useActionData, useLoaderData, redirect } from "react-router";
import crypto from "crypto";
import prisma from "../db.server";

// Helper to set CORS headers (needed just in case)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const action = async ({ request }) => {
  try {
    const formData = await request.formData();
    const params = Object.fromEntries(formData.entries());

    console.log("=== JAZZCASH RETURN CALLBACK RECEIVED ===");
    console.log(JSON.stringify(params, null, 2));

    const txnRefNo = params.pp_TxnRefNo;
    if (!txnRefNo) {
      return { error: "Missing Transaction Reference Number (pp_TxnRefNo)" };
    }

    // 1. Fetch transaction details from database
    const transaction = await prisma.jazzCashTransaction.findUnique({
      where: { txnRefNo },
    });

    if (!transaction) {
      return { error: `Transaction mapping not found for Reference: ${txnRefNo}` };
    }

    // 2. Fetch shop credentials
    const config = await prisma.jazzCashConfig.findUnique({
      where: { shop: transaction.shop },
    });

    if (!config) {
      return { error: "JazzCash configuration not found for this store" };
    }

    // 3. Verify Secure Hash
    const hashKeys = Object.keys(params)
      .filter((k) => k.startsWith("pp_") && k !== "pp_SecureHash" && params[k] !== undefined && params[k] !== "")
      .sort();

    let hashString = config.integritySalt;
    for (const k of hashKeys) {
      hashString += "&" + params[k];
    }

    const calculatedHash = crypto
      .createHmac("sha256", config.integritySalt)
      .update(hashString)
      .digest("hex")
      .toUpperCase();

    if (calculatedHash !== params.pp_SecureHash) {
      console.error("Hash validation failed!", { calculatedHash, receivedHash: params.pp_SecureHash });
      return { error: "Secure hash validation failed. Transaction could be tampered." };
    }

    // 4. Handle response code (000 and 121 are success)
    const isSuccess = params.pp_ResponseCode === "000" || params.pp_ResponseCode === "121";

    if (isSuccess) {
      // Fetch session to call Shopify Admin API
      const session = await prisma.session.findFirst({
        where: {
          shop: transaction.shop,
          isOnline: false,
        },
      });

      if (!session) {
        return { error: "Shop session not found to capture payment" };
      }

      const numericOrderId = transaction.orderId.split("/").pop();

      // Mark the order as PAID by creating a capture transaction in Shopify
      const shopifyApiUrl = `https://${transaction.shop}/admin/api/2026-07/orders/${numericOrderId}/transactions.json`;
      
      const captureResponse = await fetch(shopifyApiUrl, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transaction: {
            currency: "PKR",
            amount: (parseFloat(transaction.amount) / 100).toString(),
            kind: "capture",
            status: "success",
            gateway: "JazzCash Mobile Wallet",
            gateway_transaction_id: txnRefNo,
          },
        }),
      });

      if (!captureResponse.ok) {
        const errorText = await captureResponse.text();
        console.error("Failed to capture transaction in Shopify:", errorText);
        return { error: "Payment was successful, but we failed to update the order status in Shopify. Please contact support." };
      }

      // Redirect customer to the Shopify thank you / order status page
      return redirect(`https://${transaction.shop}/orders/${numericOrderId}`);
    } else {
      // Render payment failure page with try again option
      return {
        error: params.pp_ResponseMessage || "Payment was declined by JazzCash.",
        responseCode: params.pp_ResponseCode,
        tryAgainUrl: `/api/pay?order_id=${encodeURIComponent(transaction.orderId)}&shop=${transaction.shop}`,
      };
    }

  } catch (error) {
    console.error("Error processing return callback:", error);
    return { error: "An unexpected error occurred while processing the payment return.", details: error.message };
  }
};

// Handle GET requests (in case user refreshes or gets redirected via GET)
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const txnRefNo = url.searchParams.get("pp_TxnRefNo");

  if (!txnRefNo) {
    return { error: "Invalid Request. Missing parameters." };
  }

  // Treat GET as action if we have parameters
  return { error: "GET requests are not supported directly. Please ensure you are redirected correctly from JazzCash." };
};

export default function Return() {
  const data = useActionData() || useLoaderData();

  if (data?.error) {
    return (
      <div style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#fafafa",
        padding: "20px"
      }}>
        <div style={{
          maxWidth: "480px",
          width: "100%",
          background: "#fff",
          padding: "30px",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>❌</div>
          <h2 style={{ color: "#d32f2f", margin: "0 0 10px 0" }}>Payment Failed</h2>
          <p style={{ color: "#555", fontSize: "15px", lineHeight: "1.5", marginBottom: "24px" }}>
            {data.error}
          </p>
          
          {data.responseCode && (
            <p style={{ fontSize: "12px", color: "#888", marginBottom: "20px" }}>
              Error Code: {data.responseCode}
            </p>
          )}

          {data.tryAgainUrl ? (
            <a href={data.tryAgainUrl} style={{
              display: "inline-block",
              background: "#d32f2f",
              color: "#fff",
              textDecoration: "none",
              padding: "12px 24px",
              borderRadius: "4px",
              fontWeight: "600",
              fontSize: "14px",
              boxShadow: "0 2px 4px rgba(211,47,47,0.3)",
              transition: "background 0.2s"
            }}
            onMouseOver={(e) => e.target.style.background = "#b71c1c"}
            onMouseOut={(e) => e.target.style.background = "#d32f2f"}>
              Try Payment Again
            </a>
          ) : (
            <p style={{ color: "#888", fontSize: "13px" }}>Please check your transaction status or contact support.</p>
          )}
        </div>
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
        <h3 style={{ color: "#333", marginBottom: "8px" }}>Verifying Payment Status...</h3>
        <p style={{ color: "#666", fontSize: "14px" }}>Please do not close this window.</p>
        <div style={{
          border: "4px solid #f3f3f3",
          borderTop: "4px solid #4caf50",
          borderRadius: "50%",
          width: "40px",
          height: "40px",
          animation: "spin 1s linear infinite",
          margin: "20px auto"
        }} />
      </div>
    </div>
  );
}
