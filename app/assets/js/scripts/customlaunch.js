/**
 * Launch a user-created (custom) instance without the distribution.
 * Exposed as window.NLCustomLaunch. contextIsolation is disabled, so it can
 * use the launch helpers/globals defined by landing.js at call time.
 */
(function(){
    const { MojangIndexProcessor, downloadQueue, getExpectedDownloadSize } = require('helios-core/dl')
    const ProcessBuilder = require('./assets/js/processbuilder')
    const ConfigManager = require('./assets/js/configmanager')

    function isCustomSelected(){
        return ConfigManager.getCustomInstance(ConfigManager.getSelectedServer()) != null
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
        const versionData = await proc.getVersionJson()

        // 2) Ensure a mod configuration exists so ProcessBuilder won't crash.
        if(ConfigManager.getModConfiguration(instance.id) == null){
            ConfigManager.setModConfiguration(instance.id, { id: instance.id, mods: {} })
            ConfigManager.save()
        }

        // 3) Build & launch.
        const authUser = ConfigManager.getSelectedAccount()
        const syntheticServer = buildSyntheticServer(instance)
        setLaunchDetails('起動準備中...')
        const pb = new ProcessBuilder(syntheticServer, versionData, null, authUser, remote.app.getVersion())
        const gameProc = pb.build()

        // Update lastPlayed
        ConfigManager.updateCustomInstance(instance.id, { lastPlayed: Date.now() })
        ConfigManager.save()

        return gameProc
    }

    window.NLCustomLaunch = { isCustomSelected, launchCustomInstance }
})()
