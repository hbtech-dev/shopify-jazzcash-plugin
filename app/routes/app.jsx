import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  console.error("app.jsx ErrorBoundary:", error);
  return (
    <div style={{ padding: "30px", fontFamily: "system-ui, sans-serif", backgroundColor: "#fff", color: "#333" }}>
      <h2 style={{ color: "#d32f2f" }}>Application Diagnostic Details</h2>
      <p style={{ color: "#666" }}>{error?.message || "An error occurred while authenticating with Shopify."}</p>
      <pre style={{ background: "#f5f5f5", padding: "14px", overflow: "auto", fontSize: "12px" }}>
        {error?.stack || JSON.stringify(error, null, 2)}
      </pre>
    </div>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
