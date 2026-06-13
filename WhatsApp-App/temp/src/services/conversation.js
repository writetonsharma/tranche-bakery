import { newId } from "../utils/ids.js";
import { nowIso, isAfterCutoff } from "../utils/time.js";

const MAIN_MENU = `Welcome to TRANCHE Bakery.

Reply with a number:
1. Order
2. Feedback
3. Hours
4. Location
5. Start over`;

export async function handleInboundMessage({ store, whatsapp, config, message }) {
  const text = normalize(message.text);

  return store.update(async (data) => {
    const customer = upsertCustomer(data, message);
    let conversation = getOrCreateConversation(data, customer.id, message.from);

    if (text === "5" || text === "start over" || text === "restart") {
      conversation = resetConversation(conversation);
      await whatsapp.sendText(message.from, MAIN_MENU);
      return;
    }

    if (conversation.step === "idle") {
      if (!startsWithHi(text)) return;
      conversation.step = "main_menu";
      conversation.updatedAt = nowIso();
      await whatsapp.sendText(message.from, MAIN_MENU);
      return;
    }

    await routeByStep({ data, customer, conversation, message, text, whatsapp, config });
  });
}

async function routeByStep(context) {
  const { conversation, text } = context;

  if (conversation.step === "main_menu") return handleMainMenu(context);
  if (conversation.step === "feedback") return handleFeedback(context);
  if (conversation.step === "choose_category") return handleCategory(context);
  if (conversation.step === "choose_item") return handleItem(context);
  if (conversation.step === "choose_quantity") return handleQuantity(context);
  if (conversation.step === "fulfillment") return handleFulfillment(context);
  if (conversation.step === "cutoff_warning") return handleCutoffWarning(context);
  if (conversation.step === "confirm_order") return handleOrderConfirmation(context);
  if (conversation.step === "payment_screenshot") return handlePaymentScreenshot(context);

  conversation.step = "main_menu";
  await context.whatsapp.sendText(context.message.from, MAIN_MENU);
}

async function handleMainMenu({ data, customer, conversation, message, text, whatsapp, config }) {
  if (text === "1" || text === "order") {
    conversation.step = "choose_category";
    conversation.draft = { items: [] };
    conversation.updatedAt = nowIso();
    await whatsapp.sendText(message.from, formatCategories(data));
    return;
  }

  if (text === "2" || text === "feedback") {
    conversation.step = "feedback";
    conversation.updatedAt = nowIso();
    await whatsapp.sendText(message.from, "Please type your feedback in one message.");
    return;
  }

  if (text === "3" || text === "hours") {
    await whatsapp.sendText(message.from, `Orders confirmed by ${formatCutoff(config.bakery.cutoffHour)} are usually baked for next-morning delivery.`);
    return;
  }

  if (text === "4" || text === "location") {
    await whatsapp.sendText(message.from, `${config.bakery.name} is a small-batch bakery from Gurgaon. Pickup/delivery details can be confirmed during ordering.`);
    return;
  }

  await whatsapp.sendText(message.from, MAIN_MENU);
}

async function handleFeedback({ data, customer, conversation, message, whatsapp }) {
  data.feedback.push({
    id: newId("feedback"),
    customerId: customer.id,
    phone: message.from,
    body: message.text.trim(),
    createdAt: nowIso()
  });
  resetConversation(conversation);
  await whatsapp.sendText(message.from, "Thank you for your feedback. We will get back to you if needed.");
}

async function handleCategory({ data, conversation, message, text, whatsapp }) {
  const categories = activeCategories(data);
  const selected = resolveOption(categories, text);

  if (!selected) {
    await whatsapp.sendText(message.from, formatCategories(data));
    return;
  }

  conversation.draft.categoryId = selected.id;
  conversation.step = "choose_item";
  conversation.updatedAt = nowIso();
  await whatsapp.sendText(message.from, formatItems(data, selected.id));
}

