const RuntimeConfig = typeof window !== 'undefined' && window.LampaRuntimeConfig
    ? window.LampaRuntimeConfig
    : {}

const CustomConfig = Object.freeze({
    buildName: 'Astronaut Lampa',
    cubTelemetryEnabled: RuntimeConfig.cubTelemetryEnabled === true,
    builtinAdsEnabled: RuntimeConfig.builtinAdsEnabled === true,
    shotsEnabled: RuntimeConfig.shotsEnabled === true,
    disableBuiltinAds: RuntimeConfig.builtinAdsEnabled !== true
})

export default CustomConfig
