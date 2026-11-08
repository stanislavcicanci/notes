'use client'
import { useState, useRef, useEffect, useCallback, useMemo, memo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Type, MousePointer2, Undo2, Redo2, Download, Upload, Plus, Trash2, Copy, Check,
  Bold, Italic, Underline, Minus, Maximize, Home, X, GripHorizontal, Search,
  Palette, Focus, StickyNote, ArrowRight, ArrowDown, AlertTriangle, Highlighter, ChevronDown, Edit3
} from 'lucide-react'

/* ============================================================
   CONSTANTS
   ============================================================ */
const G = '#42A879'
const KEY = 'notes-workspace-v38'
const COLORS = ['#42A879', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444', '#202522']
const TXT_COLORS = ['#202522', '#42A879', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444']
const HIGHLIGHTS = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE', 'transparent']
const MIN_Z = 0.1
const MAX_Z = 3
const TAP_SLOP = { touch: 8, pen: 8, mouse: 3 } // px of movement before a tap becomes a pan/drag
const uid = () => Math.random().toString(36).slice(2, 9)
const clampZ = z => Math.min(MAX_Z, Math.max(MIN_Z, z))

/* ============================================================
   HELPERS & SANITIZER
   ============================================================ */
function hasText(html) {
  if (!html) return false
  if (typeof document === 'undefined') return html.length > 0
  try {
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    return (tmp.textContent || '').trim().length > 0
  } catch { return false }
}

function sanitizeHtml(html) {
  if (typeof document === 'undefined') return html
  try {
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    const ALLOWED = new Set([
      'B', 'I', 'U', 'S', 'STRONG', 'EM', 'BR', 'DIV', 'P', 'SPAN',
      'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'MARK', 'SUB', 'SUP', 'FONT'
    ])
    const walk = node => {
      ;[...node.childNodes].forEach(child => {
        if (child.nodeType === 1) {
          if (!ALLOWED.has(child.tagName)) {
            child.replaceWith(document.createTextNode(child.textContent || ''))
            return
          }
          ;[...child.attributes].forEach(attr => {
            if (attr.name === 'style') {
              const keep = []
              const st = child.style
              if (st.color) keep.push(`color:${st.color}`)
              if (st.backgroundColor) keep.push(`background-color:${st.backgroundColor}`)
              if (st.fontSize) keep.push(`font-size:${st.fontSize}`)
              if (st.fontWeight) keep.push(`font-weight:${st.fontWeight}`)
              if (st.fontStyle) keep.push(`font-style:${st.fontStyle}`)
              if (st.textDecoration) keep.push(`text-decoration:${st.textDecoration}`)
              if (keep.length) child.setAttribute('style', keep.join(';'))
              else child.removeAttribute('style')
            } else if (attr.name === 'color' || attr.name === 'size') {
              if (child.tagName !== 'FONT') child.removeAttribute(attr.name)
            } else {
              child.removeAttribute(attr.name)
            }
          })
          walk(child)
        }
      })
    }
    walk(tpl.content)
    return tpl.innerHTML
  } catch (e) {
    return ''
  }
}

function normalizeProjectTopics(rawTopics) {
  if (!Array.isArray(rawTopics) || rawTopics.length > 10000) throw new Error('Invalid topics')
  const ids = new Set()
  const cleanText = value => typeof value === 'string' ? sanitizeHtml(value) : ''
  return rawTopics.map((t, i) => {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' ||
        !Number.isFinite(t.x) || !Number.isFinite(t.y) || !Array.isArray(t.subs)) {
      throw new Error('Invalid topic structure')
    }
    if (ids.has(t.id)) throw new Error('Duplicate topic id')
    ids.add(t.id)
    const subs = t.subs.slice(0, 3)
    while (subs.length < 3) subs.push(null)
    return {
      ...t,
      id: t.id,
      x: Math.max(-1000000, Math.min(1000000, t.x)),
      y: Math.max(-1000000, Math.min(1000000, t.y)),
      title: cleanText(t.title),
      color: COLORS.includes(t.color) ? t.color : G,
      role: t.role === 'comment' ? 'comment' : (i === 0 ? 'topic' : 'comment'),
      lineageId: typeof t.lineageId === 'string' ? t.lineageId : t.id,
      subs: subs.map(sub => {
        if (sub == null) return null
        if (typeof sub !== 'object' || typeof sub.id !== 'string' || !Array.isArray(sub.notes)) {
          throw new Error('Invalid subtopic')
        }
        return {
          id: sub.id,
          html: cleanText(sub.html),
          notes: sub.notes.slice(0, 1000).map(note => {
            if (!note || typeof note.id !== 'string') throw new Error('Invalid note')
            return { id: note.id, html: cleanText(note.html) }
          })
        }
      })
    }
  })
}

/* ============================================================
   FACTORIES
   ============================================================ */
const mkSub = () => ({ id: uid(), html: '', notes: [] })
const mkNode = (x, y, { title = '', color = G, role = 'topic', lineageId = null } = {}) => {
  const id = uid()
  return {
    id, x, y, title, color, role,
    lineageId: lineageId || id,
    subs: [null, null, null]
  }
}
const cloneNode = (t, dx = 40) => {
  const newId = uid()
  return {
    ...t, id: newId, x: t.x + dx, lineageId: newId,
    subs: t.subs.map(s => s ? { ...s, id: uid(), notes: s.notes.map(n => ({ ...n, id: uid() })) } : null)
  }
}

/* ============================================================
   GLOBAL STYLES
   ============================================================ */
function GlobalStyles() {
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        html, body {
          height: 100%; margin: 0; padding: 0;
          overscroll-behavior: none;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        button:focus-visible, input:focus-visible, [contenteditable]:focus-visible { outline: 2px solid #42A879; outline-offset: 2px; }
        [data-editable="true"], [data-editable="true"] * {
          user-select: text !important; -webkit-user-select: text !important; overflow-wrap: anywhere;
        }
        body { overflow: hidden; }
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #B0B7B2;
          pointer-events: none;
        }
        [contenteditable] h1 { font-size: 32px; font-weight: 700; margin: 0.2em 0; }
        [contenteditable] h2 { font-size: 24px; font-weight: 600; margin: 0.2em 0; }
        [contenteditable] h3 { font-size: 20px; font-weight: 600; margin: 0.2em 0; }
        [contenteditable] b, [contenteditable] strong { font-weight: 700; }
        [contenteditable] i, [contenteditable] em { font-style: italic; }
        [contenteditable] u { text-decoration: underline; }
        [contenteditable] s, [contenteditable] strike { text-decoration: line-through; }
        [contenteditable] ul, [contenteditable] ol { padding-left: 1.2em; margin: 0.2em 0; }
        [contenteditable] p { margin: 0.15em 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #DDE4DF; border-radius: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </>
  )
}

/* ============================================================
   EDITABLE
   ============================================================ */
const Editable = memo(function Editable({ html, onSave, onEditStart, targetId, highlighted = false, className = '', placeholder = '', readOnly = false }) {
  const ref = useRef(null)
  const lastSavedHtml = useRef(html || '')
  const isFocused = useRef(false)
  const timer = useRef(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    if (!isFocused.current && ref.current.innerHTML !== (html || '')) {
      ref.current.innerHTML = html || ''
      lastSavedHtml.current = html || ''
    }
  }, [html])

  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!ref.current) return
    const currentHtml = sanitizeHtml(ref.current.innerHTML || '')
    if (currentHtml !== lastSavedHtml.current) {
      lastSavedHtml.current = currentHtml
      onSave(currentHtml)
    }
  }, [onSave])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <div
      ref={ref}
      id={targetId ? `editable-${targetId}` : undefined}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck={!readOnly}
      role="textbox"
      aria-multiline="true"
      data-editable={!readOnly}
      data-placeholder={placeholder}
      className={`focus:outline-none ${highlighted ? 'rounded-sm ring-2 ring-[#42A879] bg-[#42A879]/10' : ''} ${readOnly ? 'pointer-events-none' : ''} ${className}`}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onFocus={() => {
        if (!readOnly && !isFocused.current) {
          isFocused.current = true
          onEditStart?.()
        }
      }}
      onInput={() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(commit, 500)
      }}
      onBlur={() => {
        commit()
        isFocused.current = false
      }}
      onPaste={e => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
      }}
    />
  )
})

