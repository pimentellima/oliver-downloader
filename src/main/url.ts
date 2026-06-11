const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/

export function sanitizeYoutubeUrl(input: string): { videoId: string; canonicalUrl: string } {
  const value = input.trim()

  if (VIDEO_ID_RE.test(value)) {
    return toCanonical(value)
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Cole uma URL valida do YouTube.')
  }

  const hostname = url.hostname.replace(/^www\./, '').toLowerCase()
  let videoId: string | null = null

  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? null
  }

  if (hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v')
    } else if (url.pathname.startsWith('/shorts/')) {
      videoId = url.pathname.split('/').filter(Boolean)[1] ?? null
    } else if (url.pathname.startsWith('/embed/')) {
      videoId = url.pathname.split('/').filter(Boolean)[1] ?? null
    }
  }

  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    throw new Error('Use um link de vídeo único do YouTube. Playlists, canais e lives não entram na v1.')
  }

  return toCanonical(videoId)
}

function toCanonical(videoId: string): { videoId: string; canonicalUrl: string } {
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
  }
}
