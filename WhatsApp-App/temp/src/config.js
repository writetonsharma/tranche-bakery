export function getConfig() {
  return {
    port: Number(process.env.PORT || 3001),
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3001",
    whatsapp: {
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "dev-verify-token",
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      apiVersion: process.env.WHATSAPP_API_VERSION || "v23.0"
    },
    bakery: {
      name: process.env.BAKERY_NAME || "TRANCHE Bakery",
      phone: process.env.BAKERY_PHONE || "+918800206057",
      cutoffHour: Number(process.env.ORDER_CUTOFF_HOUR || 18),
      timezone: process.env.ORDER_TIMEZONE || "Asia/Kolkata",
      upiId: process.env.UPI_ID || "replace-with-upi-id",
      upiPayeeName: process.env.UPI_PAYEE_NAME || "TRANCHE Bakery"
    },
    dataFile: process.env.DATA_FILE || "./data/dev-store.json"
  };
}
