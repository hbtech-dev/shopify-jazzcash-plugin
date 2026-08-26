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

  const defaultSubName = shop.replace(/\.myshopify\.com$/, '').replace(/[^a-zA-Z]/g, '') || "Cheezious";

  if (!config) {
    config = {
      merchantId: defaultSubName, // Sub-Merchant Name
      password: `udc_live_${defaultSubName.toLowerCase()}_key`, // API Key
      integritySalt: "bt50121s4d",
      merchantMpin: "9163"
    };
  }

  return { config, shop, defaultSubName };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const subMerchantName = formData.get("subMerchantName") || "";
  const apiKey = formData.get("apiKey") || "";

  const config = await prisma.jazzCashConfig.upsert({
    where: { shop },
    update: {
      merchantId: subMerchantName,
      password: apiKey,
      integritySalt: "bt50121s4d",
      merchantMpin: "9163",
    },
    create: {
      shop,
      merchantId: subMerchantName,
      password: apiKey,
      integritySalt: "bt50121s4d",
      merchantMpin: "9163",
    },
  });

  return { success: true, config };
};

export default function Index() {
  const { config, shop, defaultSubName } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Sub-Merchant Gateway Settings Saved!");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Ultra Digital Connect — Sub-Merchant Gateway">
      <s-section heading="Store Sub-Merchant Configuration">
        <s-paragraph>
          Connect your Shopify Store to Ultra Digital Connect Gateway to accept instant JazzCash Mobile Wallet payments & track live store revenue.
        </s-paragraph>
        <fetcher.Form method="post" style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px', marginTop: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#303030' }}>
              Sub-Merchant Store Name / Code
            </label>
            <input
              type="text"
              name="subMerchantName"
              defaultValue={config.merchantId || defaultSubName}
              required
              placeholder="e.g. Cheezious, TehzeebBakers, Savour"
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: '14px',
                border: '1px solid #c9cccf',
                borderRadius: '6px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
            <span style={{ fontSize: '12px', color: '#6d7175', marginTop: '4px', display: 'block' }}>
              This identifies your store on the central Ultra Digital Connect ledger.
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: '#303030' }}>
              Gateway Store API Key
            </label>
            <input
              type="text"
              name="apiKey"
              defaultValue={config.password || `udc_live_${defaultSubName.toLowerCase()}_key`}
              required
              placeholder="udc_live_..."
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: '14px',
                fontFamily: 'monospace',
                border: '1px solid #c9cccf',
                borderRadius: '6px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <s-button type="submit" variant="primary" disabled={isSaving} style={{ marginTop: '8px', alignSelf: 'flex-start' }}>
            {isSaving ? "Connecting Store..." : "✔ Connect Store to Gateway"}
          </s-button>
        </fetcher.Form>
      </s-section>
      
      <s-section slot="aside" heading="Sub-Merchant Portal Status">
        <div style={{ backgroundColor: '#f1f8f5', padding: '16px', borderRadius: '8px', border: '1px solid #cbe9d8', marginBottom: '16px' }}>
          <div style={{ fontWeight: 'bold', color: '#008060', marginBottom: '4px' }}>🔒 Gateway Proxy Active</div>
          <div style={{ fontSize: '12px', color: '#4a4a4a' }}>
            Store Connected: <strong>{shop}</strong><br/>
            Target Gateway: <code>https://api.ultradigital.cc</code>
          </div>
        </div>

        <s-paragraph>
          <strong>Setup Steps:</strong>
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            Set up <strong>Manual Payment Method</strong> in Shopify settings:
            <ol style={{ paddingLeft: '20px', marginTop: '4px', fontSize: '12px' }}>
              <li>Go to <strong>Settings &gt; Payments</strong></li>
              <li>Add custom payment method named: <strong>JazzCash Mobile Wallet</strong></li>
            </ol>
          </s-list-item>
          <s-list-item style={{ marginTop: '8px' }}>
            View live revenue & transactions on your gateway ledger at <strong>https://api.ultradigital.cc/test/123</strong>.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
