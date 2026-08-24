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
        // Fetch status relative to the current store domain (routes through Shopify App Proxy)
        const response = await fetch(
          `/apps/jazzcash/order-status?order_id=${encodeURIComponent(orderId)}&shop=${shopDomain}`
        );
        if (response.ok) {
          const data = await response.json();
          setPaymentStatus(data);
        } else {
          console.error("Failed to fetch payment status from app proxy");
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
      <s-banner heading="JazzCash Mobile Wallet">
        <s-stack gap="base">
          <s-text>Verifying payment status...</s-text>
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

  // If order is not paid and should show the payment button
  if (paymentStatus?.showPaymentButton && paymentStatus?.checkoutUrl) {
    return (
      <s-banner heading="JazzCash Payment Pending" tone="critical">
        <s-stack gap="base">
          <s-text>
            Your order is created, but payment is pending. Please click the button below to complete your payment using JazzCash Mobile Wallet.
          </s-text>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" href={paymentStatus.checkoutUrl}>
              Pay Now with JazzCash
            </s-button>
          </s-stack>
        </s-stack>
      </s-banner>
    );
  }

  // Otherwise, don't render anything (e.g. if the payment method wasn't JazzCash)
  return null;
}