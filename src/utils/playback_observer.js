const FRAME_WINDOW_MS = 3000

function finite(value){
    value = Number(value)

    return Number.isFinite(value) ? value : 0
}

function bufferedAhead(video){
    let current = finite(video && video.currentTime)
    let ranges = video && video.buffered

    if(!ranges || !ranges.length) return 0

    try{
        for(let i = 0; i < ranges.length; i++){
            if(ranges.start(i) <= current && current <= ranges.end(i)){
                return Math.max(0, Math.round((ranges.end(i) - current) * 1000))
            }
        }
    }
    catch(e){}

    return 0
}

function frameStats(video){
    let decoded = finite(video && video.webkitDecodedFrameCount)
    let dropped = finite(video && video.webkitDroppedFrameCount)
    let supported = Boolean(video && (
        typeof video.webkitDecodedFrameCount === 'number' ||
        typeof video.webkitDroppedFrameCount === 'number'
    ))

    try{
        if(video && typeof video.getVideoPlaybackQuality === 'function'){
            let quality = video.getVideoPlaybackQuality() || {}

            decoded = finite(quality.totalVideoFrames)
            dropped = finite(quality.droppedVideoFrames)
            supported = true
        }
    }
    catch(e){}

    return {
        supported: supported,
        decoded: Math.max(0, Math.round(decoded)),
        dropped: Math.max(0, Math.round(dropped))
    }
}

function sample(video, atMs){
    let frames = frameStats(video)

    return {
        at_ms: Math.max(0, Math.round(finite(atMs))),
        media_time_ms: Math.max(0, Math.round(finite(video && video.currentTime) * 1000)),
        buffer_ahead_ms: bufferedAhead(video),
        ready_state: Math.max(0, Math.round(finite(video && video.readyState))),
        network_state: Math.max(0, Math.round(finite(video && video.networkState))),
        paused: Boolean(video && video.paused),
        seeking: Boolean(video && video.seeking),
        ended: Boolean(video && video.ended),
        width: Math.max(0, Math.round(finite(video && video.videoWidth))),
        height: Math.max(0, Math.round(finite(video && video.videoHeight))),
        frame_counters: frames.supported,
        decoded_frames: frames.decoded,
        dropped_frames: frames.dropped
    }
}

function windowStart(samples, current){
    let threshold = current.at_ms - FRAME_WINDOW_MS
    let selected = samples[0]

    for(let i = samples.length - 1; i >= 0; i--){
        if(samples[i].at_ms <= threshold){
            selected = samples[i]
            break
        }
    }

    return selected
}

function detectIssue(samples){
    if(!samples || samples.length < 3) return ''

    let current = samples[samples.length - 1]
    let previous = windowStart(samples, current)
    let wallDelta = current.at_ms - previous.at_ms

    if(wallDelta < 2500 || current.paused || current.seeking || current.ended) return ''

    let mediaDelta = current.media_time_ms - previous.media_time_ms
    let decodedDelta = current.decoded_frames - previous.decoded_frames

    if(current.frame_counters && previous.frame_counters && decodedDelta === 0){
        if(
            mediaDelta >= 1500 &&
            current.decoded_frames > 0 &&
            current.width > 0 &&
            current.height > 0
        ) return 'video_frames_not_advancing'

        if(
            mediaDelta <= 250 &&
            current.buffer_ahead_ms >= 2000 &&
            current.ready_state >= 3
        ) return 'pipeline_not_advancing_with_buffer'
    }

    if(
        mediaDelta <= 250 &&
        current.buffer_ahead_ms <= 250 &&
        current.ready_state <= 2
    ) return 'buffer_starvation'

    return ''
}

function classifyStall(start, end){
    if(!start || !end) return 'unknown'

    if(
        finite(start.buffer_ahead_ms) <= 250 ||
        finite(start.ready_state) <= 2 ||
        finite(end.buffer_ahead_ms) <= 250
    ) return 'buffer_starvation'

    if(
        start.frame_counters &&
        end.frame_counters &&
        finite(start.decoded_frames) > 0 &&
        finite(end.decoded_frames) === finite(start.decoded_frames) &&
        finite(end.width) > 0 &&
        finite(end.height) > 0
    ) return 'video_frames_not_advancing'

    return 'unknown'
}

export {
    FRAME_WINDOW_MS,
    bufferedAhead,
    frameStats,
    sample,
    detectIssue,
    classifyStall
}
