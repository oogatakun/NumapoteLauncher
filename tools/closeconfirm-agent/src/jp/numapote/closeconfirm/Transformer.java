package jp.numapote.closeconfirm;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.IllegalClassFormatException;
import java.security.ProtectionDomain;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Rewrites {@code static boolean org.lwjgl.glfw.GLFW.glfwWindowShouldClose(long)} so that its result goes
 * through the filter before it is returned:
 *
 * <pre>
 *   return ((BiFunction) System.getProperties().get(HOOK_KEY)).apply(result, window);
 * </pre>
 *
 * Only instructions that need no stack map frames are inserted (no branches), and only JDK classes are
 * referenced from the patched code.
 */
final class Transformer implements ClassFileTransformer {
    private static final String GLFW = "org/lwjgl/glfw/GLFW";

    private final Filter filter;

    Transformer(Filter filter) {
        this.filter = filter;
    }

    @Override
    public byte[] transform(ClassLoader loader, String className, Class<?> classBeingRedefined,
                            ProtectionDomain protectionDomain, byte[] classfileBuffer) throws IllegalClassFormatException {
        if (!GLFW.equals(className)) return null;
        try {
            final int[] patched = {0};
            ClassReader reader = new ClassReader(classfileBuffer);
            ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
            reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
                @Override
                public MethodVisitor visitMethod(int access, String name, String desc, String sig, String[] ex) {
                    MethodVisitor mv = super.visitMethod(access, name, desc, sig, ex);
                    boolean target = "glfwWindowShouldClose".equals(name) && "(J)Z".equals(desc)
                            && (access & Opcodes.ACC_STATIC) != 0;
                    if (!target) return mv;
                    patched[0]++;
                    return new MethodVisitor(Opcodes.ASM9, mv) {
                        @Override
                        public void visitInsn(int opcode) {
                            if (opcode == Opcodes.IRETURN) emitFilterCall(this);
                            super.visitInsn(opcode);
                        }
                    };
                }
            }, 0);
            if (patched[0] == 0) return null;
            filter.glfwLoaded(loader);
            if (Boolean.getBoolean("numapote.closeconfirm.debug")) System.err.println("[NumapoteCloseConfirm] patched GLFW.glfwWindowShouldClose");
            return writer.toByteArray();
        } catch (Throwable t) {
            System.err.println("[NumapoteCloseConfirm] could not patch GLFW: " + t);
            return null;
        }
    }

    /** Stack before: [boolean]. Stack after: [boolean]. The window handle is local 0 (a long). */
    private static void emitFilterCall(MethodVisitor mv) {
        mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Boolean", "valueOf", "(Z)Ljava/lang/Boolean;", false);
        mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/System", "getProperties", "()Ljava/util/Properties;", false);
        mv.visitLdcInsn(Agent.HOOK_KEY);
        mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/util/Properties", "get", "(Ljava/lang/Object;)Ljava/lang/Object;", false);
        mv.visitTypeInsn(Opcodes.CHECKCAST, "java/util/function/BiFunction");
        mv.visitInsn(Opcodes.SWAP);
        mv.visitVarInsn(Opcodes.LLOAD, 0);
        mv.visitMethodInsn(Opcodes.INVOKESTATIC, "java/lang/Long", "valueOf", "(J)Ljava/lang/Long;", false);
        mv.visitMethodInsn(Opcodes.INVOKEINTERFACE, "java/util/function/BiFunction", "apply",
                "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;", true);
        mv.visitTypeInsn(Opcodes.CHECKCAST, "java/lang/Boolean");
        mv.visitMethodInsn(Opcodes.INVOKEVIRTUAL, "java/lang/Boolean", "booleanValue", "()Z", false);
    }
}
