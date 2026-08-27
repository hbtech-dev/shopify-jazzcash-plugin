import { useState, useEffect } from "react";
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
  if (!name) return "Store";
  const sanitized = name.replace(/\.myshopify\.com$/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized || "Store";
};

// Validate if prefix belongs to valid Pakistani Mobile Networks
const isValidPakistaniMobile = (number) => {
  const cleaned = formatPhoneNumber(number);
  if (!cleaned || cleaned.length !== 11) return false;
  return /^03[0-9]{9}$/.test(cleaned);
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id");
  const shop = url.searchParams.get("shop") || url.hostname;
  const merchantId = url.searchParams.get("merchant_id") || url.searchParams.get("sub_merchant");
  const amountParam = url.searchParams.get("amount");
  const returnUrl = url.searchParams.get("return_url");

  if (!orderId && !amountParam) {
    return json({ error: "Missing order details" }, { status: 400 });
  }

  if (merchantId || amountParam) {
    return {
      orderId: orderId || `WOO-${Date.now()}`,
      orderName: orderId ? `Order #${orderId}` : `Order #${Date.now().toString().slice(-6)}`,
      amountPKR: parseFloat(amountParam || "100.00"),
      customerPhone: formatPhoneNumber(url.searchParams.get("mobile") || ""),
      storeName: merchantId || "Zoyas",
      shop: shop,
      returnUrl: returnUrl || "",
    };
  }

  try {
    const session = await prisma.session.findFirst({
      where: {
        isOnline: false,
        ...(shop ? { shop } : {}),
      },
    });

    const requestHost = (url.hostname || request.headers.get("host") || "jazzcash.ultradigital.cc").replace(/^https?:\/\//, "");

    const shopify = new shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecretKey: process.env.SHOPIFY_API_SECRET,
      apiVersion: ApiVersion.July25,
      scopes: process.env.SCOPES?.split(","),
      hostName: requestHost,
      isEmbeddedApp: true,
    });

    let order = null;
    if (session) {
      const client = new shopify.clients.Graphql({
        session: {
          shop: session.shop,
          accessToken: session.accessToken,
        },
      });

      const cleanId = orderId
        .replace("gid://shopify/OrderIdentity/", "")
        .replace("gid://shopify/Order/", "");

      try {
        const response = await client.request(
          `#graphql
          query getOrderDetails($id: ID!) {
            order(id: $id) {
              id
              name
              displayFinancialStatus
              fullyPaid
              phone
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              customer {
                phone
              }
            }
          }`,
          { variables: { id: `gid://shopify/Order/${cleanId}` } }
        );
        order = response.data?.order;
      } catch (e) {
        console.warn("Direct order query failed:", e.message);
      }
    }

    const storeCode = merchantId ? merchantId : sanitizeStoreName(session?.shop || shop);
    const amountPKR = order ? parseFloat(order.totalPriceSet?.shopMoney?.amount || "0") : (parseFloat(amountParam || "100.00"));
    const customerPhone = order ? formatPhoneNumber(order.phone || order.customer?.phone || "") : formatPhoneNumber(url.searchParams.get("mobile") || "");
    const orderName = order ? order.name : `Order #${orderId?.slice(-6)}`;

    return {
      orderId: orderId,
      orderName: orderName,
      amountPKR: amountPKR,
      customerPhone: customerPhone,
      storeName: storeCode,
      shop: session?.shop || shop,
      returnUrl: returnUrl || "",
    };
  } catch (error) {
    console.error("Payment Loader Error:", error);
    return {
      orderId: orderId || `ORD-${Date.now()}`,
      orderName: `Order #${orderId?.slice(-6) || "1001"}`,
      amountPKR: parseFloat(amountParam || "100.00"),
      customerPhone: "",
      storeName: merchantId || "Zoyas",
      shop: shop,
      returnUrl: returnUrl || "",
    };
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const orderId = formData.get("orderId");
  const shop = formData.get("shop");
  const merchantId = formData.get("merchantId") || formData.get("storeName");
  const mobileNo = formatPhoneNumber(formData.get("mobileNo") || "");
  const returnUrl = formData.get("returnUrl");

  if (!isValidPakistaniMobile(mobileNo)) {
    return json({ error: "Invalid mobile number. Please enter a valid 11-digit JazzCash mobile number starting with 03 (e.g. 03001234567)" }, { status: 400 });
  }

  try {
    const storeCode = merchantId ? merchantId : sanitizeStoreName(shop);
    const amountPKR = parseFloat(formData.get("amountPKR") || "0");
    const orderName = formData.get("orderName") || "Order";

    // Forward to Central Gateway API
    const gatewayUrl = "https://api.ultradigital.cc/api/payment";
    const gatewayPayload = {
      merchantId: storeCode,
      subMerchantName: storeCode,
      amountPKR: amountPKR,
      amount: amountPKR,
      mobileNo: mobileNo,
      mobileNumber: mobileNo,
      billRef: orderName,
      billReference: orderName,
      description: `Order ${orderName} at ${storeCode}`,
      returnUrl: returnUrl || `https://api.ultradigital.cc/api/result`
    };

    const gatewayRes = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gatewayPayload),
    });

    const gatewayData = await gatewayRes.json();

    return {
      success: true,
      orderName: orderName,
      amountPKR: amountPKR,
      storeName: storeCode,
      mobileNo: mobileNo,
      returnUrl: returnUrl,
      gatewayResponse: gatewayData,
    };
  } catch (err) {
    console.error("Payment API Error:", err);
    return json({ error: "Failed to initiate JazzCash payment", details: err.message }, { status: 500 });
  }
};

