'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import type { Video } from '@chai-cut/shared'
import { ACCEPTED_VIDEO_EXTENSIONS } from '@chai-cut/shared'
import { useVideoUpload } from '@/modules/upload/useVideoUpload'
import { VideoPartChooser, type VideoPart } from './VideoPartChooser'
import { PhotoCropper, bakePhoto, NO_PHOTO_EDIT, type PhotoEdit } from './PhotoCropper'

interface Props {
  clipId: string
  atMs: number
  /** `part`: the part of it picked to go in (absent: the whole video) */
  onInsertVideo: (videoId: string, part?: VideoPart) => void
  onInsertImage: (storagePath: string, url: string) => void
  onClose: () => void
  /** Which tab to open on (e.g. photos when filling a frame's photo slot) */
  initialTab?: 'videos' | 'upload' | 'image'
  /** Offer only videos (your videos + upload) or only a photo — e.g. for a frame's video or photo slot */
  only?: 'video' | 'photo'
  /** A video picked or uploaded is played first to pick the part that goes in (a frame's slot);
   *  `roomMs`: how long it can play there (null: no limit) */
  pickPart?: { roomMs: number | null }
}

type Tab = 'videos' | 'upload' | 'image'
type LibraryVideo = Video & { is_upload_asset?: boolean; is_asset?: boolean; video_url?: string | null }

