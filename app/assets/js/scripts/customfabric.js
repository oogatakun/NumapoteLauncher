/**
 * Fabric install helpers for custom instances. window.NLCustomFabric.
 */
(function(){
    // 'net.fabricmc:fabric-loader:0.15.11' -> 'net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar'
    function mavenToPath(name){
        const parts = name.split(':')
        const group = parts[0].replace(/\./g, '/')
        const artifact = parts[1]
        const version = parts[2]
        const classifier = parts.length > 3 ? '-' + parts[3] : ''
        return `${group}/${artifact}/${version}/${artifact}-${version}${classifier}.jar`
    }

    window.NLCustomFabric = { mavenToPath }
})()
