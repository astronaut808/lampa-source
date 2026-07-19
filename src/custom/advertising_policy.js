import CustomConfig from './config'

/**
 * Определяет, разрешён ли показ preroll через встроенный рекламный lifecycle Lampa.
 *
 * @param {Object} state - Текущее состояние пользователя и плеера.
 * @returns {Boolean} true, если preroll разрешён.
 */
function canShowBuiltinPreroll(state){
    if(CustomConfig.disableBuiltinAds) return false
    if(state.excludedMedia) return false

    return state.developerAdsEnabled || (!state.hasPremium && !state.personalConfirmed)
}

/**
 * Определяет, нужно ли запускать менеджер встроенной рекламы и его сетевые запросы.
 *
 * @returns {Boolean} true, если менеджер должен быть инициализирован.
 */
function shouldInitializeBuiltinAds(){
    return !CustomConfig.disableBuiltinAds
}

export {
    canShowBuiltinPreroll,
    shouldInitializeBuiltinAds
}
