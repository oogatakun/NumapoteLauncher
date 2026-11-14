import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.commons.ClassRemapper;
import org.objectweb.asm.commons.Remapper;

/**
 * Build-time helper: copies every .class under <in> to <out>, moving the package org.objectweb.asm to
 * jp.numapote.closeconfirm.asm, so the copy of ASM inside the agent jar can never clash with the ASM that
 * Forge / Fabric put on the game's class path.
 *
 * usage: java -cp asm.jar;asm-commons.jar;asm-tree.jar Relocate <in> <out>
 */
public class Relocate {
    private static final String FROM = "org/objectweb/asm/";
    private static final String TO = "jp/numapote/closeconfirm/asm/";

    public static void main(String[] args) throws IOException {
        final Path in = Paths.get(args[0]);
        final Path out = Paths.get(args[1]);
        final Remapper remapper = new Remapper() {
            @Override
            public String map(String internalName) {
                return internalName.startsWith(FROM) ? TO + internalName.substring(FROM.length()) : internalName;
            }
        };
        Files.walkFileTree(in, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                String rel = in.relativize(file).toString().replace('\\', '/');
                if (!rel.endsWith(".class") || rel.equals("module-info.class")) return FileVisitResult.CONTINUE;
                ClassReader reader = new ClassReader(Files.readAllBytes(file));
                ClassWriter writer = new ClassWriter(0);
                reader.accept(new ClassRemapper(writer, remapper), 0);
                String newRel = rel.startsWith(FROM) ? TO + rel.substring(FROM.length()) : rel;
                Path target = out.resolve(newRel);
                Files.createDirectories(target.getParent());
                Files.write(target, writer.toByteArray());
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