async function handleItem({ data, conversation, message, text, whatsapp }) {
  const items = activeItems(data).filter((item) => item.categoryId === conversation.draft.categoryId);
  const selected = resolveOption(items, text);

  if (!selected) {
    await whatsapp.sendText(message.from, formatItems(data, conversation.draft.categoryId));
    return;
  }

  conversation.draft.itemId = selected.id;
  conversation.step = "choose_quantity";
  conversation.updatedAt = nowIso();
  await whatsapp.sendText(message.from, `How many ${selected.unit === "piece" ? "pieces" : selected.unit + "s"} would you like? Reply with a number.`);
}

async function handleQuantity({ data, conversation, message, text, whatsapp }) {
  const quantity = Number.parseInt(text, 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    await whatsapp.sendText(message.from, "Please reply with a quantity from 1 to 20.");
    return;
  }

  conversation.draft.quantity = quantity;
  conversation.step = "fulfillment";
  conversation.updatedAt = nowIso();
  await whatsapp.sendText(message.from, "Pickup or delivery?\n1. Pickup\n2. Delivery");
}

async function handleFulfillment({ data, conversation, message, text, whatsapp, config }) {
  if (text !== "1" && text !== "2" && text !== "pickup" && text !== "delivery") {
    await whatsapp.sendText(message.from, "Reply 1 for pickup or 2 for delivery.");
    return;
  }

  conversation.draft.fulfillmentType = text === "1" || text === "pickup" ? "pickup" : "delivery";
  conversation.updatedAt = nowIso();

  if (isAfterCutoff(new Date(), config.bakery.cutoffHour, config.bakery.timezone)) {
    conversation.step = "cutoff_warning";
    await whatsapp.sendText(message.from, `Orders after ${formatCutoff(config.bakery.cutoffHour)} will be prepared for the next available bake day. Do you want to continue?\n1. Continue\n2. Cancel`);
    return;
  }

  conversation.step = "confirm_order";
  await whatsapp.sendText(message.from, formatOrderSummary(data, conversation.draft));
}

async function handleCutoffWarning({ data, conversation, message, text, whatsapp }) {
  if (text === "1" || text === "continue" || text === "yes") {
    conversation.step = "confirm_order";
    conversation.draft.afterCutoffAccepted = true;
    conversation.updatedAt = nowIso();
    await whatsapp.sendText(message.from, formatOrderSummary(data, conversation.draft));
    return;
  }

  if (text === "2" || text === "cancel" || text === "no") {
    resetConversation(conversation);
    await whatsapp.sendText(message.from, "No problem. Your order was cancelled.");
    return;
  }

  await whatsapp.sendText(message.from, "Reply 1 to continue or 2 to cancel.");
}

