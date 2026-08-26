import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const rawStorage = new PrismaSessionStorage(prisma);

// MongoDB Prisma Session Storage wrapper to handle MongoDB upsert argument compatibility
const mongoPrismaStorage = {
  storeSession: async (session) => {
    try {
      return await rawStorage.storeSession(session);
    } catch (err) {
      if (err.message && (err.message.includes("Unknown argument `id`") || err.message.includes("upsert()"))) {
        const sessObj = typeof session.toPropertyArray === 'function' 
          ? session.toObject() 
          : { ...session };

        const id = session.id;
        const { id: _ignoredId, ...updatePayload } = sessObj;

        // Clean BigInt or incompatible types if any
        if (updatePayload.userId) updatePayload.userId = String(updatePayload.userId);
        if (sessObj.userId) sessObj.userId = String(sessObj.userId);

        await prisma.session.upsert({
          where: { id: id },
          update: updatePayload,
          create: { id: id, ...updatePayload },
        });
        return true;
      }
      throw err;
    }
  },
  loadSession: (id) => rawStorage.loadSession(id),
  deleteSession: (id) => rawStorage.deleteSession(id),
  deleteSessions: (ids) => rawStorage.deleteSessions(ids),
  findSessionsByShop: (shop) => rawStorage.findSessionsByShop(shop),
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: mongoPrismaStorage,
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
