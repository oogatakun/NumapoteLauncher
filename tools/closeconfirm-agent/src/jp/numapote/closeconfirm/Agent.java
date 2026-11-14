package jp.numapote.closeconfirm;

import java.lang.instrument.Instrumentation;

/**
 * Java agent that asks "really quit?" when the player closes the Minecraft window (close button /
 * Alt+F4). Added to the game by the launcher as -javaagent:numapote-closeconfirm.jar=ja|en.
 *
 * Minecraft (1.13+, LWJGL 3) polls GLFW.glfwWindowShouldClose() every frame. The transformer makes that
 * method ask {@link Filter} first. The filter is handed over through a system property holding a plain
 * java.util.function.BiFunction, so the patched LWJGL class only ever touches JDK classes and works no
 * matter which class loader / module layer (vanilla, Fabric, Forge) loaded it.
 */
public final class Agent {
    /** Key of the System property that holds the filter (a BiFunction&lt;Boolean, Long, Boolean&gt;). */
    public static final String HOOK_KEY = "numapote.closeconfirm.filter";

    private Agent() {}

    public static void premain(String args, Instrumentation inst) {
        try {
            Filter filter = new Filter("en".equals(args) ? Filter.EN : Filter.JA);
            System.getProperties().put(HOOK_KEY, filter);
            inst.addTransformer(new Transformer(filter));
        } catch (Throwable t) {
            // Never stop the game from starting because of this agent.
            System.err.println("[NumapoteCloseConfirm] disabled: " + t);
        }
    }
}
