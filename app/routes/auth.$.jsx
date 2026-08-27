import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Post OAuth completion, redirect to the valid app root (/app) inside Shopify Admin
  return redirect(`/app?shop=${encodeURIComponent(session.shop)}`);
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
