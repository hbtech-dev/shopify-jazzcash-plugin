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
  const sanitized = name.replace(/\.myshopify\.com$/, '').replace(/[^a-zA-Z]/g, '');
  return sanitized || "Store";
};

// Validate if prefix belongs to valid Pakistani Mobile Networks (Jazz / Warid / Telenor / Zong / Ufone)
const isValidPakistaniMobile = (number) => {
  const cleaned = formatPhoneNumber(number);
  if (!cleaned || cleaned.length !== 11) return false;
  return /^03[0-9]{9}$/.test(cleaned);
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id");
  const shop = url.searchParams.get("shop") || url.hostname;
  const merchantId = url.searchParams.get("merchant_id");
  const amountParam = url.searchParams.get("amount");
  const returnUrl = url.searchParams.get("return_url");

  if (!orderId && !amountParam) {
    return json({ error: "Missing order details" }, { status: 400 });
  }

  // Handle WooCommerce or Generic Requests directly if merchant_id and amount are passed
  if (merchantId || amountParam) {
    return {
      orderId: orderId || `WOO-${Date.now()}`,
      orderName: orderId ? `Order #${orderId}` : `Order #${Date.now().toString().slice(-6)}`,
      amountPKR: parseFloat(amountParam || "100.00"),
      customerPhone: formatPhoneNumber(url.searchParams.get("mobile") || ""),
      storeName: merchantId || "WooCommerce Store",
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
        console.warn("Direct order query failed, fallback to parameters:", e.message);
      }
    }

    const storeCode = sanitizeStoreName(session?.shop || shop);
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
      storeName: "Sub-Merchant Store",
      shop: shop,
      returnUrl: returnUrl || "",
    };
  }
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const orderId = formData.get("orderId");
  const shop = formData.get("shop");
  const mobileNo = formatPhoneNumber(formData.get("mobileNo") || "");
  const returnUrl = formData.get("returnUrl");

  if (!isValidPakistaniMobile(mobileNo)) {
    return json({ error: "Invalid mobile number. Please enter a valid 11-digit JazzCash mobile number starting with 03 (e.g. 03001234567)" }, { status: 400 });
  }

  try {
    const storeCode = sanitizeStoreName(shop);
    const amountPKR = parseFloat(formData.get("amountPKR") || "0");
    const orderName = formData.get("orderName") || "Order";

    // Call Ultra Digital Connect Central Gateway
    const gatewayUrl = "https://api.ultradigital.cc/api/payment";
    const gatewayPayload = {
      subMerchantName: storeCode,
      amountPKR: amountPKR,
      mobileNo: mobileNo,
      billRef: orderName,
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

  const result = fetcher.data;
  const isSubmitted = !!result && result.success;
  const res = result?.gatewayResponse || {};
  const isSuccess = res.pp_ResponseCode === '000' || res.responseCode === '000' || res.success === true;

  // 60-Second Countdown Timer Effect
  useEffect(() => {
    let timer;
    if (isSubmitted && !isSuccess && timeLeft > 0 && !isTimedOut) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setIsTimedOut(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isSubmitted, isSuccess, timeLeft, isTimedOut]);

  // Handle Form Submission Validation
  const handleSubmit = (e) => {
    if (!isValidPakistaniMobile(mobileInput)) {
      e.preventDefault();
      setPhoneError("Please enter a valid 11-digit JazzCash mobile number starting with 03 (e.g. 03001234567)");
      return;
    }
    setPhoneError("");
    setTimeLeft(60);
    setIsTimedOut(false);
  };

  // Redirect to Return URL when Payment Completes
  useEffect(() => {
    if (isSuccess && initialData?.returnUrl) {
      const redirectTimer = setTimeout(() => {
        window.location.href = initialData.returnUrl;
      }, 2500);
      return () => clearTimeout(redirectTimer);
    }
  }, [isSuccess, initialData?.returnUrl]);

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
        maxWidth: "460px",
        width: "100%",
        backgroundColor: "#111827",
        borderRadius: "16px",
        border: "1px solid #1f2937",
        padding: "32px",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)",
        position: "relative"
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
            marginBottom: "12px",
            boxShadow: "0 8px 16px rgba(239, 68, 68, 0.4)"
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
            <span style={{ color: "#9ca3af" }}>Store Name:</span>
            <strong style={{ color: "#38bdf8" }}>{initialData?.storeName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={{ color: "#9ca3af" }}>Order Reference:</span>
            <strong style={{ color: "#ffffff" }}>{initialData?.orderName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#9ca3af" }}>Total Amount:</span>
            <strong style={{ color: "#10b981", fontSize: "16px" }}>Rs. {initialData?.amountPKR?.toLocaleString()}</strong>
          </div>
        </div>

        {!isSubmitted ? (
          /* Step 1 & 2: Mobile Number Form & Validation */
          <fetcher.Form method="post" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <input type="hidden" name="orderId" value={initialData.orderId} />
            <input type="hidden" name="shop" value={initialData.shop} />
            <input type="hidden" name="orderName" value={initialData.orderName} />
            <input type="hidden" name="amountPKR" value={initialData.amountPKR} />
            <input type="hidden" name="returnUrl" value={initialData.returnUrl} />

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "8px", color: "#d1d5db" }}>
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
                  backgroundColor: "#1f2937",
                  border: phoneError ? "1px solid #ef4444" : "1px solid #374151",
                  borderRadius: "8px",
                  color: "#ffffff",
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "monospace"
                }}
              />
              {phoneError ? (
                <span style={{ fontSize: "12px", color: "#ef4444", marginTop: "6px", display: "block" }}>
                  ⚠️ {phoneError}
                </span>
              ) : (
                <span style={{ fontSize: "11px", color: "#6b7280", marginTop: "6px", display: "block" }}>
                  Enter your active 11-digit JazzCash registered mobile number.
                </span>
              )}
            </div>

            {fetcher.data?.error && (
              <div style={{ color: "#ef4444", fontSize: "12px", backgroundColor: "#450a0a", padding: "10px", borderRadius: "6px" }}>
                ❌ {fetcher.data.error}
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
                transition: "all 0.2s ease",
                boxShadow: "0 4px 12px rgba(220, 38, 38, 0.4)"
              }}
            >
              {fetcher.state !== "idle" ? "Checking JazzCash Account..." : `Pay Rs. ${initialData?.amountPKR?.toLocaleString()} via JazzCash`}
            </button>
          </fetcher.Form>
        ) : (
          /* Step 3, 4, 5: 60-Second Interactive MPIN Modal & Timeout */
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            {isSuccess ? (
              /* Success State */
              <div>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>✅</div>
                <h3 style={{ fontSize: "20px", color: "#34d399", margin: "0 0 8px 0" }}>
                  Payment Approved!
                </h3>
                <p style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "20px" }}>
                  Transaction complete. Redirecting you back to store...
                </p>
                {initialData?.returnUrl && (
                  <a
                    href={initialData.returnUrl}
                    style={{
                      display: "inline-block",
                      padding: "10px 24px",
                      backgroundColor: "#10b981",
                      color: "#fff",
                      textDecoration: "none",
                      borderRadius: "8px",
                      fontWeight: "600"
                    }}
                  >
                    Return to Store
                  </a>
                )}
              </div>
            ) : isTimedOut ? (
              /* 60-Second Timeout State */
              <div>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>⏰</div>
                <h3 style={{ fontSize: "20px", color: "#f87171", margin: "0 0 8px 0" }}>
                  Payment Timed Out (1 min)
                </h3>
                <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "20px", lineHeight: "1.5" }}>
                  You did not enter your 5-digit JazzCash MPIN on your mobile phone within 60 seconds. The payment request was cancelled.
                </p>
                <button
                  onClick={() => {
                    setIsTimedOut(false);
                    setTimeLeft(60);
                    window.location.reload();
                  }}
                  style={{
                    backgroundColor: "#dc2626",
                    color: "#ffffff",
                    fontWeight: "600",
                    fontSize: "14px",
                    padding: "10px 20px",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer"
                  }}
                >
                  🔄 Retry Payment
                </button>
              </div>
            ) : (
              /* Live Waiting Modal with 60-Second Timer */
              <div>
                <div style={{ position: "relative", width: "72px", height: "72px", margin: "0 auto 16px auto" }}>
                  <div style={{
                    width: "72px",
                    height: "72px",
                    borderRadius: "50%",
                    border: "4px solid #ef4444",
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

                <h3 style={{ fontSize: "18px", color: "#fbbf24", margin: "0 0 8px 0" }}>
                  MPIN Prompt Sent to Mobile Phone!
                </h3>

                <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "16px", lineHeight: "1.5" }}>
                  Please check screen on <strong style={{ color: "#fff", fontFamily: "monospace" }}>{result.mobileNo}</strong> or open your <strong>JazzCash App</strong> to approve payment.
                </p>

                {/* Live Countdown Timer Circle */}
                <div style={{
                  backgroundColor: "#030712",
                  borderRadius: "12px",
                  padding: "16px",
                  border: "1px solid #1f2937",
                  marginBottom: "20px"
                }}>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px" }}>
                    TIME REMAINING TO AUTHORIZE MPIN:
                  </div>
                  <div style={{ fontSize: "28px", fontWeight: "800", color: timeLeft <= 10 ? "#ef4444" : "#10b981", fontFamily: "monospace" }}>
                    00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
                  </div>

                  {/* Progress Bar */}
                  <div style={{ width: "100%", height: "6px", backgroundColor: "#1f2937", borderRadius: "3px", marginTop: "10px", overflow: "hidden" }}>
                    <div style={{
                      width: `${(timeLeft / 60) * 100}%`,
                      height: "100%",
                      backgroundColor: timeLeft <= 10 ? "#ef4444" : "#10b981",
                      transition: "width 1s linear"
                    }}></div>
                  </div>
                </div>

                <style>{`
                  @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                  }
                `}</style>
              </div>
            )}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: "24px", fontSize: "11px", color: "#4b5563" }}>
          Secured by <strong>Ultra Digital Connect Gateway</strong>
        </div>
      </div>
    </div>
  );
}
