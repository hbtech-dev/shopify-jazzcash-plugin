import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    const result = await authenticate.admin(request);
    if (result?.session) {
      const shopHandle = result.session.shop.replace(".myshopify.com", "");
      const apiKey = process.env.SHOPIFY_API_KEY;
      return redirect(`https://admin.shopify.com/store/${shopHandle}/apps/${apiKey}`);
    }
  } catch (errOrResponse) {
    // Catch thrown redirect Response from Shopify OAuth SDK
    if (errOrResponse instanceof Response || (errOrResponse && errOrResponse.status >= 300 && errOrResponse.status < 400)) {
      const location = errOrResponse.headers?.get("Location") || "";
      // Fix trailing /auth in Shopify Admin embedded iframe redirect
      if (location.endsWith("/auth") || location.includes("/apps/") && location.endsWith("/auth")) {
        const cleanLocation = location.replace(/\/auth$/, "");
        return redirect(cleanLocation, { headers: errOrResponse.headers });
      }
    }
    throw errOrResponse;
  }
  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
