import '@shopify/ui-extensions/preact';
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

// 1. Export the extension
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [loading, setLoading] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState(null);

  // Get order confirmation details and shop domain from global shopify object
  // @ts-ignore
  const orderId = shopify.orderConfirmation?.value?.order?.id;
  // @ts-ignore
  const shopDomain = shopify.shop?.myshopifyDomain;

  useEffect(() => {
    if (!orderId || !shopDomain) {
      setLoading(false);
      return;
    }

    const fetchPaymentStatus = async () => {
      try {
        const response = await fetch(
          `/apps/jazzcash/order-status?order_id=${encodeURIComponent(orderId)}&shop=${shopDomain}`
        );
        if (response.ok) {
          const data = await response.json();
          setPaymentStatus(data);

          // Safely redirect if supported in browser environment
          if (data?.showPaymentButton && data?.checkoutUrl) {
            try {
              if (typeof window !== "undefined" && window?.location) {
                window.location.href = data.checkoutUrl;
              }
            } catch (e) {
              console.log("Safe redirect fallback triggered");
            }
          }
        }
      } catch (err) {
        console.error("Error fetching payment status:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchPaymentStatus();
  }, [orderId, shopDomain]);

  if (loading) {
    return (
      <s-banner heading="JazzCash Mobile Wallet" tone="info">
        <s-stack gap="base">
          <s-text>Checking payment status...</s-text>
        </s-stack>
      </s-banner>
    );
  }

  // If order is paid, show a success banner
  if (paymentStatus?.paid) {
    return (
      <s-banner heading="Payment Successful" tone="success">
        <s-stack gap="base">
          <s-text>
            Thank you! Your payment has been received and verified via JazzCash Mobile Wallet.
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  // If order is not paid, show prominent payment banner with direct action button
  if (paymentStatus?.showPaymentButton && paymentStatus?.checkoutUrl) {
    return (
      <s-banner heading="JazzCash Payment Pending" tone="critical">
        <s-stack gap="base">
          <s-text>
            Your order has been created. Click the button below to complete your payment using JazzCash Mobile Wallet.
          </s-text>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" href={paymentStatus.checkoutUrl}>
              👉 Pay Now with JazzCash
            </s-button>
          </s-stack>
        </s-stack>
      </s-banner>
    );
  }

  return null;
}