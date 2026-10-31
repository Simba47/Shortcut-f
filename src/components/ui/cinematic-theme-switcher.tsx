'use client'

import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * Dark / light switch for the dashboard, the clip board and the editor (only those: every other
 * page stays dark). A sculpted pill track, a round thumb that springs across with a small burst of
 * light, sun on the left and moon on the right — in the app's own neutral glass and palette colour.
 *
 * The choice is kept in this browser (localStorage `shortcut-theme`) and shown as
 * `<html data-theme="light">`, which the pages' light styles key on (globals.css). The root layout
 * sets it before the page paints, on these pages only, so a light page never flashes dark. Leaving
 * for any other page takes it off again.
 */

export const THEME_KEY = 'shortcut-theme'
/** The pages that can be light (the root layout's early script uses the same rule) */
export const THEMED_PATHS = /^\/(dashboard|videos\/|editor\/)/
const CHANGED = 'shortcut-theme-change'

type Theme = 'light' | 'dark'
function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
function applyTheme(t: Theme) {
  const el = document.documentElement
  if (t === 'light') el.setAttribute('data-theme', 'light')
  else el.removeAttribute('data-theme')
}

/** The theme on this page, and a way to change it (kept, and told to every switch on the page) */
export function useAppTheme() {
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const sync = () => { const t = readTheme(); setTheme(t); applyTheme(t) }
    sync()
    setMounted(true)
    window.addEventListener(CHANGED, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
      // (off to a page that's always dark: the light look goes with this page)
      if (!THEMED_PATHS.test(window.location.pathname)) applyTheme('dark')
    }
  }, [])
  const change = (t: Theme) => {
    try { localStorage.setItem(THEME_KEY, t) } catch { /* private mode: this page only */ }
    applyTheme(t)
    setTheme(t)
    window.dispatchEvent(new Event(CHANGED))
  }
  return { theme, mounted, setTheme: change }
}

interface Particle { id: number; delay: number; duration: number }

export default function CinematicThemeSwitcher({ className = '' }: { className?: string }) {
  const { theme, mounted, setTheme } = useAppTheme()
  const [particles, setParticles] = useState<Particle[]>([])
  const isDark = !mounted || theme === 'dark'

  // A few rings of light, staggered, out from the thumb as it moves
  const burst = () => {
    setParticles([0, 1, 2].map(i => ({ id: Date.now() + i, delay: i * 0.1, duration: 0.6 + i * 0.1 })))
    setTimeout(() => setParticles([]), 1000)
  }
  const toggle = () => { burst(); setTheme(isDark ? 'light' : 'dark') }

  return (
    <motion.button type="button" onClick={toggle} disabled={!mounted}
      role="switch" aria-checked={isDark} aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`} title={isDark ? 'Light mode' : 'Dark mode'}
      whileTap={{ scale: 0.96 }}
      className={`relative shrink-0 flex h-[34px] w-[64px] items-center rounded-full p-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8ff00]/60 ${className}`}
      // (user, 2026-10-31: the navy and yellow looked odd next to every other button) the app's own look: a
      // neutral glass track with a fine edge, a white-glass thumb as on the Off / Reels / Shorts switch, the
      // icon of the theme on in the palette colour and the other one plain grey
      style={{
        background: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(10, 10, 12, 0.06)',
        boxShadow: isDark
          ? 'inset 0 1px 3px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.04)'
          : 'inset 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 0 rgba(255, 255, 255, 0.8)',
        border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(10, 10, 12, 0.12)',
        transition: 'background 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease',
      }}>
      {/* the sun and the moon in the track */}
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-between px-[9px]">
        <Sun size={13} style={{ color: isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(10, 10, 12, 0.4)' }} />
        <Moon size={13} style={{ color: isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(10, 10, 12, 0.4)' }} />
      </span>
      {/* the thumb: springs across, a little past and back */}
      <motion.span aria-hidden="true"
        className="relative z-10 flex h-[26px] w-[26px] items-center justify-center rounded-full overflow-hidden"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.1))'
            : 'linear-gradient(180deg, #ffffff, #f4f4f5)',
          boxShadow: isDark
            ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 4px 12px -2px rgba(0, 0, 0, 0.8)'
            : 'inset 0 0 0 1px rgba(10, 10, 12, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.25)',
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        }}
        initial={false}
        animate={{ x: isDark ? 30 : 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
        {particles.map(p => (
          <motion.span key={p.id} className="absolute rounded-full pointer-events-none" style={{
            width: 8, height: 8,
            // (the burst in the palette colour)
            background: isDark
              ? 'radial-gradient(circle, rgba(200,255,0,0.45) 0%, rgba(200,255,0,0) 70%)'
              : 'radial-gradient(circle, rgba(120,160,0,0.45) 0%, rgba(120,160,0,0) 70%)',
          }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: isDark ? 5 : 6, opacity: [0, 1, 0] }}
            transition={{ duration: isDark ? 0.5 : p.duration, delay: p.delay, ease: 'easeOut' }} />
        ))}
        <span className="relative z-10">
          {isDark ? <Moon size={13} style={{ color: '#c8ff00' }} /> : <Sun size={13} style={{ color: '#4a6100' }} />}
        </span>
      </motion.span>
    </motion.button>
  )
}
