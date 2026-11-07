
'use client'

import Script from 'next/script'

export default function Eruda() {
  return (
    <Script
      src="https://cdn.jsdelivr.net/npm/eruda"
      strategy="afterInteractive"
      onLoad={() => window.eruda.init()}
    />
  )
}
