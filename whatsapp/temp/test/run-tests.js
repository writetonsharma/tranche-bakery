import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { JsonStore } from "../src/storage/jsonStore.js";
import { handleInboundMessage } from "../src/services/conversation.js";

const config = {
  bakery: {
    name: "TRANCHE Bakery",
    cutoffHour: 18,
    timezone: "Asia/Kolkata",
    upiId: "test@upi",
    upiPayeeName: "TRANCHE Bakery"
  }
};

const tests = [
  ["customer can create an order and upload a payment screenshot", testOrderWithScreenshot]
];

for (const [name, testFn] of tests) {
  try {
    await testFn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function testOrderWithScreenshot() {
  const dir = await mkdtemp(join(tmpdir(), "tranche-whatsapp-test-"));
  const store = new JsonStore(join(dir, "store.json"));
  const whatsapp = {
    sent: [],
    async sendText(to, body) {
      this.sent.push({ to, body });
    }
  };

  try {
    await inbound(store, whatsapp, "hi");
    await inbound(store, whatsapp, "1");
    await inbound(store, whatsapp, "1");
    await inbound(store, whatsapp, "1");
    await inbound(store, whatsapp, "2");
    await inbound(store, whatsapp, "1");
    await inbound(store, whatsapp, "1");
    await handleInboundMessage({
      store,
      whatsapp,
      config,
      message: {
        id: "test-image",
        from: "919999999999",
        type: "image",
        text: "",
        imageId: "wamid.test-screenshot",
        contactName: "Test Customer"
      }
    });

    const data = await store.read();
    assert.equal(data.orders.length, 1);
    assert.equal(data.orders[0].status, "payment_review_required");
    assert.equal(data.paymentScreenshots.length, 1);
    assert.equal(data.paymentScreenshots[0].whatsappMediaId, "wamid.test-screenshot");
    assert.equal(data.whatsappConversations[0].step, "idle");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function inbound(store, whatsapp, text) {
  await handleInboundMessage({
    store,
    whatsapp,
    config,
    message: {
      id: `test-${text}`,
      from: "919999999999",
      type: "text",
      text,
      imageId: null,
      contactName: "Test Customer"
    }
  });
}
