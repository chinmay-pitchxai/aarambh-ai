import { parseServerConfig } from "./config-schema";

export { parseServerConfig } from "./config-schema";

export const serverConfig = parseServerConfig(process.env);

export function requireVobizConfig() {
  const { authId, authToken, fromNumber, apiUrl } = serverConfig.vobiz;
  if (!authId || !authToken) {
    throw new Error(
      "Vobiz is not configured: set VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN from the Vobiz Console (https://console.vobiz.ai).",
    );
  }
  if (!fromNumber) {
    throw new Error("Vobiz is not configured: VOBIZ_FROM_NUMBER (your provisioned caller-ID number) is required.");
  }
  return { authId, authToken, fromNumber, apiUrl, webhookUrl: `${serverConfig.appUrl}/api/webhooks/vobiz` };
}
