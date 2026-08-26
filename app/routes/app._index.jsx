import { useEffect } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let config = await prisma.jazzCashConfig.findUnique({
    where: { shop },
  });

  if (!config) {
    config = {
      merchantId: "",
      password: "",
      integritySalt: "",
      merchantMpin: ""
    };
  }

  return { config };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const merchantId = formData.get("merchantId") || "";
  const password = formData.get("password") || "";
  const integritySalt = formData.get("integritySalt") || "";
  const merchantMpin = formData.get("merchantMpin") || "";

  const config = await prisma.jazzCashConfig.upsert({
    where: { shop },
    update: {
      merchantId,
      password,
      integritySalt,
      merchantMpin,
    },
    create: {
      shop,
      merchantId,
      password,
      integritySalt,
      merchantMpin,
    },
  });

  return { success: true, config };
};

export default function Index() {
  const { config } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Credentials saved successfully");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="JazzCash Payment Integration">
      <s-section heading="Merchant Credentials">
        <s-paragraph>
          Configure your JazzCash Merchant details below to enable Mobile Wallet payments on your store.
        </s-paragraph>
        <fetcher.Form method="post" style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px', marginTop: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#303030' }}>
              Merchant ID
            </label>
            <input
              type="text"
              name="merchantId"
              defaultValue={config.merchantId}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#303030' }}>
              Password
            </label>
            <input
              type="password"
              name="password"
              defaultValue={config.password}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#303030' }}>
              Integrity Salt
            </label>
            <input
              type="password"
              name="integritySalt"
              defaultValue={config.integritySalt}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#303030' }}>
              Merchant MPIN (For Refunds)
            </label>
            <input
              type="password"
              name="merchantMpin"
              defaultValue={config.merchantMpin}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <s-button type="submit" variant="primary" disabled={isSaving} style={{ marginTop: '8px', alignSelf: 'flex-start' }}>
            {isSaving ? "Saving..." : "Save Credentials"}
          </s-button>
        </fetcher.Form>
      </s-section>
      
      <s-section slot="aside" heading="Instructions">
        <s-paragraph>
          To complete your JazzCash Mobile Wallet payment integration:
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            Set up a <strong>Manual Payment Method</strong> in Shopify settings:
            <ol style={{ paddingLeft: '20px', marginTop: '4px', fontSize: '13px' }}>
              <li>Go to <strong>Settings &gt; Payments</strong> in your Shopify Admin</li>
              <li>Scroll down to <strong>Manual payment methods</strong> and click <strong>Add manual payment method</strong></li>
              <li>Choose <strong>Create custom payment method</strong></li>
              <li>Name it exactly: <strong>JazzCash Mobile Wallet</strong></li>
              <li>Set payment instructions for the customer (e.g. <em>"Complete your payment using your JazzCash Mobile Wallet account"</em>)</li>
            </ol>
          </s-list-item>
          <s-list-item style={{ marginTop: '8px' }}>
            Ensure you have added the <strong>JazzCash Thank You UI Block</strong> inside the Checkout Editor.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("app._index.jsx ErrorBoundary:", error);
  return (
    <div style={{ padding: "30px", fontFamily: "system-ui, sans-serif", backgroundColor: "#fff", color: "#333" }}>
      <h2 style={{ color: "#d32f2f" }}>Index Application Diagnostic Details</h2>
      <p style={{ color: "#666" }}>{error?.message || "An error occurred while loading JazzCash app index."}</p>
      <pre style={{ background: "#f5f5f5", padding: "14px", overflow: "auto", fontSize: "12px" }}>
        {error?.stack || JSON.stringify(error, null, 2)}
      </pre>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
