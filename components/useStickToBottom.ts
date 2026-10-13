'use client'
import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keeps a chat pinned to its newest message while photos and GIFs finish
 * loading (2026-10-13). The chats scroll to the bottom when messages arrive,
 * but an image loading afterwards grows the list and left the view stuck
 * partway up (TC chat opened on an old GIF). Once the person scrolls up
 * themselves, it leaves them where they are until they come back down.
 *
 * `bottomRef` is the empty marker div after the last message; its parent is
 * the scrolling list.
 */
export function useStickToBottom(bottomRef: RefObject<HTMLDivElement | null>) {
  // Kept across renders: the chats re-render on every poll.
  const stick = useRef(true)
  const touched = useRef(false)
  // Re-attached each render because the list only exists once the page has
  // loaded; the state above is what persists.
  useEffect(() => {
    const list = bottomRef.current?.parentElement
    if (!list) return
    const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 120
    const onTouch = () => { touched.current = true }
    const onScroll = () => { if (touched.current) stick.current = nearBottom() }
    const onLoad = (e: Event) => {
      if (stick.current && (e.target as HTMLElement)?.tagName === 'IMG') list.scrollTop = list.scrollHeight
    }
    list.addEventListener('touchstart', onTouch, { passive: true })
    list.addEventListener('wheel', onTouch, { passive: true })
    list.addEventListener('scroll', onScroll, { passive: true })
    list.addEventListener('load', onLoad, true) // images' load events do not bubble
    return () => {
      list.removeEventListener('touchstart', onTouch)
      list.removeEventListener('wheel', onTouch)
      list.removeEventListener('scroll', onScroll)
      list.removeEventListener('load', onLoad, true)
    }
  })
}
