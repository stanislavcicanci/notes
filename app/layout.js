
import './globals.css'
import Script from 'next/script'

export const metadata = {
    title: 'NoteS',
    description: 'Infinite notes canvas'
}

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false
}

export default function L({ children }) {
return (
    <html lang="en">
        <body>
        {children}

        {process.env.NODE_ENV === 'development' && (
            <Script
            src="https://cdn.jsdelivr.net/npm/eruda"
            strategy="afterInteractive"
            onLoad={() => window.eruda.init()}
            />
        )}
    </body>
    </html>
)
}