function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function MediaPickerModal({ clipId, atMs, onInsertVideo, onInsertImage, onClose, initialTab, only, pickPart }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'videos')
  // Your uploads (B-roll added from this computer before) first, then your videos
  const [videos, setVideos] = useState<LibraryVideo[]>([])
  const [loadingVideos, setLoadingVideos] = useState(true)

  // Upload video from device: the same resumable upload as the dashboard (plan limits checked,
  // straight to storage), then the new video goes into the slot
  const [videoFile, setVideoFile] = useState<File | null>(null)
  // An upload here is B-roll: saved as an asset, so it stays off the dashboard and the plan's video count
  const upload = useVideoUpload(videoId => {
    // (the file just uploaded plays from the computer while its part is picked)
    if (pickPart && videoFile) setPicked({ id: videoId, url: URL.createObjectURL(videoFile), duration_ms: null, local: true })
    else onInsertVideo(videoId)
  }, { asset: true })
  const videoUploading = upload.state.phase === 'uploading' || upload.state.phase === 'finishing'
  const videoProgress = upload.state.progress
  const videoError = upload.state.phase === 'failed' ? upload.state.error : null
  const videoInputRef = useRef<HTMLInputElement>(null)
  // Closing mid-upload would cancel it, so the backdrop and ✕ wait until it's done
  const safeClose = () => { if (!videoUploading) onClose() }

  // The video picked or uploaded, while its part is picked (pickPart)
  const [picked, setPicked] = useState<{ id: string; url: string; duration_ms: number | null; local?: boolean } | null>(null)
  useEffect(() => () => { if (picked?.local) URL.revokeObjectURL(picked.url) }, [picked])
  function pickVideo(v: LibraryVideo) {
    if (pickPart && v.video_url) setPicked({ id: v.id, url: v.video_url, duration_ms: v.duration_ms })
    else onInsertVideo(v.id)
  }

  // Upload image from device
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  // Its crop and mirror, made into the photo before it's uploaded (PhotoCropper)
  const [imageEdit, setImageEdit] = useState<PhotoEdit>(NO_PHOTO_EDIT)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/videos?assets=1')
      .then(r => r.json())
      .then(({ videos }) => {
        // Stock clips (also assets) are picked from Stock, not here
        const all = ((videos ?? []) as LibraryVideo[])
          .filter(v => v.status === 'ready')
        setVideos([...all.filter(v => v.is_upload_asset), ...all.filter(v => !v.is_asset)])
        setLoadingVideos(false)
      })
      .catch(() => setLoadingVideos(false))
  }, [])

  // ── Upload video from device ─────────────────────────────────────────────
  function handleVideoUpload() {
    if (!videoFile) return
    if (upload.state.phase === 'failed' && upload.state.canRetry) { upload.retry(); return }
    upload.start(videoFile)
  }

  // ── Upload image from device ─────────────────────────────────────────────
  function handleImageFile(f: File) {
    if (!f.type.startsWith('image/')) return
    setImageFile(f)
    setImagePreview(URL.createObjectURL(f))
    setImageEdit(NO_PHOTO_EDIT)
    setImageError(null)
  }

  async function handleImageUpload() {
    if (!imageFile) return
    setImageUploading(true)
    setImageError(null)
    try {
      const form = new FormData()
      // (a GIF goes in as it is: cropping it would stop it moving)
      form.append('file', imageFile.type === 'image/gif' ? imageFile : await bakePhoto(imageFile, imageEdit))
      const res = await fetch('/api/overlays/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed')
      const { storage_path, preview_url } = await res.json()
      onInsertImage(storage_path, preview_url ?? '')
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Upload failed')
      setImageUploading(false)
    }
  }

  const ALL_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'videos', label: 'My Videos',
      icon: <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2h6a1 1 0 0 1 1 1v1.5l2-1.5v6l-2-1.5V9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.2"/></svg>,
    },
    {
      id: 'upload', label: 'Upload Video',
      icon: <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 8V2M3 5l3-3 3 3M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
    {
      id: 'image', label: 'Image',
      icon: <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="4" cy="4" r="1" fill="currentColor"/><path d="M1 8l3-3 2 2 2-2.5L11 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
  ]
  const TABS = ALL_TABS.filter(t => !only || (only === 'photo' ? t.id === 'image' : t.id !== 'image'))

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[120] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === backdropRef.current) safeClose() }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{ width: 400, maxHeight: '72vh', background: '#1c1c1c', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 32px 80px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-2">
          <div>
            <p className="text-sm font-bold text-white">{only === 'video' ? 'Add a video' : only === 'photo' ? 'Add a photo' : 'Insert media'}</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>at {msToLabel(atMs)}</p>
          </div>
          <button onClick={safeClose} disabled={videoUploading} aria-label="Close" title={videoUploading ? 'Wait for the upload to finish' : 'Close'}
            className="flex items-center justify-center rounded-xl disabled:opacity-40" style={{ width: 30, height: 30, background: 'rgba(255,255,255,0.07)' }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Tabs (hidden when there's only one kind to pick) */}
        <div className="shrink-0 flex px-3 pb-3 gap-1.5" style={TABS.length < 2 || picked ? { display: 'none' } : undefined}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: tab === t.id ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
                color: tab === t.id ? '#fff' : 'rgba(255,255,255,0.45)',
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

        {/* ── The part of the picked video that goes in ───────────────────── */}
        {picked && (
          <VideoPartChooser key={picked.id} url={picked.url} durationMs={picked.duration_ms} roomMs={pickPart?.roomMs ?? null}
            onConfirm={part => onInsertVideo(picked.id, part)}
            onWhole={() => onInsertVideo(picked.id)}
            onBack={() => { setPicked(null); if (picked.local) { upload.cancel(); setVideoFile(null) } }} />
        )}

        {/* ── My Videos tab ─────────────────────────────────────────────── */}
        {!picked && tab === 'videos' && (
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
            {loadingVideos && <p className="text-xs text-center py-10" style={{ color: 'rgba(255,255,255,0.25)' }}>Loading…</p>}
            {!loadingVideos && videos.length === 0 && (
              <div className="py-10 text-center flex flex-col gap-2">
                <p className="text-sm font-medium text-white">No uploaded videos</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
                  Upload a video from the Upload tab or the Dashboard to use it here as a clip.
                </p>
                <button onClick={() => setTab('upload')} className="mx-auto mt-2 px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: '#c8ff00', color: '#000' }}>
                  Upload video
                </button>
              </div>
            )}
            {videos.map((v, i) => (<div key={v.id} className="contents">
              {/* A heading over each group */}
              {(i === 0 || !!videos[i - 1].is_upload_asset !== !!v.is_upload_asset) && (
                <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {v.is_upload_asset ? 'Your uploads' : 'Your videos'}
                </p>
              )}
              <div className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="shrink-0 flex items-center justify-center rounded-lg" style={{ width: 56, height: 40, background: '#111' }}>
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" opacity={0.35}><path d="M5 3l13 7-13 7V3z" fill="white"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate" title={v.title ?? undefined}>{v.title?.trim() || `Video ${i + 1}`}</p>
                  {v.duration_ms != null && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{msToLabel(v.duration_ms)}</p>}
                </div>
                <button
                  onClick={() => pickVideo(v)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: 'rgba(200,255,0,0.14)', color: '#c8ff00', border: '1px solid rgba(200,255,0,0.35)' }}
                >
                  Insert
                </button>
              </div>
            </div>))}
          </div>
        )}

        {/* ── Upload Video tab ───────────────────────────────────────────── */}
        {!picked && tab === 'upload' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <input ref={videoInputRef} type="file" accept={ACCEPTED_VIDEO_EXTENSIONS.join(',')} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { upload.cancel(); setVideoFile(f) } }} />

            {!videoFile ? (
              <button
                onClick={() => videoInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl py-12"
                style={{ border: '2px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="w-12 h-12 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 16V8M8 12l4-4 4 4M4 20h16" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">Choose video from device</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>MP4, MOV, WebM, MKV</p>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="w-10 h-10 flex items-center justify-center rounded-lg" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M5 3l13 7-13 7V3z" fill="rgba(255,255,255,0.7)"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{videoFile.name}</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <button onClick={() => { upload.cancel(); setVideoFile(null) }} aria-label="Remove this file"
                  className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>✕</button>
              </div>
            )}

            {videoUploading && (
              <div>
                <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <span>Uploading…</span><span>{videoProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${videoProgress}%`, background: '#c8ff00' }} />
                </div>
              </div>
            )}

            {videoError && <p className="text-xs" style={{ color: '#f87171' }}>{videoError}</p>}

            <button
              onClick={handleVideoUpload}
              disabled={!videoFile || videoUploading || (upload.state.phase === 'failed' && !upload.state.canRetry)}
              className="py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
              style={{ background: '#c8ff00', color: '#000', marginTop: 'auto' }}
            >
              {upload.state.phase === 'finishing' ? 'Finishing…'
                : videoUploading ? `Uploading ${videoProgress}%…`
                : upload.state.phase === 'failed' && upload.state.canRetry ? `Retry from ${videoProgress}%`
                : pickPart ? 'Upload & pick the part' : 'Upload & insert'}
            </button>
          </div>
        )}

        {/* ── Image tab ─────────────────────────────────────────────────── */}
        {!picked && tab === 'image' && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]) }} />

            {!imagePreview ? (
              <button
                onClick={() => imageInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl py-12"
                style={{ border: '2px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}
              >
                <div className="w-12 h-12 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="3" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6"/>
                    <circle cx="8.5" cy="8.5" r="2" fill="rgba(255,255,255,0.7)"/>
                    <path d="M3 15l5-5 4 4 3-3.5L21 15" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">Choose image from gallery</p>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>JPG, PNG, WebP, GIF</p>
                </div>
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                {imageFile?.type !== 'image/gif' ? (
                  <div className="relative">
                    <PhotoCropper src={imagePreview} value={imageEdit} onChange={setImageEdit} />
                    <button
                      onClick={() => { setImageFile(null); setImagePreview(null) }}
                      aria-label="Remove this photo"
                      className="absolute top-2 right-2 flex items-center justify-center rounded-full"
                      style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)' }}
                    >
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="white" strokeWidth="1.6" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                ) : (
                <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '16/9', background: '#111' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="preview" className="w-full h-full object-contain" />
                  <button
                    onClick={() => { setImageFile(null); setImagePreview(null) }}
                    className="absolute top-2 right-2 flex items-center justify-center rounded-full"
                    style={{ width: 26, height: 26, background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)' }}
                  >
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="white" strokeWidth="1.6" strokeLinecap="round"/></svg>
                  </button>
                </div>
                )}
                <div className="flex items-center gap-2">
                  <p className="text-xs flex-1 truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{imageFile?.name}</p>
                  <button onClick={() => imageInputRef.current?.click()} className="text-xs shrink-0" style={{ color: '#c8ff00' }}>Change</button>
                </div>
              </div>
            )}

            {imageError && <p className="text-xs" style={{ color: '#f87171' }}>{imageError}</p>}

            <button
              onClick={handleImageUpload}
              disabled={!imageFile || imageUploading}
              className="py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
              style={{ background: '#c8ff00', color: '#000', marginTop: 'auto' }}
            >
              {imageUploading ? 'Uploading…' : 'Insert image'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
