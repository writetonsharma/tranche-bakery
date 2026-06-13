export function verifyWebhook(query, verifyToken) {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return { ok: true, challenge };
  }

  return { ok: false };
}

export function extractMessages(payload) {
  const messages = [];
  const entries = payload?.entry || [];

  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contactsByWaId = new Map((value.contacts || []).map((contact) => [contact.wa_id, contact]));

      for (const message of value.messages || []) {
        messages.push({
          id: message.id,
          from: message.from,
          timestamp: message.timestamp,
          type: message.type,
          text: message.text?.body || "",
          imageId: message.image?.id || null,
          contactName: contactsByWaId.get(message.from)?.profile?.name || ""
        });
      }
    }
  }

  return messages;
}
