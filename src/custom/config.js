const RuntimeConfig = typeof window !== 'undefined' && window.LampaRuntimeConfig
    ? window.LampaRuntimeConfig
    : {}

const CustomConfig = Object.freeze({
    buildName: 'Astronaut Lampa',
    cubTelemetryEnabled: RuntimeConfig.cubTelemetryEnabled === true,
    builtinAdsEnabled: RuntimeConfig.builtinAdsEnabled === true,
    shotsEnabled: RuntimeConfig.shotsEnabled === true,
    playbackMetricsEnabled: RuntimeConfig.playbackMetricsEnabled !== false,
    cardMetricsEnabled: RuntimeConfig.cardMetricsEnabled !== false,
    networkMetricsEnabled: RuntimeConfig.networkMetricsEnabled !== false,
    disableBuiltinAds: RuntimeConfig.builtinAdsEnabled !== true
})

export default CustomConfig
