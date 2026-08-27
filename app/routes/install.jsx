import { useState } from "react";

export default function Install() {
  const [shop, setShop] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!shop.trim()) {
      setError("Please enter your Shopify store domain");
      return;
    }

    let cleaned = shop.trim().toLowerCase();
    cleaned = cleaned.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!cleaned.includes(".")) {
      cleaned = `${cleaned}.myshopify.com`;
    }

    const targetUrl = `${window.location.origin}/auth?shop=${encodeURIComponent(cleaned)}`;
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = targetUrl;
      } else {
        window.location.href = targetUrl;
      }
    } catch (e) {
      window.location.href = targetUrl;
    }
  };

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "#090d16",
        color: "#ffffff",
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "460px",
          width: "100%",
          backgroundColor: "#111827",
          borderRadius: "16px",
          border: "1px solid #1f2937",
          padding: "36px",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.8)",
          textAlign: "center",
        }}
      >
        {/* Logo / Badge */}
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "16px",
            backgroundColor: "#ef4444",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "28px",
            fontWeight: "bold",
            color: "#fff",
            marginBottom: "16px",
            boxShadow: "0 10px 25px -5px rgba(239, 68, 68, 0.4)",
          }}
        >
          JC
        </div>

        <h1
          style={{
            fontSize: "22px",
            fontWeight: "700",
            margin: "0 0 6px 0",
            color: "#ffffff",
          }}
        >
          Install JazzCash Plugin
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: "#9ca3af",
            margin: "0 0 28px 0",
            lineHeight: "1.4",
          }}
        >
          Accept direct <strong>JazzCash Mobile Wallet</strong> payments on your Shopify store via <strong>Ultra Digital Connect</strong>.
        </p>

        <form onSubmit={handleSubmit} style={{ textAlign: "left" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: "600",
              marginBottom: "8px",
              color: "#d1d5db",
            }}
          >
            Your Shopify Store Domain
          </label>

          <input
            type="text"
            value={shop}
            onChange={(e) => {
              setShop(e.target.value);
              setError("");
            }}
            placeholder="my-store.myshopify.com"
            required
            style={{
              width: "100%",
              padding: "14px 16px",
              fontSize: "15px",
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "10px",
              color: "#ffffff",
              outline: "none",
              boxSizing: "border-box",
              marginBottom: "8px",
            }}
          />

          {error && (
            <div
              style={{
                color: "#ef4444",
                fontSize: "12px",
                marginBottom: "12px",
              }}
            >
              {error}
            </div>
          )}

          <p
            style={{
              fontSize: "11px",
              color: "#6b7280",
              margin: "0 0 20px 0",
            }}
          >
            Enter your <code>.myshopify.com</code> store URL to begin installation.
          </p>

          <button
            type="submit"
            style={{
              width: "100%",
              backgroundColor: "#dc2626",
              color: "#ffffff",
              fontWeight: "700",
              fontSize: "16px",
              padding: "14px",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: "0 4px 14px 0 rgba(220, 38, 38, 0.4)",
            }}
          >
            🚀 Install App on Store
          </button>
        </form>

        <div
          style={{
            marginTop: "28px",
            paddingTop: "20px",
            borderTop: "1px solid #1f2937",
            fontSize: "11px",
            color: "#6b7280",
          }}
        >
          Powered by <strong>Ultra Digital Connect Gateway</strong>
        </div>
      </div>
    </div>
  );
}
