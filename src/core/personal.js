import { shouldInitializeBuiltinAds } from '../custom/advertising_policy'

let status = false

function init(){
    if(!shouldInitializeBuiltinAds()) return

    $.ajax({
        url: "./personal.lampa",
        dataType: 'text',
        success: ()=>{
            status = true
        }
    })
}

function confirm(){
    return status
}

export default {
    init,
    confirm
}
