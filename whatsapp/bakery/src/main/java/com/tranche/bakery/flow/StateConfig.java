package com.tranche.bakery.flow;

import lombok.Data;
import java.util.List;

@Data
public class StateConfig {
    private MessageConfig entryMessage;
    private String entryAction;
    private String autoTransition;
    private List<TransitionConfig> transitions;
}
