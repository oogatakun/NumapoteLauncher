// Builds libraries/java/numapote-closeconfirm.jar (the "really quit Minecraft?" Java agent).
//
//   node tools/closeconfirm-agent/build.js
//
// Needs a JDK (javac, jar, java) on PATH and the ASM jars (asm, asm-commons, asm-tree) of one version. They are
// found in the launcher's own game libraries (the ones Forge / Fabric download) or in ASM_DIR, the folder that
// holds the three jars. The built jar is committed, so this only has to be run when the agent changes.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ASM_VERSION = process.env.ASM_VERSION || '9.9.1'
const root = __dirname
const outJar = path.join(root, '..', '..', 'libraries', 'java', 'numapote-closeconfirm.jar')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'closeconfirm-'))

function asmJar(name){
    const file = `${name}-${ASM_VERSION}.jar`
    const candidates = []
    if(process.env.ASM_DIR) candidates.push(path.join(process.env.ASM_DIR, file))
    const appData = process.env.APPDATA || os.homedir()
    candidates.push(path.join(appData, '.numapotelauncher', 'common', 'libraries', 'org', 'ow2', 'asm', name, ASM_VERSION, file))
    const found = candidates.find(c => fs.existsSync(c))
    if(!found) throw new Error(`${file} not found. Set ASM_DIR to a folder that holds it. Looked in:\n  ` + candidates.join('\n  '))
    return found
}
const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts })

try {
    const asm = asmJar('asm'), commons = asmJar('asm-commons'), tree = asmJar('asm-tree')
    const sep = path.delimiter
    const raw = path.join(work, 'raw'), done = path.join(work, 'done'), src = path.join(work, 'sources.txt')
    fs.mkdirSync(raw); fs.mkdirSync(done)

    // 1) the agent's own classes (Java 8 bytecode, so it runs on every Java Minecraft needs)
    const files = []
    ;(function walk(d){ for(const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.java') && files.push(path.join(d, e.name)) })(path.join(root, 'src'))
    fs.writeFileSync(src, files.map(f => `"${f.replace(/\\/g, '/')}"`).join('\n'))
    run('javac', ['--release', '8', '-encoding', 'UTF-8', '-Xlint:-options', '-cp', asm, '-d', raw, '@' + src])

    // 2) ASM's classes next to them, then everything is relocated in one pass
    run('jar', ['xf', asm], { cwd: raw })
    const tool = path.join(work, 'tool'); fs.mkdirSync(tool)
    run('javac', ['--release', '8', '-encoding', 'UTF-8', '-Xlint:-options', '-cp', [asm, commons, tree].join(sep), '-d', tool, path.join(root, 'Relocate.java')])
    run('java', ['-cp', [tool, asm, commons, tree].join(sep), 'Relocate', raw, done])

    // 3) license (ASM is BSD-3 and must travel with the binary) + manifest + jar
    fs.mkdirSync(path.join(done, 'META-INF'), { recursive: true })
    fs.copyFileSync(path.join(root, 'ASM-LICENSE.txt'), path.join(done, 'META-INF', 'ASM-LICENSE.txt'))
    const manifest = path.join(work, 'manifest.txt')
    fs.writeFileSync(manifest, 'Premain-Class: jp.numapote.closeconfirm.Agent\n')
    fs.mkdirSync(path.dirname(outJar), { recursive: true })
    run('jar', ['--create', '--file', outJar, '--manifest', manifest, '-C', done, '.'])
    console.log(`built ${outJar} (${fs.statSync(outJar).size} bytes, ASM ${ASM_VERSION} relocated)`)
} finally {
    fs.rmSync(work, { recursive: true, force: true })
}
