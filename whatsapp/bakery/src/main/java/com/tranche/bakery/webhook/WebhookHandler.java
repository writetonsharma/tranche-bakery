package com.tranche.bakery.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@Slf4j
public class WebhookHandler {

    public void handle(JsonNode payload) {
        JsonNode entries = payload.path("entry");
        if (entries.isMissingNode()) return;

        for (JsonNode entry : entries) {
            for (JsonNode change : entry.path("changes")) {
                String field = change.path("field").asText();
                if (!"messages".equals(field)) continue;

                JsonNode value = change.path("value");
                for (JsonNode message : value.path("messages")) {
                    String from = message.path("from").asText();
                    String type = message.path("type").asText();
                    handleMessage(from, type, message);
                }
            }
        }
    }

    private void handleMessage(String from, String type, JsonNode message) {
        log.info("Incoming message from={} type={}", from, type);
        // TODO: route to conversation state machine
    }
}