/* ============================================================
   BUTTONS
   ============================================================ */
const Btn = ({ onClick, children, active, title, disabled }) => (
  <motion.button
    whileTap={{ scale: 0.9 }}
    title={title} disabled={disabled} onClick={onClick}
    className={`h-9 w-9 grid place-items-center rounded-lg transition-all shrink-0 select-none outline-none focus:outline-none focus:ring-0 ${
      disabled ? 'opacity-30 cursor-not-allowed' : ''
    } ${
      active 
        ? 'text-white !bg-[#42A879] shadow-sm hover:!bg-[#42A879]' 
        : 'text-[#202522] hover:bg-[#F7FAF8]'
    }`}
  >{children}</motion.button>
)

const FmtBtn = ({ onClick, children, active, title }) => (
  <motion.button
    whileTap={{ scale: 0.9 }}
    onMouseDown={e => e.preventDefault()}
    onClick={onClick} title={title}
    className={`h-8 w-8 grid place-items-center rounded-md transition-colors shrink-0 outline-none focus:outline-none focus:ring-0 ${
      active 
        ? 'text-white !bg-[#42A879] shadow-sm hover:!bg-[#42A879]' 
        : 'text-[#202522] hover:bg-[#F0F4F1]'
    }`}
  >{children}</motion.button>
)

/* ============================================================
   PREMIUM SELECT COMPONENT
   ============================================================ */
