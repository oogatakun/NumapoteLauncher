/**
 * Launch a user-created (custom) instance without the distribution.
 * Exposed as window.NLCustomLaunch. contextIsolation is disabled, so it can
 * use the launch helpers/globals defined by landing.js at call time.
 */
(function(){
    const { MojangIndexProcessor, downloadQueue, getExpectedDownloadSize } = require('helios-core/dl')
    const { mcVersionAtLeast } = require('helios-core/common')
    const { JdkDistribution } = require('helios-distribution-types')
    const ProcessBuilder = require('./assets/js/processbuilder')
    const ConfigManager = require('./assets/js/configmanager')

    function isCustomSelected(){
        return ConfigManager.getCustomInstance(ConfigManager.getSelectedServer()) != null
    }

    // Fallback Java major from the MC version (used only if the Mojang
    // manifest lookup fails). Mirrors helios-core DistributionFactory.
    function fallbackJavaMajor(mcVersion){
        if(mcVersionAtLeast('1.20.5', mcVersion)) return 21
        if(mcVersionAtLeast('1.17', mcVersion)) return 17
        if(mcVersionAtLeast('1.16', mcVersion)) return 16
        return 8
    }

    /**
     * Determine effectiveJavaOptions for a custom instance. Prefers the exact
     * Java major declared by the Mojang version manifest (javaVersion.majorVersion),
     * which is authoritative for newer versions (e.g. MC 26.x requires Java 25 and
     * passes Java-25-only JVM flags). Falls back to a version heuristic if the
     * manifest lookup is unavailable.
     */
    async function getEffectiveJavaOptions(mcVersion){
        let major = null
        try {
            if(window.NLCustomVersions && typeof window.NLCustomVersions.fetchRequiredJavaMajor === 'function'){
                major = await window.NLCustomVersions.fetchRequiredJavaMajor(mcVersion)
            }
        } catch(e){ /* fall back below */ }
        const suggestedMajor = major || fallbackJavaMajor(mcVersion)
        const supported = suggestedMajor <= 8 ? '8.x' : `>=${suggestedMajor}.x`
        const distribution = process.platform === 'darwin' ? JdkDistribution.CORRETTO : JdkDistribution.TEMURIN
        return { supported, distribution, suggestedMajor }
    }

    /**
     * Build a distribution-server-like object ProcessBuilder can consume.
     * For vanilla there are no modules.
     */
    function buildSyntheticServer(instance){
        return {
            rawServer: {
                id: instance.id,
                name: instance.name,
                minecraftVersion: instance.minecraftVersion,
                javaOptions: undefined
            },
            modules: []
        }
    }

    async function launchCustomInstance(instance){
        const commonDir = ConfigManager.getCommonDirectory()

        // 1) Validate + download vanilla files via Mojang processor.
        setLaunchDetails('バニラファイルを準備中...')
        setLaunchPercentage(0, 100)
        const proc = new MojangIndexProcessor(commonDir, instance.minecraftVersion)
        await proc.init()
        const versionData = await proc.getVersionJson()

        const invalidByCat = await proc.validate(async () => {})
        const assets = Object.values(invalidByCat).reduce((a, b) => a.concat(b), [])
        if(assets.length > 0){
            setLaunchDetails('ダウンロード中...')
            const totalSize = getExpectedDownloadSize(assets)
            await downloadQueue(assets, received => {
                const pct = totalSize > 0 ? Math.floor((received / totalSize) * 100) : 0
                setDownloadPercentage(Math.min(99, pct))
            })
            setDownloadPercentage(100)
        }
        await proc.postDownload()

        // 2) Ensure a mod configuration exists so ProcessBuilder won't crash.
        if(ConfigManager.getModConfiguration(instance.id) == null){
            ConfigManager.setModConfiguration(instance.id, { id: instance.id, mods: {} })
            ConfigManager.save()
        }

        // Loader-specific setup.
        let modManifest = null
        let loaderModules = []
        if(instance.loader === 'fabric'){
            setLaunchDetails('Fabricを準備中...')
            const profile = await window.NLCustomVersions.fetchFabricProfile(instance.minecraftVersion, instance.loaderVersion)
            const fabricModule = await window.NLCustomFabric.installFabric(profile, commonDir)
            modManifest = profile          // has mainClass + arguments + libraries
            loaderModules = [fabricModule]  // Type.Fabric synthetic module
        }

        // 3) Build & launch.
        const authUser = ConfigManager.getSelectedAccount()
        const syntheticServer = buildSyntheticServer(instance)
        syntheticServer.modules = loaderModules
        setLaunchDetails('起動準備中...')
        const pb = new ProcessBuilder(syntheticServer, versionData, modManifest, authUser, remote.app.getVersion())
        const gameProc = pb.build()

        // Update lastPlayed
        ConfigManager.updateCustomInstance(instance.id, { lastPlayed: Date.now() })
        ConfigManager.save()

        return gameProc
    }

    window.NLCustomLaunch = { isCustomSelected, launchCustomInstance, getEffectiveJavaOptions }
})()