export default function Pay() {
  const initialData = useLoaderData();
  const fetcher = useFetcher();

  const [mobileInput, setMobileInput] = useState(initialData?.customerPhone || "03001234567");
  const [phoneError, setPhoneError] = useState("");
  const [timeLeft, setTimeLeft] = useState(60);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("IDLE");

  const result = fetcher.data;
  const isSubmitted = fetcher.state === "submitting" || !!result;
  const res = result?.gatewayResponse || {};

  useEffect(() => {
    if (result && result.success) {
      const code = String(res.pp_ResponseCode || res.responseCode || "");
      const statusStr = String(res.status || "").toUpperCase();

      if (code === "000" || statusStr === "PAID" || res.success === true) {
        setPaymentStatus("PAID");
      } else if (code === "157" || code === "999" || statusStr === "DECLINED" || statusStr === "FAILED" || statusStr === "CANCELLED") {
        setPaymentStatus("DECLINED");
      } else {
        setPaymentStatus("PENDING");
      }
    }
  }, [result, res]);

  useEffect(() => {
    let timer;
    if (paymentStatus === "PENDING" && timeLeft > 0 && !isTimedOut) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setIsTimedOut(true);
            setPaymentStatus("DECLINED");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [paymentStatus, timeLeft, isTimedOut]);

  useEffect(() => {
    if (paymentStatus === "PAID" && initialData?.returnUrl) {
      const redirectTimer = setTimeout(() => {
        const url = new URL(initialData.returnUrl);
        url.searchParams.set("paid", "true");
        url.searchParams.set("bill_ref", res?.txnRefNo || initialData.orderName || "WOO-PAID");
        window.location.href = url.toString();
      }, 2000);
      return () => clearTimeout(redirectTimer);
    }
  }, [paymentStatus, initialData?.returnUrl, initialData?.orderName, res?.txnRefNo]);

  const handleSubmit = (e) => {
    if (!isValidPakistaniMobile(mobileInput)) {
      e.preventDefault();
      setPhoneError("Please enter a valid 11-digit JazzCash mobile number starting with 03 (e.g. 03001234567)");
      return;
    }
    setPhoneError("");
    setTimeLeft(60);
    setIsTimedOut(false);
    setPaymentStatus("IDLE");
  };

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: "100vw",
      height: "100vh",
      margin: 0,
      padding: 0,
      backgroundColor: "#12150d",
      color: "#ffffff",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
      overflow: "auto",
      zIndex: 999999
    }}>
      <div style={{
        maxWidth: "460px",
        width: "90%",
        backgroundColor: "#1c2217",
        borderRadius: "16px",
        border: "1px solid rgba(192, 236, 0, 0.25)",
        padding: "32px",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
        position: "relative",
        boxSizing: "border-box"
      }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#242b1d",
            padding: "6px 14px",
            borderRadius: "9999px",
            marginBottom: "14px",
            border: "1px solid rgba(192, 236, 0, 0.3)"
          }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#c0ec00", display: "inline-block" }}></span>
            <span style={{ fontSize: "12px", color: "#c0ec00", fontWeight: "700", letterSpacing: "0.5px" }}>
              Gateway Online • 2FA Protected
            </span>
          </div>

          <h2 style={{ fontSize: "24px", fontWeight: "800", margin: "0 0 6px 0", color: "#ffffff" }}>
            Jaazcash Mobile Wallet
          </h2>
          <p style={{ fontSize: "13px", color: "#a3b899", margin: 0, fontWeight: "500" }}>
            Ultra Digital Connect Gateway
          </p>
        </div>

        {/* Order Details Card */}
        <div style={{
          backgroundColor: "#12150d",
          borderRadius: "12px",
          padding: "18px",
          border: "1px solid rgba(192, 236, 0, 0.15)",
          fontSize: "13.5px",
          marginBottom: "24px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ color: "#a3b899" }}>Store Name:</span>
            <strong style={{ color: "#ffffff", fontWeight: "700" }}>{initialData?.storeName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ color: "#a3b899" }}>Order Reference:</span>
            <strong style={{ color: "#ffffff", fontWeight: "700" }}>{initialData?.orderName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", borderTop: "1px solid #242b1d" }}>
            <span style={{ color: "#a3b899" }}>Total Amount:</span>
            <strong style={{ color: "#c0ec00", fontSize: "18px", fontWeight: "800" }}>
              Rs. {initialData?.amountPKR?.toLocaleString()}
            </strong>
          </div>
        </div>

        {paymentStatus === "IDLE" && (
          <fetcher.Form method="post" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <input type="hidden" name="orderId" value={initialData.orderId} />
            <input type="hidden" name="shop" value={initialData.shop} />
            <input type="hidden" name="merchantId" value={initialData.storeName} />
            <input type="hidden" name="orderName" value={initialData.orderName} />
            <input type="hidden" name="amountPKR" value={initialData.amountPKR} />
            <input type="hidden" name="returnUrl" value={initialData.returnUrl} />

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "8px", color: "#ffffff" }}>
                JazzCash Mobile Account Number
              </label>
              <input
                type="tel"
                name="mobileNo"
                value={mobileInput}
                onChange={(e) => {
                  setMobileInput(e.target.value);
                  setPhoneError("");
                }}
                placeholder="03001234567"
                maxLength={11}
                required
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  fontSize: "15px",
                  backgroundColor: "#12150d",
                  border: phoneError ? "1px solid #ef4444" : "1px solid rgba(192, 236, 0, 0.3)",
                  borderRadius: "8px",
                  color: "#ffffff",
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "monospace"
                }}
              />
              {phoneError ? (
                <span style={{ fontSize: "12px", color: "#f87171", marginTop: "6px", display: "block" }}>
                  ⚠️ {phoneError}
                </span>
              ) : (
                <span style={{ fontSize: "11px", color: "#8a9e80", marginTop: "6px", display: "block" }}>
                  Enter your active 11-digit JazzCash registered mobile number.
                </span>
              )}
            </div>

            {fetcher.data?.error && (
              <div style={{ color: "#f87171", fontSize: "12px", backgroundColor: "#450a0a", padding: "10px", borderRadius: "6px", border: "1px solid #7f1d1d" }}>
                ❌ {fetcher.data.error}
              </div>
            )}

            <button
              type="submit"
              disabled={fetcher.state !== "idle"}
              style={{
                backgroundColor: "#c0ec00",
                color: "#000000",
                fontWeight: "800",
                fontSize: "15px",
                padding: "14px 20px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                boxShadow: "0 4px 16px rgba(192, 236, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              {fetcher.state !== "idle" ? (
                "Sending 2FA MPIN Request..."
              ) : (
                <>
                  <span>⚡ Pay Rs. {initialData?.amountPKR?.toLocaleString()} via JazzCash</span>
                </>
              )}
            </button>
          </fetcher.Form>
        )}

        {paymentStatus === "PENDING" && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ position: "relative", width: "72px", height: "72px", margin: "0 auto 16px auto" }}>
              <div style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                border: "4px solid #c0ec00",
                borderTopColor: "transparent",
                animation: "spin 1s linear infinite"
              }}></div>
              <div style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                fontSize: "24px"
              }}>
                📱
              </div>
            </div>

            <h3 style={{ fontSize: "18px", color: "#c0ec00", margin: "0 0 8px 0", fontWeight: "800" }}>
              MPIN Prompt Sent to Mobile Phone!
            </h3>

            <p style={{ fontSize: "13px", color: "#d1d5db", marginBottom: "16px", lineHeight: "1.5" }}>
              Please check mobile screen for <strong style={{ color: "#fff", fontFamily: "monospace" }}>{result?.mobileNo || mobileInput}</strong> or open your <strong>JazzCash App</strong> to authorize payment.
            </p>

            <div style={{
              backgroundColor: "#12150d",
              borderRadius: "12px",
              padding: "16px",
              border: "1px solid rgba(192, 236, 0, 0.2)",
              marginBottom: "20px"
            }}>
              <div style={{ fontSize: "12px", color: "#8a9e80", marginBottom: "4px", fontWeight: "600" }}>
                TIME REMAINING TO AUTHORIZE MPIN:
              </div>
              <div style={{ fontSize: "28px", fontWeight: "800", color: timeLeft <= 10 ? "#ef4444" : "#c0ec00", fontFamily: "monospace" }}>
                00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
              </div>

              <div style={{ width: "100%", height: "6px", backgroundColor: "#242b1d", borderRadius: "3px", marginTop: "10px", overflow: "hidden" }}>
                <div style={{
                  width: `${(timeLeft / 60) * 100}%`,
                  height: "100%",
                  backgroundColor: timeLeft <= 10 ? "#ef4444" : "#c0ec00",
                  transition: "width 1s linear"
                }}></div>
              </div>
            </div>

            <button
              onClick={() => setPaymentStatus("IDLE")}
              style={{
                backgroundColor: "transparent",
                color: "#8a9e80",
                fontSize: "12px",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline"
              }}
            >
              Cancel & Change Mobile Number
            </button>

            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}

        {paymentStatus === "PAID" && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "52px", marginBottom: "12px" }}>✅</div>
            <h3 style={{ fontSize: "22px", color: "#c0ec00", margin: "0 0 8px 0", fontWeight: "800" }}>
              Payment Approved!
            </h3>
            <p style={{ fontSize: "14px", color: "#ffffff", marginBottom: "20px" }}>
              Your MPIN has been verified. Redirecting back to store...
            </p>
            {initialData?.returnUrl && (
              <a
                href={initialData.returnUrl}
                style={{
                  display: "inline-block",
                  padding: "12px 28px",
                  backgroundColor: "#c0ec00",
                  color: "#000000",
                  textDecoration: "none",
                  borderRadius: "8px",
                  fontWeight: "800"
                }}
              >
                Return to Store
              </a>
            )}
          </div>
        )}

        {paymentStatus === "DECLINED" && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "52px", marginBottom: "12px" }}>❌</div>
            <h3 style={{ fontSize: "20px", color: "#f87171", margin: "0 0 8px 0", fontWeight: "800" }}>
              Payment Cancelled / Declined
            </h3>
            <p style={{ fontSize: "13px", color: "#cbd5e1", marginBottom: "20px", lineHeight: "1.5" }}>
              {isTimedOut 
                ? "The 60-second window to enter your MPIN has expired." 
                : "The payment request was rejected or cancelled on your mobile phone."}
            </p>
            <button
              onClick={() => {
                setIsTimedOut(false);
                setTimeLeft(60);
                setPaymentStatus("IDLE");
              }}
              style={{
                backgroundColor: "#c0ec00",
                color: "#000000",
                fontWeight: "800",
                fontSize: "14px",
                padding: "12px 26px",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(192, 236, 0, 0.3)"
              }}
            >
              🔄 Retry Payment
            </button>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "12px", color: "#8a9e80" }}>
          Secured by <strong>Ultra Digital Connect Gateway</strong>
        </div>
      </div>
    </div>
  );
}
