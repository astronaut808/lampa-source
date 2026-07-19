import Premiere from './premiere'
import Extend from './extend'
import Preroll from './preroll'
import Banner from './banner'
import Platform from '../../core/platform'
import { shouldInitializeBuiltinAds } from '../../custom/advertising_policy'

function init(){
    if(!shouldInitializeBuiltinAds()) return

    Premiere.init()
    Extend.init()
    
    if(!Platform.is(['orsay', 'netcast'])){
        Preroll.init()
        Banner.init()
    }
}

export default {
    init
}
