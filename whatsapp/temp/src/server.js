import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { getConfig } from "./config.js";
import { JsonStore } from "./storage/jsonStore.js";
import { WhatsAppClient } from "./services/whatsappClient.js";
import { extractMessages, verifyWebhook } from "./services/metaWebhook.js";
import { handleInboundMessage } from "./services/conversation.js";

const config = getConfig();
const store = new JsonStore(config.dataFile);
const whatsapp = new WhatsAppClient(config.whatsapp);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, config.appBaseUrl);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/webhooks/whatsapp") {
      const verification = verifyWebhook(url.searchParams, config.whatsapp.verifyToken);
      if (!verification.ok) return sendText(response, 403, "Forbidden");
      return sendText(response, 200, verification.challenge);
    }

    if (request.method === "POST" && url.pathname === "/webhooks/whatsapp") {
      const payload = await readJsonBody(request);
      const messages = extractMessages(payload);

      for (const message of messages) {
        await handleInboundMessage({ store, whatsapp, config, message });
      }

      return sendJson(response, 200, { received: true });
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      const data = await store.read();
      return sendHtml(response, 200, renderAdmin(data));
    }

    if (request.method === "POST" && url.pathname.startsWith("/admin/orders/")) {
      const [, , orderId, action] = url.pathname.split("/");
      await updateOrderStatus(orderId, action);
      response.writeHead(303, { Location: "/admin" });
      return response.end();
    }

    if (request.method === "POST" && url.pathname === "/dev/inbound") {
      const message = await readJsonBody(request);
      await handleInboundMessage({
        store,
        whatsapp,
        config,
        message: {
          id: message.id || `dev-${Date.now()}`,
          from: message.from || "919999999999",
          type: message.type || "text",
          text: message.text || "",
          imageId: message.imageId || null,
          contactName: message.contactName || "Dev Customer"
        }
      });
      return sendJson(response, 200, { ok: true });
    }

    return sendText(response, 404, "Not found");
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(config.port, () => {
  console.log(`TRANCHE WhatsApp app listening on http://localhost:${config.port}`);
});

async function updateOrderStatus(orderId, action) {
  await store.update((data) => {
    const order = data.orders.find((candidate) => candidate.id === orderId);
    if (!order) return;

    if (action === "approve-payment") {
      order.status = "confirmed";
      const payment = data.payments.find((candidate) => candidate.orderId === order.id);
      if (payment) payment.status = "screenshot_verified";
    }

    if (action === "complete") {
      order.status = "completed";
    }

    if (action === "cancel") {
      order.status = "cancelled";
    }

    order.updatedAt = new Date().toISOString();
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "text/plain" });
  response.end(payload);
}

function sendHtml(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(payload);
}

function renderAdmin(data) {
  const reviewOrders = data.orders.filter((order) => order.status === "payment_review_required");
  const confirmedOrders = data.orders.filter((order) => order.status === "confirmed");
  const draftCount = data.orders.filter((order) => order.status === "pending_payment_screenshot").length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TRANCHE Orders Admin</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f7f3ec; color: #231f1a; }
    header { padding: 24px; background: #231f1a; color: #fff; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .metric, section { background: #fff; border: 1px solid #e0d8cc; border-radius: 8px; padding: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e7dfd4; padding: 10px; text-align: left; vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #70675d; }
    button { border: 0; border-radius: 6px; padding: 8px 10px; background: #4b3327; color: #fff; cursor: pointer; }
    form { display: inline; }
    .muted { color: #70675d; }
  </style>
</head>
<body>
  <header>
    <h1>TRANCHE Orders Admin</h1>
    <p class="muted">Internal MVP view</p>
  </header>
  <main>
    <div class="metrics">
      <div class="metric"><strong>${reviewOrders.length}</strong><br>Need payment review</div>
      <div class="metric"><strong>${confirmedOrders.length}</strong><br>Confirmed</div>
      <div class="metric"><strong>${draftCount}</strong><br>Awaiting screenshot</div>
    </div>
    <section>
      <h2>Orders Needing Payment Review</h2>
      ${renderOrdersTable(reviewOrders, true)}
    </section>
    <section>
      <h2>Confirmed Orders</h2>
      ${renderOrdersTable(confirmedOrders, false)}
    </section>
  </main>
</body>
</html>`;
}

function renderOrdersTable(orders, reviewActions) {
  if (!orders.length) return "<p>No orders here yet.</p>";

  return `<table>
    <thead>
      <tr>
        <th>Created</th>
        <th>Phone</th>
        <th>Items</th>
        <th>Fulfillment</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${orders.map((order) => `<tr>
        <td>${escapeHtml(new Date(order.createdAt).toLocaleString())}</td>
        <td>${escapeHtml(order.phone)}</td>
        <td>${escapeHtml(order.items.map((item) => `${item.quantity} x ${item.name}`).join(", "))}</td>
        <td>${escapeHtml(order.fulfillmentType || "")}</td>
        <td>${escapeHtml(order.status)}</td>
        <td>${renderOrderActions(order, reviewActions)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function renderOrderActions(order, reviewActions) {
  const approve = reviewActions ? `<form method="post" action="/admin/orders/${order.id}/approve-payment"><button>Approve</button></form>` : "";
  const complete = `<form method="post" action="/admin/orders/${order.id}/complete"><button>Complete</button></form>`;
  const cancel = `<form method="post" action="/admin/orders/${order.id}/cancel"><button>Cancel</button></form>`;
  return `${approve} ${complete} ${cancel}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