async function handleOrderConfirmation({ data, customer, conversation, message, text, whatsapp, config }) {
  if (text !== "1" && text !== "confirm" && text !== "yes") {
    resetConversation(conversation);
    await whatsapp.sendText(message.from, "No problem. Your order was cancelled.");
    return;
  }

  const order = createOrder(data, customer, conversation.draft);
  const payment = {
    id: newId("payment"),
    orderId: order.id,
    method: "upi_screenshot",
    status: "pending_payment_screenshot",
    amountPaise: order.totalPaise,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  data.payments.push(payment);

  conversation.step = "payment_screenshot";
  conversation.orderId = order.id;
  conversation.updatedAt = nowIso();

  const amount = formatMoney(order.totalPaise);
  await whatsapp.sendText(message.from, `Please pay ${amount} by UPI and upload the payment screenshot here.

UPI ID: ${config.bakery.upiId}
Payee: ${config.bakery.upiPayeeName}

Your order will be confirmed after payment review.`);
}

async function handlePaymentScreenshot({ data, conversation, message, whatsapp }) {
  if (message.type !== "image" || !message.imageId) {
    await whatsapp.sendText(message.from, "Please upload the UPI payment screenshot as an image.");
    return;
  }

  const order = data.orders.find((candidate) => candidate.id === conversation.orderId);
  if (!order) {
    resetConversation(conversation);
    await whatsapp.sendText(message.from, "I could not find the draft order. Please send hi to start again.");
    return;
  }

  data.paymentScreenshots.push({
    id: newId("screenshot"),
    orderId: order.id,
    whatsappMediaId: message.imageId,
    status: "review_required",
    createdAt: nowIso()
  });

  order.status = "payment_review_required";
  order.updatedAt = nowIso();
  const payment = data.payments.find((candidate) => candidate.orderId === order.id);
  if (payment) {
    payment.status = "review_required";
    payment.updatedAt = nowIso();
  }

  resetConversation(conversation);
  await whatsapp.sendText(message.from, "Thanks. We received your payment screenshot and will confirm the order after review.");
}

function upsertCustomer(data, message) {
  let customer = data.customers.find((candidate) => candidate.phone === message.from);
  if (!customer) {
    customer = {
      id: newId("customer"),
      phone: message.from,
      name: message.contactName || "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    data.customers.push(customer);
  } else if (message.contactName && !customer.name) {
    customer.name = message.contactName;
    customer.updatedAt = nowIso();
  }
  return customer;
}

function getOrCreateConversation(data, customerId, phone) {
  let conversation = data.whatsappConversations.find((candidate) => candidate.customerId === customerId);
  if (!conversation) {
    conversation = {
      id: newId("conversation"),
      customerId,
      phone,
      step: "idle",
      draft: {},
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    data.whatsappConversations.push(conversation);
  }
  return conversation;
}

function resetConversation(conversation) {
  conversation.step = "idle";
  conversation.draft = {};
  conversation.orderId = null;
  conversation.updatedAt = nowIso();
  return conversation;
}

function createOrder(data, customer, draft) {
  const menuItem = data.menuItems.find((item) => item.id === draft.itemId);
  const lineTotalPaise = (menuItem?.pricePaise || 0) * draft.quantity;
  const order = {
    id: newId("order"),
    customerId: customer.id,
    phone: customer.phone,
    status: "pending_payment_screenshot",
    fulfillmentType: draft.fulfillmentType,
    afterCutoffAccepted: Boolean(draft.afterCutoffAccepted),
    totalPaise: lineTotalPaise,
    items: [
      {
        menuItemId: menuItem.id,
        name: menuItem.name,
        quantity: draft.quantity,
        unitPricePaise: menuItem.pricePaise,
        lineTotalPaise
      }
    ],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  data.orders.push(order);
  return order;
}

function formatCategories(data) {
  return `Choose a category:
${activeCategories(data).map((category, index) => `${index + 1}. ${category.label}`).join("\n")}

Reply 5 anytime to start over.`;
}

function formatItems(data, categoryId) {
  const items = activeItems(data).filter((item) => item.categoryId === categoryId);
  return `Choose an item:
${items.map((item, index) => `${index + 1}. ${item.name}${item.pricePaise ? ` - ${formatMoney(item.pricePaise)}` : ""}`).join("\n")}

Reply 5 anytime to start over.`;
}

function formatOrderSummary(data, draft) {
  const item = data.menuItems.find((candidate) => candidate.id === draft.itemId);
  const total = (item.pricePaise || 0) * draft.quantity;
  const priceNote = total ? formatMoney(total) : "Price to be confirmed";
  return `Order summary:
${draft.quantity} x ${item.name}
Fulfillment: ${draft.fulfillmentType}
Total: ${priceNote}

Reply 1 to confirm or 2 to cancel.`;
}

function activeCategories(data) {
  return data.menuCategories.filter((category) => category.active);
}

function activeItems(data) {
  return data.menuItems.filter((item) => item.active);
}

function resolveOption(options, text) {
  const index = Number.parseInt(text, 10);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1];
  }

  return options.find((option) => normalize(option.label || option.name) === text);
}

function startsWithHi(text) {
  return text === "hi" || text.startsWith("hi ");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formatMoney(paise) {
  return `Rs ${(paise / 100).toFixed(2)}`;
}

function formatCutoff(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${suffix}`;
}
