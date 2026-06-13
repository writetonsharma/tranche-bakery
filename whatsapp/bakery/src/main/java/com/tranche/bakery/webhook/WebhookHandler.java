package com.tranche.bakery.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.tranche.bakery.conversation.ConversationService;
import com.tranche.bakery.customer.CustomerService;
import com.tranche.bakery.customer.Customer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class WebhookHandler {

    private final CustomerService customerService;
    private final ConversationService conversationService;

    public void handle(JsonNode payload) {
        JsonNode entries = payload.path("entry");
        if (entries.isMissingNode()) return;

        for (JsonNode entry : entries) {
            for (JsonNode change : entry.path("changes")) {
                if (!"messages".equals(change.path("field").asText())) continue;

                JsonNode value = change.path("value");
                for (JsonNode message : value.path("messages")) {
                    String from = message.path("from").asText();
                    String type = message.path("type").asText();
                    log.info("Incoming message from={} type={}", from, type);

                    Customer customer = customerService.findOrCreate(from);
                    conversationService.handle(customer, type, message);
                }
            }
        }
    }
}