function PremiumSelect({ value, onChange, options, icon, label, width = "min-w-[80px]" }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selectedLabel = options.find(o => o.value === value)?.label || label

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(!open)}
        className={`h-8 ${width} px-2 flex items-center justify-between gap-1 rounded-md hover:bg-[#F0F4F1] text-[#202522] transition-colors text-sm font-medium outline-none focus:outline-none focus:ring-0`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {icon}
          <span className="truncate">{selectedLabel}</span>
        </div>
        <ChevronDown size={12} className={`text-[#8B928E] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-1 w-full min-w-[120px] bg-white border border-[#DDE4DF] rounded-lg shadow-xl overflow-hidden z-[10001] py-1"
          >
            {options.map(opt => (
              <button
                key={opt.value}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  value === opt.value ? 'bg-[#42A879]/10 text-[#42A879] font-medium' : 'text-[#202522] hover:bg-[#F7FAF8]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ============================================================
   PREMIUM COLOR PICKER
   ============================================================ */
function ColorPicker({ colors, onChange, icon, title }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(!open)}
        className={`h-8 w-8 grid place-items-center rounded-md hover:bg-[#F0F4F1] transition-colors relative outline-none focus:outline-none focus:ring-0 ${open ? 'bg-[#F0F4F1]' : ''}`}
        title={title}
      >
        {icon}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1 p-2 bg-white border border-[#DDE4DF] rounded-xl shadow-xl grid grid-cols-4 gap-1.5 z-[10001]"
          >
            {colors.map(c => (
              <button
                key={c}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(c); setOpen(false) }}
                className="h-6 w-6 rounded-full border border-black/5 shadow-sm hover:scale-110 transition-transform outline-none focus:outline-none focus:ring-0"
                style={{
                  background: c === 'transparent' ? 'repeating-linear-gradient(45deg,#fff,#fff 3px,#eee 3px,#eee 6px)' : c
                }}
                title={c === 'transparent' ? 'Clear' : c}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ============================================================
   SELECTION TOOLBAR
   ============================================================ */
function SelectionToolbar() {
  const [state, setState] = useState(null)
  const [marks, setMarks] = useState({})
  const editableRef = useRef(null)
  const debounce = useRef(null)

  const queryMarks = () => {
    try {
      setMarks({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough')
      })
    } catch {}
  }

  useEffect(() => {
    const update = () => {
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          setState(null); editableRef.current = null; return
        }
        const range = sel.getRangeAt(0)
        let node = range.commonAncestorContainer
        if (node.nodeType === 3) node = node.parentNode
        const editable = node.closest?.('[data-editable="true"]')
        if (!editable) { setState(null); editableRef.current = null; return }
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) { setState(null); return }
        editableRef.current = editable
        setState({ x: rect.left + rect.width / 2, y: rect.top })
        queryMarks()
      }, 30)
    }
    document.addEventListener('selectionchange', update)
    return () => {
      document.removeEventListener('selectionchange', update)
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [])

  const run = (cmd, val = null) => {
    document.execCommand(cmd, false, val)
    queryMarks()
  }

  const close = () => {
    if (editableRef.current) {
      editableRef.current.blur()
    }
    setState(null)
    editableRef.current = null
  }

  if (!state || typeof document === 'undefined') return null
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const left = Math.max(8, Math.min(vw - 460, state.x - 230))
  const top = Math.max(8, state.y - 60)

  const formatOptions = [
    { label: 'Body Text', value: 'p' },
    { label: 'Heading 1', value: 'h1' },
    { label: 'Heading 2', value: 'h2' },
    { label: 'Heading 3', value: 'h3' },
  ]

  const sizeOptions = [
    { label: '12px', value: '12px' },
    { label: '14px', value: '14px' },
    { label: '16px', value: '16px' },
    { label: '20px', value: '20px' },
    { label: '24px', value: '24px' },
    { label: '32px', value: '32px' },
    { label: '40px', value: '40px' },
  ]

  const applyFontSize = (size) => {
    if (!editableRef.current) return
    document.execCommand('fontSize', false, '7')
    const fontElements = editableRef.current.querySelectorAll('font[size="7"]')
    fontElements.forEach(el => {
      el.removeAttribute('size')
      el.style.fontSize = size
    })
    queryMarks()
  }

  return createPortal(
    <motion.div
      data-ui
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.15 }}
      onMouseDown={e => e.preventDefault()} 
      onPointerDown={e => e.stopPropagation()}
      style={{ position: 'fixed', left, top, zIndex: 10000 }}
      className="flex items-center gap-0.5 bg-white border border-[#DDE4DF] rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-1 max-w-[96vw] overflow-visible text-[#202522]"
    >
      <FmtBtn active={marks.bold} title="Bold" onClick={() => run('bold')}><Bold size={15} /></FmtBtn>
      <FmtBtn active={marks.italic} title="Italic" onClick={() => run('italic')}><Italic size={15} /></FmtBtn>
      <FmtBtn active={marks.underline} title="Underline" onClick={() => run('underline')}><Underline size={15} /></FmtBtn>
      <FmtBtn active={marks.strike} title="Strike" onClick={() => run('strikeThrough')}>
        <span className="text-[13px] font-semibold line-through">S</span>
      </FmtBtn>

      <div className="w-px h-5 bg-[#DDE4DF] mx-1 shrink-0" />

      <PremiumSelect
        options={formatOptions}
        label="Body Text"
        icon={<Type size={14} className="text-[#8B928E]" />}
        value=""
        onChange={val => run('formatBlock', val)}
        width="min-w-[100px]"
      />

      <ColorPicker
        colors={TXT_COLORS}
        onChange={c => run('foreColor', c)}
        title="Text Color"
        icon={
          <div className="flex flex-col items-center">
            <span className="text-[13px] font-bold leading-none">A</span>
            <span className="w-3 h-1 rounded-sm mt-0.5" style={{ background: G }} />
          </div>
        }
      />

      <ColorPicker
        colors={HIGHLIGHTS}
        onChange={c => run('hiliteColor', c)}
        title="Highlight"
        icon={
          <div className="relative">
            <Highlighter size={15} className="text-[#202522]" />
            <span className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-yellow-400 border border-white" />
          </div>
        }
      />

      <PremiumSelect
        options={sizeOptions}
        label="Size"
        value=""
        onChange={applyFontSize}
        width="min-w-[80px]"
      />

      <div className="w-px h-5 bg-[#DDE4DF] mx-1 shrink-0" />
      <FmtBtn title="Close editor" onClick={close}><X size={15} /></FmtBtn>
    </motion.div>,
    document.body
  )
}

/* ============================================================
   NODE CARD
   Pointer handling for the card lives ONLY in the canvas gesture
   engine (Page). The card just exposes data-node so the engine can
   find it.
   ============================================================ */
const NodeRow = memo(function NodeRow({
  t, isSel, isFresh, searchHit, isMobileEditing, isMobile,
  onFocus, onDup, onDelete,
  onChangeColor, onTitleSave, onSubSave, onSubAdd, onSubDelete,
  onNoteAdd, onNoteSave, onNoteDelete, onEditStart,
  onAddRight, onAddBelow
}) {
  const accent = t.color || G
  const isComment = t.role === 'comment'
  const titlePlaceholder = isComment ? 'Comment…' : 'Topic title…'
  const titleReady = hasText(t.title)

  return (
    <motion.div
      id={t.id}
      data-node={t.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      onDoubleClick={() => !isMobile && onFocus(t)}
      style={{
        position: 'absolute', left: t.x, top: t.y,
        borderColor: accent,
        borderWidth: isFresh ? 3 : undefined,
        boxShadow: isFresh
          ? `0 0 0 4px ${accent}, 0 0 0 12px ${accent}33`
          : isSel ? `0 0 0 4px ${accent}33` : '0 1px 3px rgba(0,0,0,0.04)',
        zIndex: isSel ? 20 : 10
      }}
      className={`w-max max-w-[90vw] bg-white ${isComment ? 'border rounded-lg p-3' : 'border-2 rounded-xl p-4'} ${
        isMobile && !isMobileEditing ? 'cursor-pointer' : 'cursor-move'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <GripHorizontal size={14} className="text-[#8B928E] cursor-move shrink-0" />
        <span
          className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
          style={{ background: `${accent}15`, color: accent }}
        >
          {isComment ? 'Comment' : 'Topic'}
        </span>
        {isFresh && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded text-white" style={{ background: accent }}>
            New
          </span>
        )}
        {!titleReady && (
          <span className="text-[9px] text-[#B0B7B2] italic">write a title first…</span>
        )}
        <div className="flex-1" />
        {isMobile && !isMobileEditing ? (
          isSel && (
            <button
              onClick={() => onFocus(t)}
              className="flex items-center justify-center gap-1 px-3 h-8 rounded-full text-white shadow-lg animate-bounce"
              style={{ background: G, zIndex: 30 }}
            >
              <Edit3 size={14} /> Edit
            </button>
          )
        ) : (
          <>
            <button title="Focus" onClick={() => onFocus(t)} className="p-1" style={{ color: '#8B928E' }}>
              <Focus size={14} />
            </button>
            <button title="Duplicate" onClick={() => onDup(t)} className="p-1" style={{ color: '#8B928E' }}>
              <Copy size={14} />
            </button>
            <button title="Delete" onClick={() => onDelete(t.id)} className="p-1" style={{ color: '#8B928E' }}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      <div className="flex items-start gap-1 mb-3">
        <Editable
          html={t.title}
          targetId={t.id}
          highlighted={searchHit === t.id}
          onEditStart={onEditStart}
          onSave={h => onTitleSave(t.id, h)}
          readOnly={isMobile && !isMobileEditing}
          className={`${isComment ? 'text-base' : 'text-xl'} font-semibold min-w-[120px] flex-1 cursor-text`}
          placeholder={titlePlaceholder}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch min-h-[100px]">
        {t.subs.map((s, si) => {
          const subReady = s ? hasText(s.html) : false
          return (
            <div
              key={s ? s.id : `empty-${si}`}
              className="group/sub pl-3 py-1 flex flex-col rounded-sm min-w-0"
              style={{ borderLeft: `2px dashed ${accent}33` }}
            >
              {s ? (
                <>
                  <div className="flex items-start gap-1">
                    <Editable
                      html={s.html}
                      targetId={s.id}
                      highlighted={searchHit === s.id}
                      onEditStart={onEditStart}
                      onSave={h => onSubSave(t.id, s.id, h)}
                      readOnly={isMobile && !isMobileEditing}
                      className={`flex-1 ${isComment ? 'text-[13px]' : 'text-[15px]'} min-h-[22px] cursor-text font-medium`}
                      placeholder="Subtopic…"
                    />
                    <button
                      title="Delete subtopic"
                      onClick={() => onSubDelete(t.id, s.id)}
                      className={`text-[#8B928E] hover:text-red-500 shrink-0 min-w-8 min-h-8 grid place-items-center ${isMobile && !isMobileEditing ? 'hidden' : 'opacity-100 sm:opacity-0 sm:group-hover/sub:opacity-100'}`}
                    ><X size={12} /></button>
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {s.notes.map(n => (
                      <div key={n.id}
                        className="rounded-md border px-2 py-1 text-xs flex gap-1 items-start group/note"
                        style={{ background: `${accent}0d`, borderColor: `${accent}33` }}
                      >
                        <StickyNote size={11} className="mt-0.5 shrink-0" style={{ color: accent }} />
                        <Editable
                          html={n.html}
                          targetId={n.id}
                          highlighted={searchHit === n.id}
                          onEditStart={onEditStart}
                          onSave={h => onNoteSave(t.id, s.id, n.id, h)}
                          readOnly={isMobile && !isMobileEditing}
                          className="flex-1 min-h-[16px] cursor-text"
                          placeholder="Note"
                        />
                        <button
                          onClick={() => onNoteDelete(t.id, s.id, n.id)}
                          className={`text-[#8B928E] hover:text-red-500 shrink-0 min-w-8 min-h-8 grid place-items-center ${isMobile && !isMobileEditing ? 'hidden' : 'opacity-100 sm:opacity-0 sm:group-hover/note:opacity-100'}`}
                        ><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                  {(!isMobile || isMobileEditing) && (
                    <button
                      onClick={() => onNoteAdd(t.id, s.id)}
                      disabled={!subReady}
                      title={subReady ? 'Add another note' : 'Write the subtopic first'}
                      className={`mt-2 flex items-center gap-1 text-xs ${subReady ? 'hover:opacity-100' : 'opacity-30 cursor-not-allowed'}`}
                      style={{ color: accent }}
                    >
                      <Plus size={12} /> note
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => onSubAdd(t.id, si)}
                  disabled={!titleReady || (isMobile && !isMobileEditing)}
                  title={titleReady ? 'Add subtopic here' : 'Write a title first'}
                  className="flex-1 min-h-[90px] flex flex-col items-center justify-center gap-1 rounded-md border border-dashed transition-colors"
                  style={{
                    color: titleReady ? accent : '#B0B7B2',
                    borderColor: 'transparent',
                    cursor: titleReady && (!isMobile || isMobileEditing) ? 'pointer' : 'not-allowed',
                    opacity: titleReady && (!isMobile || isMobileEditing) ? 1 : 0.4
                  }}
                  onMouseEnter={e => {
                    if (titleReady && (!isMobile || isMobileEditing)) {
                      e.currentTarget.style.borderColor = accent
                      e.currentTarget.style.background = `${accent}0d`
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'transparent'
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <Plus size={16} />
                  <span className="text-[10px]">
                    {titleReady ? 'subtopic' : 'title first'}
                  </span>
                </button>
              )}
            </div>
          )
        })}
      </div>

      {(!isMobile || isMobileEditing) && (
        <>
          <div className="flex items-center gap-1 mt-3 pt-2 border-t" style={{ borderColor: `${accent}22` }}>
            <Palette size={12} className="mr-1" style={{ color: '#8B928E' }} />
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => onChangeColor(t.id, c)}
                className="h-4 w-4 rounded-full border border-white shadow-sm hover:scale-125 transition-transform"
                style={{ background: c, outline: t.color === c ? `1.5px solid ${c}` : 'none', outlineOffset: 1 }}
              />
            ))}

            <div className="flex-1" />

            <motion.button
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              onClick={() => onAddRight(t.id)}
              disabled={!titleReady}
              title={titleReady ? 'Add new comment to the right' : 'Write a title first'}
              className="h-8 px-2 rounded-md border-2 border-dashed flex items-center gap-1 text-xs transition-colors outline-none focus:outline-none focus:ring-0"
              style={{
                borderColor: titleReady ? `${accent}66` : '#DDE4DF',
                color: titleReady ? accent : '#B0B7B2',
                cursor: titleReady ? 'pointer' : 'not-allowed',
                opacity: titleReady ? 1 : 0.5
              }}
            >
              <Plus size={12} /> <ArrowRight size={12} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
              onClick={() => onAddBelow(t.id)}
              disabled={!titleReady}
              title={titleReady ? 'Add new comment below' : 'Write a title first'}
              className="h-8 px-2 rounded-md border-2 border-dashed flex items-center gap-1 text-xs transition-colors outline-none focus:outline-none focus:ring-0"
              style={{
                borderColor: titleReady ? `${accent}66` : '#DDE4DF',
                color: titleReady ? accent : '#B0B7B2',
                cursor: titleReady ? 'pointer' : 'not-allowed',
                opacity: titleReady ? 1 : 0.5
              }}
            >
              <Plus size={12} /> <ArrowDown size={12} />
            </motion.button>
          </div>
        </>
      )}
    </motion.div>
  )
})

/* ============================================================
   DELETE MODAL
   ============================================================ */
function DeleteModal({ open, target, cascadeCount, onCancel, onConfirm }) {
  if (!open || typeof document === 'undefined') return null
  const isTopic = target?.role !== 'comment'
  const cascading = cascadeCount > 1
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="del-wrap"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] grid place-items-center px-4"
      >
        <div className="absolute inset-0 bg-black/20" />
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          className="relative bg-white border border-[#DDE4DF] rounded-2xl shadow-2xl p-6 w-full max-w-sm text-center"
        >
          <div className="mx-auto mb-3 h-10 w-10 grid place-items-center rounded-full bg-red-50 text-red-500">
            <AlertTriangle size={20} />
          </div>
          <div className="text-lg font-semibold mb-1">
            Delete this {isTopic ? 'topic' : 'comment'}?
          </div>
          <div className="text-sm text-[#8B928E] mb-5">
            {cascading && isTopic ? (
              <>
                This will also delete <b>{cascadeCount - 1} comment{cascadeCount - 1 === 1 ? '' : 's'}</b> that
                {cascadeCount - 1 === 1 ? ' was' : ' were'} created inside it. Undo with ⌘Z.
              </>
            ) : (
              <>Everything inside will be removed. Undo with ⌘Z.</>
            )}
          </div>
          <div className="flex gap-3 justify-center">
            <button onClick={onCancel} className="px-5 h-10 rounded-lg border border-[#DDE4DF] hover:bg-[#F7FAF8]">Cancel</button>
            <button onClick={onConfirm} className="px-5 h-10 rounded-lg text-white bg-red-500 hover:bg-red-600">
              Delete{cascading && isTopic ? ` all ${cascadeCount}` : ''}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

/* ============================================================
   MAIN PAGE
   ============================================================ */
export default function Page() {
  const [doc, setDoc] = useState([])
  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const [tool, setTool] = useState('v')
  const [draft, setDraft] = useState(null)
  const [sel, setSel] = useState(null)
  const [fresh, setFresh] = useState(null)       // id of the just-created element (visual confirmation)
  const [editMode, setEditMode] = useState(null) // "card-edit" state: id of the card being edited
  const [saved, setSaved] = useState(true)
  const [saveError, setSaveError] = useState(false)
  const [anim, setAnim] = useState(false)
  const [ask, setAsk] = useState(null)
  const [focus, setFocus] = useState(null)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [searchHit, setSearchHit] = useState(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const past = useRef([]), future = useRef([])
  const pointers = useRef(new Map())   // pointerId -> { x, y, type }
  /*
    Gesture state machine (mutually exclusive), kept in a ref:
      idle | card-select | card-drag | background-pan | pinch-zoom | text-create
    "card-edit" is the React state `editMode`.
  */
  const gesture = useRef({ type: 'idle' })
  const cv = useRef(null), dr = useRef(null), fileRef = useRef(null)
  const ready = useRef(false)
  const loadFailed = useRef(false)
  const docR = useRef(doc); docR.current = doc
  const viewR = useRef(view); viewR.current = view
  // Latest UI values for the (long-lived) gesture listeners, so they are never re-bound mid-gesture.
  const ui = useRef({}); ui.current = { isMobile, editMode, tool, focus }
  const pendingReveal = useRef(null)
  const lastAdd = useRef({ key: '', time: 0 })
  const freshTimer = useRef(null)

  /* ---------- History ---------- */
  const snap = () => {
    past.current.push(docR.current)
    future.current = []
    if (past.current.length > 100) past.current.shift()
  }
  const commit = useCallback(fn => { snap(); setDoc(d => fn(d)) }, [])
  const undo = useCallback(() => {
    if (!past.current.length) return
    future.current.push(docR.current)
    setDoc(past.current.pop())
  }, [])
  const redo = useCallback(() => {
    if (!future.current.length) return
    past.current.push(docR.current)
    setDoc(future.current.pop())
  }, [])
  const upd = useCallback((id, fn) => commit(d => d.map(t => t.id === id ? fn(t) : t)), [commit])

  /* ---------- Persistence ---------- */
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY))
      if (s) {
        const topics = normalizeProjectTopics(s.topics || [])
        setDoc(topics)
        const v = s.view
        if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
          setView({ x: v.x, y: v.y, z: Math.max(MIN_Z, Math.min(MAX_Z, v.z)) })
        }
      }
    } catch (err) {
      loadFailed.current = true
      setSaveError(true)
      console.error('NoteS could not load its saved workspace:', err)
    }
    ready.current = true
  }, [])
  useEffect(() => {
    if (!ready.current || loadFailed.current) return
    setSaved(false)
    setSaveError(false)
    // The payload is built lazily from refs at flush time (no JSON.stringify on every pan/pinch frame).
    const flush = () => {
      if (loadFailed.current) return
      try {
        const payload = JSON.stringify({ app: 'NoteS', version: 38, topics: docR.current, view: viewR.current })
        localStorage.setItem(KEY, payload)
        setSaved(true)
        setSaveError(false)
      } catch (err) {
        setSaved(false)
        setSaveError(true)
        console.error('NoteS local save failed:', err)
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    const t = setTimeout(flush, 400)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [doc, view])

  /* ---------- View helpers ---------- */
  // Single entry point for every view change: keeps viewR (always latest) in sync with React state.
  const setViewSync = useCallback(next => {
    const v = typeof next === 'function' ? next(viewR.current) : next
    viewR.current = v
    setView(v)
  }, [])

  const zoomAt = useCallback((px, py, f) => setViewSync(v => {
    const z = clampZ(v.z * f), k = z / v.z
    return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
  }), [setViewSync])
  const zoomC = useCallback(f => zoomAt(window.innerWidth / 2, window.innerHeight / 2, f), [zoomAt])
  const fly = useCallback(v => {
    setAnim(true); setViewSync(v)
    setTimeout(() => setAnim(false), 450)
  }, [setViewSync])

  const fit = useCallback(() => {
    if (!docR.current.length) return fly({ x: 0, y: 0, z: 1 })
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9
    docR.current.forEach(t => {
      const el = document.getElementById(t.id)
      if (!el) return
      a = Math.min(a, t.x); b = Math.min(b, t.y)
      c = Math.max(c, t.x + el.offsetWidth); d = Math.max(d, t.y + el.offsetHeight)
    })
    if (a > c || b > d) return
    const z = clampZ(Math.min(1.2, (innerWidth - 120) / Math.max(1, c - a), (innerHeight - 200) / Math.max(1, d - b)))
    fly({ z, x: innerWidth / 2 - ((a + c) / 2) * z, y: innerHeight / 2 - ((b + d) / 2) * z })
  }, [fly])

  const focusTopic = useCallback(t => {
    setFocus(t.id)
    setEditMode(t.id)
    setSel(t.id)
    const el = document.getElementById(t.id)
    if (!el) return
    const z = clampZ(Math.min(1.3, (innerWidth - 60) / el.offsetWidth, (innerHeight - 140) / el.offsetHeight))
    fly({ z, x: innerWidth / 2 - (t.x + el.offsetWidth / 2) * z, y: innerHeight / 2 - (t.y + el.offsetHeight / 2) * z })
  }, [fly])

  const exitEditMode = () => {
    setFocus(null)
    setEditMode(null)
    if (document.activeElement) document.activeElement.blur()
  }

  const dup = useCallback(t => {
    const el = document.getElementById(t.id)
    commit(d => [...d, cloneNode(t, (el ? el.offsetWidth : 300) + 40)])
  }, [commit])

  /* ---------- Cascade delete ---------- */
  const cascadeIds = useMemo(() => {
    if (!ask) return []
    const target = doc.find(t => t.id === ask)
    if (!target) return []
    if (target.role === 'comment') return [target.id]
    const rootLineage = target.lineageId || target.id
    return doc
      .filter(t => t.id === target.id || (t.lineageId || t.id) === rootLineage)
      .map(t => t.id)
  }, [ask, doc])

  const yesDelete = () => {
    if (!cascadeIds.length) { setAsk(null); return }
    const ids = new Set(cascadeIds)
    commit(d => d.filter(t => !ids.has(t.id)))
    setSel(s => ids.has(s) ? null : s)
    setAsk(null)
  }

  /* ---------- Culori pentru topicuri noi ---------- */
  const getNewTopicColor = useCallback(() => {
    const usedColors = new Set(docR.current.filter(t => t.role === 'topic').map(t => t.color))
    for (const c of COLORS) {
      if (!usedColors.has(c)) return c
    }
    return COLORS[Math.floor(Math.random() * COLORS.length)]
  }, [])

  /* ---------- Add node (right / below) ---------- */
  const markFresh = useCallback(id => {
    setFresh(id)
    if (freshTimer.current) clearTimeout(freshTimer.current)
    freshTimer.current = setTimeout(() => setFresh(null), 3500)
  }, [])
  useEffect(() => () => { if (freshTimer.current) clearTimeout(freshTimer.current) }, [])

  const addRelative = useCallback((afterId, dir) => {
    const now = Date.now()
    const key = `${afterId}:${dir}`
    // Ignore accidental double taps on the same button.
    if (lastAdd.current.key === key && now - lastAdd.current.time < 700) return
    const t = docR.current.find(x => x.id === afterId)
    if (!t || !hasText(t.title)) return
    lastAdd.current = { key, time: now }

    const el = document.getElementById(t.id)
    const opts = { color: t.color || G, role: 'comment', lineageId: t.lineageId || t.id }
    const nt = dir === 'right'
      ? mkNode(t.x + (el ? el.offsetWidth : 400) + 32, t.y, opts)
      : mkNode(t.x, t.y + (el ? el.offsetHeight : 200) + 32, opts)

    commit(d => [...d, nt])
    setSel(nt.id)
    markFresh(nt.id)
    pendingReveal.current = nt.id
    // In focus/edit mode only the focused card is rendered, so the focus must follow the new card.
    // On mobile the new card also enters edit mode so its controls are immediately visible.
    if (ui.current.isMobile || ui.current.focus) {
      setFocus(nt.id)
      setEditMode(nt.id)
    }
  }, [commit, markFresh])

  const addRight = useCallback(id => addRelative(id, 'right'), [addRelative])
  const addBelow = useCallback(id => addRelative(id, 'below'), [addRelative])

  // After the new card is in the DOM, bring it to the center of the viewport.
  useLayoutEffect(() => {
    const id = pendingReveal.current
    if (!id) return
    const t = doc.find(x => x.id === id)
    const el = document.getElementById(id)
    if (!t || !el) return
    pendingReveal.current = null
    const w = el.offsetWidth, h = el.offsetHeight
    const fitZ = clampZ(Math.min(1.3, (innerWidth - 60) / w, (innerHeight - 140) / h))
    const z = Math.min(Math.max(viewR.current.z, Math.min(1, fitZ)), fitZ)
    fly({ z, x: innerWidth / 2 - (t.x + w / 2) * z, y: innerHeight / 2 - (t.y + h / 2) * z })
  }, [doc, focus, fly])

  const addRootTopic = useCallback((x, y, title = '') => {
    const newColor = getNewTopicColor()
    const nt = mkNode(x, y, { title, color: newColor, role: 'topic' })
    commit(d => [...d, nt])
  }, [commit, getNewTopicColor])

  const confirmDraft = useCallback(() => {
    const html = sanitizeHtml(dr.current ? dr.current.innerHTML : '')
    if (draft && hasText(html)) addRootTopic(draft.x, draft.y, html)
    setDraft(null)
    setTool('v')
  }, [draft, addRootTopic])

  useLayoutEffect(() => {
    if (draft && dr.current) dr.current.focus()
  }, [draft])

  const changeColor = useCallback((id, color) => {
    upd(id, x => {
      const wasComment = x.role === 'comment'
      const newLineage = wasComment ? x.id : (x.lineageId || x.id)
      return { ...x, color, role: wasComment ? 'topic' : x.role, lineageId: newLineage }
    })
  }, [upd])

  /* ---------- Subtopic / note operations (gated) ---------- */
  const onSubAdd = useCallback((tid, slot) => {
    const node = docR.current.find(t => t.id === tid)
    if (!node || !hasText(node.title)) return
    upd(tid, x => {
      const subs = [...x.subs]
      subs[slot] = mkSub()
      return { ...x, subs }
    })
  }, [upd])

  const onSubSave = useCallback((tid, sid, html) => {
    setDoc(d => d.map(x => x.id === tid ? { ...x, subs: x.subs.map(q => q && q.id === sid ? { ...q, html: sanitizeHtml(html) } : q) } : x))
  }, [])
  const onSubDelete = useCallback((tid, sid) => {
    upd(tid, x => ({ ...x, subs: x.subs.map(q => q && q.id === sid ? null : q) }))
  }, [upd])

  const onNoteAdd = useCallback((tid, sid) => {
    const node = docR.current.find(t => t.id === tid)
    if (!node) return
    const sub = node.subs.find(q => q && q.id === sid)
    if (!sub || !hasText(sub.html)) return
    upd(tid, x => ({
      ...x, subs: x.subs.map(q => q && q.id === sid ? { ...q, notes: [...q.notes, { id: uid(), html: '' }] } : q)
    }))
  }, [upd])

  const onNoteSave = useCallback((tid, sid, nid, html) => {
    setDoc(d => d.map(x => x.id === tid ? {
      ...x, subs: x.subs.map(q => q && q.id === sid
        ? { ...q, notes: q.notes.map(n => n.id === nid ? { ...n, html: sanitizeHtml(html) } : n) } : q)
    } : x))
  }, [])
  const onNoteDelete = useCallback((tid, sid, nid) => {
    upd(tid, x => ({
      ...x, subs: x.subs.map(q => q && q.id === sid
        ? { ...q, notes: q.notes.filter(n => n.id !== nid) } : q)
    }))
  }, [upd])

  const onTitleSave = useCallback((id, h) => {
    setDoc(d => d.map(x => x.id === id ? { ...x, title: sanitizeHtml(h) } : x))
  }, [])

  /* ============================================================
     POINTER GESTURE ENGINE (single system, Pointer Events only)

     - Every active pointer is tracked in `pointers`.
     - Pinch is computed ABSOLUTELY from the view captured when the
       pinch started (no incremental drift, no stale state).
     - Selection is decided on pointerup (tap), never on pointerdown,
       so a pan/pinch can never clear or change the selection.
     ============================================================ */
  useEffect(() => {
    const el = cv.current
    if (!el) return

    const idle = () => { gesture.current = { type: 'idle' } }
    const capture = id => { try { el.setPointerCapture(id) } catch {} }
    const release = id => { try { if (el.hasPointerCapture(id)) el.releasePointerCapture(id) } catch {} }

    const clearSelection = () => {
      setSel(null)
      const u = ui.current
      if (u.isMobile && (u.editMode || u.focus)) {
        setFocus(null)
        setEditMode(null)
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
      }
    }

    const startPan = (pid, p, moved) => {
      const v = viewR.current
      gesture.current = { type: 'background-pan', pid, sx: p.x, sy: p.y, ox: v.x, oy: v.y, moved }
    }
    const applyPan = (g, p) => setViewSync(v => ({ ...v, x: g.ox + p.x - g.sx, y: g.oy + p.y - g.sy }))

    const startPinch = () => {
      const ents = Array.from(pointers.current.entries()).slice(0, 2)
      if (ents.length < 2) return
      const [[ia, a], [ib, b]] = ents
      gesture.current = {
        type: 'pinch-zoom',
        ids: [ia, ib],
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        v: { ...viewR.current }
      }
      capture(ia); capture(ib)
      setAnim(false)
    }

    const applyPinch = g => {
      const a = pointers.current.get(g.ids[0]), b = pointers.current.get(g.ids[1])
      if (!a || !b) return
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      const z = clampZ(g.v.z * dist / g.dist)
      // world point that was under the starting midpoint stays under the current midpoint
      const wx = (g.mx - g.v.x) / g.v.z, wy = (g.my - g.v.y) / g.v.z
      setViewSync({ z, x: mx - wx * z, y: my - wy * z })
    }

    const wheel = e => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      else setViewSync(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }

    const onPointerDown = e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (e.target.closest('[data-ui]')) return

      // A primary pointer means no other touch is down: drop any ghost pointers from a missed pointerup.
      if (e.isPrimary) { pointers.current.clear(); idle() }

      const type = e.pointerType || 'mouse'
      const p = { x: e.clientX, y: e.clientY, type }
      pointers.current.set(e.pointerId, p)
      setAnim(false)

      // Two fingers = pinch, wherever they land (background, card or text field).
      if (pointers.current.size >= 2) {
        startPinch()
        return
      }

      const target = e.target
      // Buttons and editable text are left entirely to the browser (clicks, caret, selection).
      if (target.closest('button') || target.closest('[data-editable="true"]')) {
        idle()
        return
      }

      const u = ui.current
      const v = viewR.current
      const nodeEl = target.closest('[data-node]')
      const nodeId = nodeEl ? nodeEl.getAttribute('data-node') : null
      const base = { pid: e.pointerId, sx: p.x, sy: p.y, ox: v.x, oy: v.y, moved: false }

      if (u.tool === 't') {
        gesture.current = { type: 'text-create', ...base }
      } else if (nodeId) {
        const canDrag = !u.isMobile || u.editMode === nodeId
        if (canDrag) {
          const node = docR.current.find(t => t.id === nodeId)
          if (!node) { idle(); return }
          gesture.current = { type: 'card-drag', ...base, id: nodeId, ox: node.x, oy: node.y }
        } else {
          gesture.current = { type: 'card-select', ...base, id: nodeId }
        }
      } else {
        gesture.current = { type: 'background-pan', ...base }
      }
      if (type !== 'mouse') capture(e.pointerId) // mouse is captured lazily, so dblclick keeps working
    }

    const onPointerMove = e => {
      const p = pointers.current.get(e.pointerId)
      if (!p) return
      p.x = e.clientX; p.y = e.clientY
      const g = gesture.current

      if (g.type === 'pinch-zoom') {
        if (!g.ids.includes(e.pointerId)) return
        e.preventDefault()
        applyPinch(g)
        return
      }
      if (g.pid !== e.pointerId) return

      const dx = p.x - g.sx, dy = p.y - g.sy
      if (!g.moved && Math.hypot(dx, dy) > (TAP_SLOP[p.type] ?? 8)) {
        g.moved = true
        if (p.type === 'mouse') capture(e.pointerId)
      }

      switch (g.type) {
        case 'background-pan':
          applyPan(g, p)
          break
        case 'card-select':
        case 'text-create':
          // A moving finger on a non-draggable card (or with the text tool) pans the canvas instead.
          if (g.moved) {
            gesture.current = { type: 'background-pan', pid: g.pid, sx: g.sx, sy: g.sy, ox: g.ox, oy: g.oy, moved: true }
            applyPan(gesture.current, p)
          }
          break
        case 'card-drag': {
          if (!g.moved) break
          if (!g.snapped) {
            g.snapped = true
            past.current.push(docR.current)
            if (past.current.length > 100) past.current.shift()
            future.current = []
          }
          const z = viewR.current.z
          setDoc(ds => ds.map(t => t.id === g.id ? { ...t, x: g.ox + dx / z, y: g.oy + dy / z } : t))
          break
        }
        default:
      }
    }

    // Shared end handler: pointerup (cancelled=false), pointercancel / lostpointercapture (cancelled=true)
    const finish = (e, cancelled) => {
      const p = pointers.current.get(e.pointerId)
      if (!p) return
      pointers.current.delete(e.pointerId)
      release(e.pointerId)
      const g = gesture.current

      if (g.type === 'pinch-zoom') {
        if (!g.ids.includes(e.pointerId)) return
        const rest = Array.from(pointers.current.entries())
        if (rest.length >= 2) startPinch()
        else if (rest.length === 1) startPan(rest[0][0], rest[0][1], true) // remaining finger pans from where it is: no jump, no tap
        else idle()
        return
      }
      if (g.pid !== e.pointerId) return

      idle()
      if (cancelled || g.moved) return

      // A real tap
      switch (g.type) {
        case 'card-select':
        case 'card-drag':
          setSel(g.id)
          break
        case 'background-pan':
          clearSelection()
          break
        case 'text-create': {
          const v = viewR.current
          setDraft({ x: (g.sx - v.x) / v.z, y: (g.sy - v.y) / v.z })
          break
        }
        default:
      }
    }

    const onUp = e => finish(e, false)
    const onCancel = e => finish(e, true)
    const onLostCapture = e => {
      if (!pointers.current.has(e.pointerId)) return
      if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) return // capture merely moved to the canvas
      finish(e, true)
    }
    const reset = () => { pointers.current.clear(); idle() }
    const onVis = () => { if (document.visibilityState === 'hidden') reset() }
    const stopGesture = e => e.preventDefault() // iOS Safari proprietary pinch events

    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('lostpointercapture', onLostCapture)
    el.addEventListener('gesturestart', stopGesture)
    el.addEventListener('gesturechange', stopGesture)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('lostpointercapture', onLostCapture)
      el.removeEventListener('gesturestart', stopGesture)
      el.removeEventListener('gesturechange', stopGesture)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [zoomAt, setViewSync])

  /* ---------- Export / Import ---------- */
  const exportJ = () => {
    const b = new Blob(
      [JSON.stringify({ app: 'NoteS', version: 38, savedAt: new Date().toISOString(), topics: doc, view }, null, 2)],
      { type: 'application/json' }
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(b)
    a.download = `notes-${Date.now()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importJ = e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return
    const r = new FileReader()
    r.onload = () => {
      try {
        const j = JSON.parse(r.result)
        if (j.app !== 'NoteS' || !Array.isArray(j.topics) || (j.version != null && j.version !== 38)) throw 0
        if (confirm('Replace the current workspace with this project?')) {
          snap()
          const topics = normalizeProjectTopics(j.topics)
          loadFailed.current = false
          setDoc(topics)
          setSel(null); setFocus(null); setEditMode(null)
          const v = j.view
          setViewSync(v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: v.x, y: v.y, z: Math.max(MIN_Z, Math.min(MAX_Z, v.z)) } : { x: 0, y: 0, z: 1 })
        }
      } catch { alert('Invalid NoteS project file.') }
    }
    r.readAsText(f)
  }

  /* ---------- Search ---------- */
  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    const out = []
    doc.forEach(t => {
      const title = (t.title || '').replace(/<[^>]*>/g, '')
      if (title.toLowerCase().includes(q)) out.push({ type: t.role, id: t.id, text: title, topic: t })
      t.subs.forEach(s => {
        if (!s) return
        const sh = (s.html || '').replace(/<[^>]*>/g, '')
        if (sh.toLowerCase().includes(q)) out.push({ type: 'sub', id: s.id, text: sh, topic: t })
        s.notes.forEach(n => {
          const nh = (n.html || '').replace(/<[^>]*>/g, '')
          if (nh.toLowerCase().includes(q)) out.push({ type: 'note', id: n.id, text: nh, topic: t })
        })
      })
    })
    return out.slice(0, 20)
  }, [search, doc])

  const openSearchResult = r => {
    setSearchHit(r.id)
    focusTopic(r.topic)
    setShowSearch(false)
    setTimeout(() => {
      const el = document.getElementById(`editable-${r.id}`)
      if (!el) return
      const rect = el.getBoundingClientRect()
      setViewSync(v => ({
        ...v,
        x: v.x + innerWidth / 2 - (rect.left + rect.width / 2),
        y: v.y + innerHeight / 2 - (rect.top + rect.height / 2)
      }))
      if (editMode) el.focus()
    }, 500)
  }

  const askTarget = ask ? doc.find(t => t.id === ask) : null

  /* ---------- Render ---------- */
  return (
    <>
      <GlobalStyles />
      <SelectionToolbar />
      <div
        ref={cv}
        className="fixed inset-0 select-none overflow-hidden"
        style={{
          // The canvas owns all touch gestures. Taps, caret placement and text selection are not
          // affected by touch-action, so editable fields keep working.
          touchAction: 'none',
          cursor: tool === 't' ? 'text' : 'grab',
          backgroundColor: '#fff',
          backgroundImage: 'radial-gradient(circle, #E8EAE8 1.2px, transparent 1.6px)',
          backgroundSize: `${24 * view.z}px ${24 * view.z}px`,
          backgroundPosition: `${view.x}px ${view.y}px`
        }}
      >
        <div style={{
          transform: `translate(${Math.round(view.x)}px,${Math.round(view.y)}px) scale(${view.z})`,
          transformOrigin: '0 0',
          transition: anim ? 'transform .45s cubic-bezier(.2,.8,.2,1)' : 'none',
          position: 'absolute'
        }}>
          {doc.map(t => {
            if (focus && focus !== t.id) return null
            return (
              <NodeRow
                key={t.id}
                t={t}
                isSel={sel === t.id}
                isFresh={fresh === t.id}
                searchHit={searchHit}
                isMobile={isMobile}
                isMobileEditing={editMode === t.id}
                onFocus={focusTopic}
                onDup={dup}
                onDelete={setAsk}
                onChangeColor={changeColor}
                onTitleSave={onTitleSave}
                onSubSave={onSubSave}
                onSubAdd={onSubAdd}
                onSubDelete={onSubDelete}
                onNoteAdd={onNoteAdd}
                onNoteSave={onNoteSave}
                onNoteDelete={onNoteDelete}
                onEditStart={snap}
                onAddRight={addRight}
                onAddBelow={addBelow}
              />
            )
          })}

          {!doc.length && !draft && (
            <div
              data-ui
              style={{ position: 'absolute', left: 0, top: 0, width: '100vw', height: '100vh' }}
              className="grid place-items-center pointer-events-none px-4"
            >
              <div className="pointer-events-auto text-center w-full max-w-sm">
                <div className="text-2xl sm:text-3xl font-semibold text-[#202522] mb-2">Welcome to NoteS</div>
                <div className="text-sm text-[#8B928E] mb-6">Press T then click · or start with a topic</div>
                <button
                  onClick={() => {
                    const v = viewR.current
                    const cx = (innerWidth / 2 - v.x) / v.z
                    const cy = (innerHeight / 2 - v.y) / v.z
                    addRootTopic(cx - 200, cy - 100)
                  }}
                  className="mx-auto flex items-center justify-center gap-2 px-5 h-11 w-full rounded-xl text-white font-medium shadow-md hover:shadow-lg transition-shadow"
                  style={{ background: G }}
                >
                  <Plus size={18} /> New topic
                </button>
              </div>
            </div>
          )}

          {draft && (
            <div
              data-ui
              onPointerDown={e => e.stopPropagation()}
              style={{ position: 'absolute', left: draft.x, top: draft.y, borderColor: G }}
              className="min-w-[200px] w-max max-w-[360px] bg-white/95 backdrop-blur border-2 rounded-lg p-2 cursor-text shadow-lg"
            >
              <div
                ref={dr}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                data-editable="true"
                onPaste={e => {
                  e.preventDefault()
                  const text = e.clipboardData.getData('text/plain')
                  document.execCommand('insertText', false, text)
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); setTool('v') }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); confirmDraft() }
                }}
                className="min-h-[28px] px-1 text-lg outline-none"
              />
              <div className="flex items-center gap-1 mt-2">
                <span className="text-[10px] text-[#8B928E]">
                  New topic · ⌘↵ save · Esc cancel
                </span>
                <button
                  onClick={confirmDraft}
                  className="ml-auto h-7 w-7 grid place-items-center rounded-md text-white"
                  style={{ background: G }}
                ><Check size={15} /></button>
              </div>
            </div>
          )}
        </div>

        <motion.div
          data-ui
          initial={{ y: -12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="absolute right-3 flex items-center gap-1 bg-white border border-[#DDE4DF] rounded-xl p-1 shadow-md max-w-[calc(100vw-24px)]"
          style={{ top: 'max(12px, env(safe-area-inset-top))' }}
        >
          <span className="px-2 font-semibold hidden lg:block shrink-0" style={{ color: G }}>NoteS</span>
          <div className="flex items-center gap-1 flex-wrap sm:flex-nowrap">
            <Btn title="Select (V)" active={tool === 'v'} onClick={() => setTool('v')}><MousePointer2 size={16} /></Btn>
            <Btn title="Text (T)" active={tool === 't'} onClick={() => { setTool('t'); setSel(null) }}><Type size={16} /></Btn>
            <div className="w-px h-5 bg-[#DDE4DF] mx-0.5 shrink-0" />
            <Btn title="Undo (⌘Z)" onClick={undo} disabled={!past.current.length}><Undo2 size={16} /></Btn>
            <Btn title="Redo (⌘⇧Z)" onClick={redo} disabled={!future.current.length}><Redo2 size={16} /></Btn>
            <div className="w-px h-5 bg-[#DDE4DF] mx-0.5 shrink-0" />
            <Btn title="Search (⌘F)" active={showSearch} onClick={() => setShowSearch(s => !s)}><Search size={16} /></Btn>
            <Btn title="Export JSON" onClick={exportJ}><Download size={16} /></Btn>
            <Btn title="Import JSON" onClick={() => fileRef.current.click()}><Upload size={16} /></Btn>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={importJ} />
          </div>
        </motion.div>

        {showSearch && typeof document !== 'undefined' && createPortal(
          <AnimatePresence>
            <motion.div
              data-ui
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="fixed top-16 left-1/2 -translate-x-1/2 w-[min(420px,90vw)] bg-white border border-[#DDE4DF] rounded-xl shadow-lg p-2 z-[9998]"
            >
              <input
                autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search topics, comments, subtopics, notes…"
                className="w-full px-2 py-1.5 text-sm outline-none"
              />
              {search && (
                <div className="max-h-64 overflow-y-auto mt-1">
                  {searchResults.length === 0 && <div className="px-2 py-3 text-xs text-[#8B928E]">No results</div>}
                  {searchResults.map(r => (
                    <button
                      key={r.id}
                      onClick={() => openSearchResult(r)}
                      className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[#F7FAF8] flex items-center gap-2"
                    >
                      <span className="text-[10px] uppercase text-[#8B928E] w-14 shrink-0">{r.type}</span>
                      <span className="truncate">{r.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>,
          document.body
        )}

        <div data-ui className="absolute right-3 flex items-center gap-1 bg-white border border-[#DDE4DF] rounded-xl p-1 shadow-md max-w-[calc(100vw-24px)]" style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <Btn title="Zoom out" onClick={() => zoomC(1 / 1.2)}><Minus size={16} /></Btn>
          <span className="w-12 text-center text-xs text-[#8B928E]">{Math.round(view.z * 100)}%</span>
          <Btn title="Zoom in" onClick={() => zoomC(1.2)}><Plus size={16} /></Btn>
          <Btn title="Fit all" onClick={fit}><Maximize size={16} /></Btn>
          <Btn title="Reset" onClick={() => fly({ x: 0, y: 0, z: 1 })}><Home size={16} /></Btn>
        </div>

        {(focus || editMode) && (
          <button data-ui onClick={exitEditMode}
            className="absolute top-20 sm:top-3 right-3 flex items-center gap-1 px-3 h-9 bg-white border border-[#DDE4DF] rounded-xl shadow-md text-sm hover:bg-[#F7FAF8]">
            <X size={14} /> Exit edit
          </button>
        )}

        <div data-ui className="absolute bottom-4 left-4 text-xs text-[#8B928E] hidden sm:block">
          {saveError ? 'Save failed · export a backup' : saved ? '✓ Saved locally · export JSON to back up' : 'Saving…'}
        </div>

        <DeleteModal
          open={!!ask}
          target={askTarget}
          cascadeCount={cascadeIds.length}
          onCancel={() => setAsk(null)}
          onConfirm={yesDelete}
        />
      </div>
    </>
  )
}