package com.tranche.bakery.flow;

import com.fasterxml.jackson.databind.JsonNode;
import com.tranche.bakery.conversation.ConversationRepository;
import com.tranche.bakery.conversation.WhatsappConversation;
import com.tranche.bakery.customer.Customer;
import com.tranche.bakery.whatsapp.WhatsAppClient;
import com.tranche.bakery.whatsapp.WhatsAppMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class FlowEngine {

    private final FlowLoader flowLoader;
    private final DataSourceResolver dataSourceResolver;
    private final ConversationRepository conversationRepository;
    private final WhatsAppClient whatsAppClient;
    private final List<FlowAction> actions;

    @Transactional
    public void handle(Customer customer, WhatsappConversation conversation,
                       String messageType, String input, JsonNode rawMessage) {

        String phone = customer.getPhone();

        // Global "hi" handler — resets from any state
        if ("hi".equalsIgnoreCase(input.trim())) {
            conversation.setState("MAIN_MENU");
            conversation.setContext(new HashMap<>());
            conversationRepository.save(conversation);
            sendEntryMessage(phone, flowLoader.getState("MAIN_MENU"), null);
            return;
        }

        String currentStateName = conversation.getState();
        StateConfig stateConfig = flowLoader.getState(currentStateName);

        if (stateConfig == null) {
            log.warn("Unknown state '{}' for customer {}, resetting", currentStateName, phone);
            resetToMainMenu(customer, conversation);
            return;
        }

        TransitionConfig transition = findTransition(stateConfig, input, messageType);

        if (transition == null) {
            // No matching transition — resend current state entry message
            if (stateConfig.getEntryMessage() != null) {
                sendEntryMessage(phone, stateConfig, conversation.getContext());
            }
            return;
        }

        // Save context key from input
        if (transition.getSaveContext() != null) {
            Map<String, Object> ctx = conversation.getContext() != null
                    ? new HashMap<>(conversation.getContext()) : new HashMap<>();
            ctx.put(transition.getSaveContext(), input);
            conversation.setContext(ctx);
        }

        // Execute transition action
        if (transition.getAction() != null) {
            executeAction(transition.getAction(), buildActionContext(customer, conversation, input, messageType, rawMessage));
        }

        // Transition to next state
        String nextStateName = transition.getNextState();
        conversation.setState(nextStateName);
        conversationRepository.save(conversation);

        StateConfig nextState = flowLoader.getState(nextStateName);
        if (nextState == null) return;

        // Execute entry action of next state
        if (nextState.getEntryAction() != null) {
            executeAction(nextState.getEntryAction(), buildActionContext(customer, conversation, input, messageType, rawMessage));
        }

        // Send entry message of next state
        if (nextState.getEntryMessage() != null) {
            sendEntryMessage(phone, nextState, conversation.getContext());
        }

        // Handle auto-transition
        if (nextState.getAutoTransition() != null) {
            String autoStateName = nextState.getAutoTransition();
            conversation.setState(autoStateName);
            conversationRepository.save(conversation);
            StateConfig autoState = flowLoader.getState(autoStateName);
            if (autoState != null && autoState.getEntryMessage() != null) {
                sendEntryMessage(phone, autoState, conversation.getContext());
            }
        }
    }

    private void sendEntryMessage(String phone, StateConfig state, Map<String, Object> context) {
        MessageConfig msg = state.getEntryMessage();
        switch (msg.getType()) {
            case "text" -> whatsAppClient.sendText(phone, msg.getBody());
            case "buttons" -> whatsAppClient.sendButtons(phone, msg.getBody(),
                    msg.getButtons().stream()
                            .map(b -> new WhatsAppMessage.Button(b.getId(), b.getTitle()))
                            .toList());
            case "list" -> {
                List<WhatsAppMessage.Section> sections = msg.getDataSource() != null
                        ? dataSourceResolver.resolve(msg.getDataSource(), context)
                        : List.of();
                whatsAppClient.sendList(phone, msg.getBody(), msg.getButtonLabel(), sections);
            }
        }
    }

    private TransitionConfig findTransition(StateConfig state, String input, String messageType) {
        if (state.getTransitions() == null) return null;

        for (TransitionConfig t : state.getTransitions()) {
            // Match by message type (e.g. image)
            if (t.getMatchType() != null) {
                if (t.getMatchType().equalsIgnoreCase(messageType)) return t;
                continue;
            }
            // Wildcard
            if ("*".equals(t.getMatch())) return t;
            // Exact match
            String candidate = t.isIgnoreCase() ? input.trim().toLowerCase() : input.trim();
            String pattern   = t.isIgnoreCase() ? t.getMatch().toLowerCase() : t.getMatch();
            if (candidate.equals(pattern)) return t;
        }
        return null;
    }

    private void executeAction(String actionName, ActionContext ctx) {
        actions.stream()
                .filter(a -> a.getName().equals(actionName))
                .findFirst()
                .ifPresentOrElse(
                        a -> a.execute(ctx),
                        () -> log.warn("No action registered for: {}", actionName));
    }

    private ActionContext buildActionContext(Customer customer, WhatsappConversation conversation,
                                             String input, String messageType, JsonNode rawMessage) {
        return ActionContext.builder()
                .customer(customer)
                .conversation(conversation)
                .input(input)
                .messageType(messageType)
                .rawMessage(rawMessage)
                .build();
    }

    private void resetToMainMenu(Customer customer, WhatsappConversation conversation) {
        conversation.setState("MAIN_MENU");
        conversation.setContext(new HashMap<>());
        conversationRepository.save(conversation);
        sendEntryMessage(customer.getPhone(), flowLoader.getState("MAIN_MENU"), null);
    }
}
