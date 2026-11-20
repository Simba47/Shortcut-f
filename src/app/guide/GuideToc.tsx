'use client'

import { useEffect, useState } from 'react'

/** The Guide's list of sections: the one being read is lit up as the page scrolls (a row of chips on phones) */
export function GuideToc({ items }: { items: { id: string; label: string; icon: React.ReactNode }[] }) {
  const [now, setNow] = useState(items[0]?.id)

  useEffect(() => {
    const els = items.map(i => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e)
    const pick = () => {
      // the last section whose top has passed a line a third of the way down the screen
      const line = window.innerHeight / 3
      let cur = els[0]?.id
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id
      // at the very bottom, the last one (short last sections never reach the line)
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = els[els.length - 1]?.id
      setNow(cur)
    }
    pick()
    window.addEventListener('scroll', pick, { passive: true })
    window.addEventListener('resize', pick)
    return () => { window.removeEventListener('scroll', pick); window.removeEventListener('resize', pick) }
  }, [items])

  // keep the lit chip in view in the phone's row
  useEffect(() => {
    const a = document.querySelector<HTMLElement>(`.gd-toc a[href="#${now}"]`)
    const box = a?.closest<HTMLElement>('.gd-toc')
    if (a && box && box.scrollWidth > box.clientWidth) box.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' })
  }, [now])

  return (
    <nav className="gd-toc" aria-label="Guide sections">
      <p className="gd-toc-title">In this guide</p>
      <ol>
        {items.map(i => (
          <li key={i.id}>
            <a href={`#${i.id}`} aria-current={now === i.id || undefined}>{i.icon}{i.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
