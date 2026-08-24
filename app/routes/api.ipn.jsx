import { json } from "react-router";
import crypto from "crypto";
import prisma from "../db.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const params = Object.fromEntries(formData.entries());

    console.log("=== JAZZCASH BACKGROUND IPN RECEIVED ===");
    console.log(JSON.stringify(params, null, 2));

    const txnRefNo = params.pp_TxnRefNo;
    if (!txnRefNo) {
      return json({
        pp_ResponseCode: "999",
        pp_ResponseMessage: "Missing Transaction Reference Number",
        pp_SecureHash: "",
      });
    }

    // 1. Fetch transaction mapping
    const transaction = await prisma.jazzCashTransaction.findUnique({
      where: { txnRefNo },
    });

    if (!transaction) {
      console.warn(`IPN transaction mapping not found for Reference: ${txnRefNo}`);
      return json({
        pp_ResponseCode: "000", // Return success so JazzCash stops retrying, but log it
        pp_ResponseMessage: "Transaction mapping not found",
        pp_SecureHash: "",
      });
    }

    // 2. Fetch shop credentials
    const config = await prisma.jazzCashConfig.findUnique({
      where: { shop: transaction.shop },
    });

    if (!config) {
      console.error(`JazzCash configuration not found for shop: ${transaction.shop}`);
      return json({
        pp_ResponseCode: "999",
        pp_ResponseMessage: "Store configuration not found",
        pp_SecureHash: "",
      });
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
      console.error("IPN Hash validation failed!", { calculatedHash, receivedHash: params.pp_SecureHash });
      return json({
        pp_ResponseCode: "999",
        pp_ResponseMessage: "Secure hash validation failed",
        pp_SecureHash: "",
      });
    }

    // 4. Update Shopify order status if payment is success (000 or 121)
    const isSuccess = params.pp_ResponseCode === "000" || params.pp_ResponseCode === "121";

    if (isSuccess) {
      const session = await prisma.session.findFirst({
        where: {
          shop: transaction.shop,
          isOnline: false,
        },
      });

      if (!session) {
        console.error(`Shop session not found for ${transaction.shop}`);
        return json({
          pp_ResponseCode: "999",
          pp_ResponseMessage: "Shop session not found",
          pp_SecureHash: "",
        });
      }

      const numericOrderId = transaction.orderId.split("/").pop();

      // Check if order is already paid to avoid duplicate capture transactions
      const orderCheckUrl = `https://${transaction.shop}/admin/api/2026-07/orders/${numericOrderId}.json`;
      const orderCheck = await fetch(orderCheckUrl, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
        },
      });

      if (orderCheck.ok) {
        const orderData = await orderCheck.json();
        if (orderData.order?.financial_status === "paid") {
          console.log(`Order ${orderData.order.name} is already marked as paid. Skipping capture.`);
          return json({
            pp_ResponseCode: "000",
            pp_ResponseMessage: "IPN received successfully (already paid)",
            pp_SecureHash: "",
          });
        }
      }

      // Mark the order as PAID by creating a capture transaction
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
        console.error("IPN: Failed to capture transaction in Shopify:", errorText);
        return json({
          pp_ResponseCode: "999",
          pp_ResponseMessage: "Failed to update Shopify order status",
          pp_SecureHash: "",
        });
      }

      console.log(`IPN: Successfully updated Shopify order ${numericOrderId} to PAID.`);
    }

    return json({
      pp_ResponseCode: "000",
      pp_ResponseMessage: "IPN received successfully",
      pp_SecureHash: "",
    });

  } catch (error) {
    console.error("IPN handler error:", error);
    return json({
      pp_ResponseCode: "999",
      pp_ResponseMessage: `Internal error: ${error.message}`,
      pp_SecureHash: "",
    }, { status: 500 });
  }
};

// GET status for diagnostic check
export const loader = async () => {
  return json({
    status: "Active",
    message: "JazzCash Shopify Background IPN Endpoint is Active.",
  });
};
