import CustomConfig from './config'

function enabled(){
    return CustomConfig.contentFilteringEnabled
}

function sensitiveContentRestricted(childProfile = false){
    return enabled() || Boolean(childProfile)
}

function dmcaMatch(list, media, id){
    return enabled() && Array.isArray(list) && list.find(item=>item.cat == media && item.id == id)
}

function blocksCard(movie){
    return enabled() && Boolean(movie && (movie.blocked || movie.lgbt))
}

function searchAllowed(query, stopKeys, childProfile = false){
    return !sensitiveContentRestricted(childProfile) || !stopKeys.find(key=>key == query.toLowerCase().trim())
}

function visibleKeywords(tags, adultKeys, lgbtKeys, childProfile = false){
    if(!sensitiveContentRestricted(childProfile)) return tags

    return tags.filter(key=>!adultKeys.find(tag=>tag.indexOf(key.name.toLowerCase()) >= 0))
        .filter(key=>!lgbtKeys.find(tag=>tag.indexOf(key.name.toLowerCase()) >= 0))
}

export default {
    enabled,
    sensitiveContentRestricted,
    dmcaMatch,
    blocksCard,
    searchAllowed,
    visibleKeywords
}
