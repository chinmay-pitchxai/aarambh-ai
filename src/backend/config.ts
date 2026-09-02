import { parseServerConfig } from "./config-schema";

export { parseServerConfig } from "./config-schema";

export const serverConfig = parseServerConfig(process.env);

export function requireVobizConfig() {
  const { apiKey, fromNumber, apiUrl } = serverConfig.vobiz;
  if (!apiKey || !fromNumber) throw new Error("Vobiz is not configured: VOBIZ_API_KEY and VOBIZ_FROM_NUMBER are required");
  return { apiKey, fromNumber, apiUrl, webhookUrl: `${serverConfig.appUrl}/api/webhooks/vobiz` };
}
