package jp.numapote.closeconfirm;

import java.lang.reflect.Method;
import java.util.function.BiFunction;

import javax.swing.JDialog;
import javax.swing.JOptionPane;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;

/**
 * Called by the patched GLFW.glfwWindowShouldClose(window) with the value GLFW reported. While the
 * player has not agreed to quit, a "close requested" is taken back (the flag is cleared again) and a
 * confirmation dialog is shown on its own thread, so the game keeps running behind it.
 *
 * Everything here fails open: if the question cannot be asked, the game closes as it always did.
 */
final class Filter implements BiFunction<Boolean, Long, Boolean> {

    /** Texts of the dialog: title, message, yes button, no button. */
    static final String[] JA = {
        "Minecraft を閉じる",
        "Minecraft を終了しますか？",
        "終了する",
        "キャンセル"
    };
    static final String[] EN = {
        "Close Minecraft",
        "Do you want to quit Minecraft?",
        "Quit",
        "Cancel"
    };

    private static final boolean DEBUG = Boolean.getBoolean("numapote.closeconfirm.debug");

    private final String[] texts;
    private volatile ClassLoader glfwLoader;
    private volatile boolean confirmed;
    private volatile boolean asking;
    private Method setShouldClose;

    Filter(String[] texts) {
        this.texts = texts;
    }

    private static void debug(String message) {
        if (DEBUG) System.err.println("[NumapoteCloseConfirm] " + message);
    }

    void glfwLoaded(ClassLoader loader) {
        this.glfwLoader = loader;
    }

    @Override
    public Boolean apply(Boolean closeRequested, Long window) {
        try {
            if (confirmed) return Boolean.TRUE;
            if (!closeRequested) return Boolean.FALSE;
            debug("close requested (asking=" + asking + ")");
            // The close button / Alt+F4 was used and GLFW has set its flag. Take that back and ask.
            if (!clearCloseFlag(window)) return Boolean.TRUE; // cannot undo it: do not trap the player
            if (!asking) {
                asking = true;
                Thread t = new Thread(new Runnable() {
                    @Override
                    public void run() { ask(); }
                }, "Numapote close confirm");
                t.setDaemon(true);
                t.start();
            }
            return Boolean.FALSE;
        } catch (Throwable t) {
            return closeRequested;
        }
    }

    private boolean clearCloseFlag(long window) {
        try {
            if (setShouldClose == null) {
                Class<?> glfw = Class.forName("org.lwjgl.glfw.GLFW", false, glfwLoader);
                setShouldClose = glfw.getMethod("glfwSetWindowShouldClose", long.class, boolean.class);
            }
            setShouldClose.invoke(null, window, Boolean.FALSE);
            return true;
        } catch (Throwable t) {
            System.err.println("[NumapoteCloseConfirm] cannot cancel the close request: " + t);
            return false;
        }
    }

    private void ask() {
        boolean quit = true; // no way to ask (no dialog available): close like before
        try {
            Boolean answer = askNative();
            if (answer == null) answer = askSwing();
            if (answer != null) quit = answer.booleanValue();
        } catch (Throwable t) {
            System.err.println("[NumapoteCloseConfirm] cannot show the dialog: " + t);
        }
        debug("answer: " + (quit ? "quit" : "stay"));
        if (quit) confirmed = true;
        asking = false;
    }

    /**
     * The game's own LWJGL ships tinyfd (1.19+): a native message box that needs no AWT. Minecraft starts
     * with java.awt.headless=true, so Swing is not available as it is.
     */
    private Boolean askNative() {
        try {
            Class<?> tinyfd = Class.forName("org.lwjgl.util.tinyfd.TinyFileDialogs", true, glfwLoader);
            // "yesno": the default button is "no", so Enter keeps the game running. LWJGL 3.3 returns a
            // boolean, 3.4 an int (1 = yes).
            Object result;
            try {
                Method box = tinyfd.getMethod("tinyfd_messageBox",
                        CharSequence.class, CharSequence.class, CharSequence.class, CharSequence.class, boolean.class);
                result = box.invoke(null, texts[0], texts[1], "yesno", "question", Boolean.FALSE);
            } catch (NoSuchMethodException e) {
                Method box = tinyfd.getMethod("tinyfd_messageBox",
                        CharSequence.class, CharSequence.class, CharSequence.class, CharSequence.class, int.class);
                result = box.invoke(null, texts[0], texts[1], "yesno", "question", Integer.valueOf(0));
            }
            debug("native dialog result: " + result);
            if (result instanceof Boolean) return (Boolean) result;
            if (result instanceof Integer) return Boolean.valueOf(((Integer) result).intValue() == 1);
            return null;
        } catch (ClassNotFoundException e) {
            return null; // older game without tinyfd
        } catch (Throwable t) {
            System.err.println("[NumapoteCloseConfirm] native dialog failed: " + t);
            return null;
        }
    }

    private Boolean askSwing() throws Exception {
        System.setProperty("java.awt.headless", "false");
        if (java.awt.GraphicsEnvironment.isHeadless()) return null;
        try {
            UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
        } catch (Throwable ignored) {
            // the default look is fine
        }
        final boolean[] result = {false};
        SwingUtilities.invokeAndWait(new Runnable() {
            @Override
            public void run() {
                Object[] options = { texts[2], texts[3] };
                JOptionPane pane = new JOptionPane(texts[1], JOptionPane.QUESTION_MESSAGE,
                        JOptionPane.YES_NO_OPTION, null, options, options[1]);
                JDialog dialog = pane.createDialog(null, texts[0]);
                dialog.setAlwaysOnTop(true);
                dialog.setLocationRelativeTo(null);
                dialog.setVisible(true); // modal: returns when it is closed
                result[0] = options[0].equals(pane.getValue());
                dialog.dispose();
            }
        });
        return Boolean.valueOf(result[0]);
    }
}
