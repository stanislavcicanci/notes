
import './globals.css'
import Eruda from './Eruda'

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
        <Eruda />
      </body>
    </html>
  )
}
