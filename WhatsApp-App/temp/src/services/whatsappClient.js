export class WhatsAppClient {
  constructor(config) {
    this.config = config;
  }

  async sendText(to, body) {
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      console.log(`[dev whatsapp] -> ${to}: ${body}`);
      return { dev: true };
    }

    const url = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp send failed: ${response.status} ${errorBody}`);
    }

    return response.json();
  }
}
