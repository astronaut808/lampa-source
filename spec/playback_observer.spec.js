import {describe, expect, it} from 'vitest'
import {
    classifyStall,
    detectIssue,
    summarizeWindow
} from '../src/utils/playback_observer'

function point(overrides){
    return Object.assign({
        at_ms: 0,
        media_time_ms: 1000,
        buffer_ahead_ms: 10000,
        ready_state: 4,
        paused: false,
        seeking: false,
        ended: false,
        control_active: false,
        hidden: false,
        width: 1920,
        height: 1080,
        frame_counters: true,
        decoded_frames: 0,
        dropped_frames: 0,
        presentation_supported: true,
        presented_frames: 100,
        presentation_gap_ms: 0,
        presentation_delay_ms: 0
    }, overrides || {})
}

describe('playback observer', ()=>{
    it('detects a presentation freeze even when VIDAA decoded counters stay at zero', ()=>{
        let samples = [
            point(),
            point({at_ms: 1000, media_time_ms: 2000}),
            point({at_ms: 3000, media_time_ms: 4000, presentation_gap_ms: 3000})
        ]

        expect(detectIssue(samples)).toBe('video_frames_not_advancing')
    })

    it('does not treat pause and resume as a frame freeze', ()=>{
        let samples = [
            point(),
            point({at_ms: 1000, media_time_ms: 1000, paused: true}),
            point({at_ms: 2000, media_time_ms: 1000, paused: true}),
            point({at_ms: 3000, media_time_ms: 1100})
        ]

        expect(detectIssue(samples)).toBe('')
    })

    it('ignores application control and seek transition windows', ()=>{
        let controlled = [
            point(),
            point({at_ms: 1000, control_active: true}),
            point({at_ms: 3000, media_time_ms: 4000})
        ]
        let seeking = [
            point(),
            point({at_ms: 1000, seeking: true}),
            point({at_ms: 3000, media_time_ms: 4000})
        ]

        expect(detectIssue(controlled)).toBe('')
        expect(detectIssue(seeking)).toBe('')
        expect(classifyStall(point({seeking: true}), point())).toBe('seek_transition')
    })

    it('summarizes a bounded interval without retaining source URLs', ()=>{
        let summary = summarizeWindow([
            point({at_ms: 1000, media_time_ms: 5000, buffer_ahead_ms: 8000, presented_frames: 10}),
            point({at_ms: 2000, media_time_ms: 6000, buffer_ahead_ms: 6000, presented_frames: 34, presentation_gap_ms: 25}),
            point({at_ms: 3000, media_time_ms: 7000, buffer_ahead_ms: 4000, presented_frames: 58, presentation_delay_ms: 40})
        ])

        expect(summary).toEqual({
            at_ms: 3000,
            interval_ms: 2000,
            media_time_ms: 7000,
            media_advance_ms: 2000,
            min_buffer_ahead_ms: 4000,
            min_ready_state: 4,
            paused_samples: 0,
            seeking_samples: 0,
            presentation_supported: true,
            presented_frame_advance: 48,
            max_presentation_gap_ms: 25,
            max_presentation_delay_ms: 40
        })
        expect(JSON.stringify(summary)).not.toContain('url')
    })
})
