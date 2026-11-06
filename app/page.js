'use client'
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Type, MousePointer2, Undo2, Redo2, Download, Upload, Plus, Trash2, Copy, Check,
  Bold, Italic, Underline, Minus, Maximize, Home, X, GripHorizontal, Search,
  Palette, Focus, StickyNote, ArrowRight, ArrowDown, AlertTriangle
} from 'lucide-react'

/* ============================================================
   CONSTANTS
   ============================================================ */
const G = '#42A879'
const KEY = 'notes-workspace-v9'
const COLORS = ['#42A879', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444', '#202522']
const TXT_COLORS = ['#202522', '#42A879', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444']
const HIGHLIGHTS = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE', 'transparent']
const uid = () => Math.random().toString(36).slice(2, 9)

/* ============================================================
   HELPERS & SANITIZER
   ============================================================ */
function hasText(html) {
  if (!html) return false
  if (typeof document === 'undefined') return html.length > 0
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return (tmp.textContent || '').trim().length > 0
}

function sanitizeHtml(html) {
  if (typeof document === 'undefined') return html
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
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        html, body {
          height: 100%; margin: 0; padding: 0;
          overscroll-behavior: none;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #B0B7B2;
          pointer-events: none;
        }
        [contenteditable] b, [contenteditable] strong { font-weight: 700; }
        [contenteditable] i, [contenteditable] em { font-style: italic; }
        [contenteditable] u { text-decoration: underline; }
        [contenteditable] s, [contenteditable] strike { text-decoration: line-through; }
        [contenteditable] h1 { font-size: 1.8em; font-weight: 700; margin: 0.2em 0; }
        [contenteditable] h2 { font-size: 1.4em; font-weight: 600; margin: 0.2em 0; }
        [contenteditable] h3 { font-size: 1.15em; font-weight: 600; margin: 0.2em 0; }
        [contenteditable] ul, [contenteditable] ol { padding-left: 1.2em; margin: 0.2em 0; }
        [contenteditable] p { margin: 0.15em 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #DDE4DF; border-radius: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </>
  )
}

/* ============================================================
   EDITABLE — Mobile-First (Saves safely, no cursor jumps)
   ============================================================ */
const Editable = memo(function Editable({ html, onSave, className = '', placeholder = '' }) {
  const ref = useRef(null)
  const lastSavedHtml = useRef(html)
  const timer = useRef(null)
  const isFocused = useRef(false)

  useEffect(() => {
    if (!isFocused.current && ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html
      lastSavedHtml.current = html
    }
  }, [html])

  const commit = () => {
    if (!ref.current) return
    try {
      const currentHtml = ref.current.innerHTML || ''
      const clean = sanitizeHtml(currentHtml)
      if (clean !== lastSavedHtml.current) {
        lastSavedHtml.current = clean
        onSave(clean)
      }
    } catch (err) {
      console.warn("Save interrupted", err)
    }
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-editable
      data-placeholder={placeholder}
      className={`outline-none focus:outline-none ${className}`}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onFocus={() => { isFocused.current = true }}
      onBlur={() => {
        isFocused.current = false
        if (timer.current) clearTimeout(timer.current)
        commit()
      }}
      onPaste={e => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
      }}
      onInput={() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(commit, 350)
      }}
      dangerouslySetInnerHTML={{ __html: html || '' }}
    />
  )
})

/* ============================================================
   BUTTONS
   ============================================================ */
const Btn = ({ onClick, children, active, title, disabled }) => (
  <motion.button
    whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.05 }}
    title={title} disabled={disabled} onClick={onClick}
    className={`h-9 w-9 grid place-items-center rounded-lg transition-colors shrink-0 ${
      disabled ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#F7FAF8]'
    } ${active ? 'text-white bg-[#42A879] hover:bg-[#42A879]' : 'text-[#202522]'}`}
  >{children}</motion.button>
)

const FmtBtn = ({ onClick, children, active, title }) => (
  <motion.button
    whileTap={{ scale: 0.9 }}
    onMouseDown={e => e.preventDefault()}
    onClick={onClick} title={title}
    className={`h-7 w-7 grid place-items-center rounded transition-colors shrink-0 ${
      active ? 'bg-[#42A879] text-white hover:bg-[#42A879]' : 'hover:bg-[#F7FAF8] text-[#202522]'
    }`}
  >{children}</motion.button>
)

/* ============================================================
   SELECTION TOOLBAR — High Contrast
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
        const editable = node.closest?.('[data-editable]')
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
    const ed = editableRef.current
    if (ed) ed.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
  }

  if (!state || typeof document === 'undefined') return null
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const left = Math.max(8, Math.min(vw - 420, state.x - 200))
  const top = Math.max(8, state.y - 60)

  return createPortal(
    <motion.div
      data-ui
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.12 }}
      onMouseDown={e => e.preventDefault()}
      onPointerDown={e => e.stopPropagation()}
      style={{ position: 'fixed', left, top, zIndex: 10000 }}
      // Am adăugat bg-white și shadow-2xl pentru contrast perfect
      className="flex items-center gap-0.5 bg-white border border-[#DDE4DF] rounded-xl shadow-2xl p-1 max-w-[96vw] overflow-x-auto text-[#202522]"
    >
      <FmtBtn active={marks.bold} title="Bold" onClick={() => run('bold')}><Bold size={14} /></FmtBtn>
      <FmtBtn active={marks.italic} title="Italic" onClick={() => run('italic')}><Italic size={14} /></FmtBtn>
      <FmtBtn active={marks.underline} title="Underline" onClick={() => run('underline')}><Underline size={14} /></FmtBtn>
      <FmtBtn active={marks.strike} title="Strike" onClick={() => run('strikeThrough')}>
        <span className="text-xs font-semibold line-through">S</span>
      </FmtBtn>
      <div className="w-px h-5 bg-[#DDE4DF] mx-0.5 shrink-0" />
      <select
        onChange={e => { if (e.target.value) run('formatBlock', e.target.value); e.target.value = '' }}
        defaultValue="" onMouseDown={e => e.stopPropagation()}
        className="h-7 text-xs rounded border border-[#DDE4DF] px-1 outline-none bg-white hover:bg-[#F7FAF8] cursor-pointer shrink-0 font-medium"
      >
        <option value="" disabled>¶</option>
        <option value="p">Body</option>
        <option value="h1">H1</option>
        <option value="h2">H2</option>
        <option value="h3">H3</option>
      </select>
      <div className="relative group shrink-0">
        <button onMouseDown={e => e.preventDefault()} title="Text color"
          className="h-7 w-7 grid place-items-center rounded hover:bg-[#F7FAF8] relative">
          <span className="text-sm font-bold">A</span>
          <span className="absolute bottom-0.5 left-1 right-1 h-0.5 rounded" style={{ background: G }} />
        </button>
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:flex flex-wrap gap-1 p-2 bg-white border border-[#DDE4DF] rounded-lg shadow-lg w-32 z-10">
          {TXT_COLORS.map(c => (
            <button key={c}
              onMouseDown={e => { e.preventDefault(); run('foreColor', c) }}
              className="h-5 w-5 rounded-full border border-white shadow-sm hover:scale-110 transition-transform"
              style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="relative group shrink-0">
        <button onMouseDown={e => e.preventDefault()} title="Highlight"
          className="h-7 w-7 grid place-items-center rounded hover:bg-[#F7FAF8]">
          <span className="text-xs font-bold bg-yellow-200 px-1 rounded text-black">H</span>
        </button>
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:flex flex-wrap gap-1 p-2 bg-white border border-[#DDE4DF] rounded-lg shadow-lg w-32 z-10">
          {HIGHLIGHTS.map(c => (
            <button key={c}
              onMouseDown={e => { e.preventDefault(); run('hiliteColor', c) }}
              className="h-5 w-5 rounded border border-[#DDE4DF] hover:scale-110 transition-transform"
              style={{ background: c === 'transparent' ? 'repeating-linear-gradient(45deg,#fff,#fff 3px,#eee 3px,#eee 6px)' : c }} />
          ))}
        </div>
      </div>
      <select
        onChange={e => { if (e.target.value) run('fontSize', e.target.value); e.target.value = '' }}
        defaultValue="" onMouseDown={e => e.stopPropagation()}
        className="h-7 text-xs rounded border border-[#DDE4DF] px-1 outline-none bg-white hover:bg-[#F7FAF8] cursor-pointer shrink-0 font-medium"
      >
        <option value="" disabled>Size</option>
        <option value="2">S</option>
        <option value="3">M</option>
        <option value="4">L</option>
        <option value="5">XL</option>
        <option value="6">XXL</option>
      </select>
      <div className="w-px h-5 bg-[#DDE4DF] mx-0.5 shrink-0" />
      <FmtBtn title="Clear formatting" onClick={() => run('removeFormat')}><X size={14} /></FmtBtn>
    </motion.div>,
    document.body
  )
}

/* ============================================================
   NODE CARD
   ============================================================ */
const NodeRow = memo(function NodeRow({
  t, isSel,
  onStartDrag, onFocus, onDup, onDelete,
  onChangeColor, onTitleSave, onSubSave, onSubAdd, onSubDelete,
  onNoteAdd, onNoteSave, onNoteDelete,
  onAddRight, onAddBelow
}) {
  const accent = t.color || G
  const isComment = t.role === 'comment'
  const titlePlaceholder = isComment ? 'Comment…' : 'Topic title…'
  const titleReady = hasText(t.title)

  return (
    <motion.div
      id={t.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      onPointerDown={e => onStartDrag(e, t)}
      onDoubleClick={() => onFocus(t)}
      style={{
        position: 'absolute', left: t.x, top: t.y,
        borderColor: accent,
        boxShadow: isSel ? `0 0 0 4px ${accent}33` : '0 1px 3px rgba(0,0,0,0.04)'
      }}
      className={`w-max max-w-[90vw] bg-white ${isComment ? 'border rounded-lg p-3' : 'border-2 rounded-xl p-4'} cursor-move`}
    >
      <div className="flex items-center gap-2 mb-2">
        <GripHorizontal size={14} className="text-[#8B928E] cursor-move shrink-0" />
        <span
          className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
          style={{ background: `${accent}15`, color: accent }}
        >
          {isComment ? 'Comment' : 'Topic'}
        </span>
        {!titleReady && (
          <span className="text-[9px] text-[#B0B7B2] italic">write a title first…</span>
        )}
        <div className="flex-1" />
        <button title="Focus" onClick={() => onFocus(t)} className="p-1" style={{ color: '#8B928E' }}>
          <Focus size={14} />
        </button>
        <button title="Duplicate" onClick={() => onDup(t)} className="p-1" style={{ color: '#8B928E' }}>
          <Copy size={14} />
        </button>
        <button title="Delete" onClick={() => onDelete(t.id)} className="p-1" style={{ color: '#8B928E' }}>
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex items-start gap-1 mb-3">
        <Editable
          html={t.title}
          onSave={h => onTitleSave(t.id, h)}
          className={`${isComment ? 'text-base' : 'text-xl'} font-semibold min-w-[120px] flex-1 cursor-text`}
          placeholder={titlePlaceholder}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 items-stretch min-h-[100px]">
        {t.subs.map((s, si) => {
          const subReady = s ? hasText(s.html) : false
          return (
            <div
              key={s ? s.id : `empty-${si}`}
              className="group/sub pl-3 flex flex-col rounded-sm"
              style={{ borderLeft: `2px dashed ${accent}33` }}
            >
              {s ? (
                <>
                  <div className="flex items-start gap-1">
                    <Editable
                      html={s.html}
                      onSave={h => onSubSave(t.id, s.id, h)}
                      className={`flex-1 ${isComment ? 'text-[13px]' : 'text-[15px]'} min-h-[22px] cursor-text font-medium`}
                      placeholder="Subtopic…"
                    />
                    <button
                      title="Delete subtopic"
                      onClick={() => onSubDelete(t.id, s.id)}
                      className="text-[#8B928E] hover:text-red-500 opacity-0 group-hover/sub:opacity-100 shrink-0"
                    ><X size={12} /></button>
                  </div>
                  {s.notes.map(n => (
                    <div key={n.id}
                      className="mt-2 rounded-md border px-2 py-1 text-xs flex gap-1 items-start group/note"
                      style={{ background: `${accent}0d`, borderColor: `${accent}33` }}
                    >
                      <StickyNote size={11} className="mt-0.5 shrink-0" style={{ color: accent }} />
                      <Editable
                        html={n.html}
                        onSave={h => onNoteSave(t.id, s.id, n.id, h)}
                        className="flex-1 min-h-[16px] cursor-text"
                        placeholder="Note"
                      />
                      <button
                        onClick={() => onNoteDelete(t.id, s.id, n.id)}
                        className="text-[#8B928E] hover:text-red-500 opacity-0 group-hover/note:opacity-100 shrink-0"
                      ><X size={12} /></button>
                    </div>
                  ))}
                  <button
                    onClick={() => onNoteAdd(t.id, s.id)}
                    disabled={!subReady}
                    title={subReady ? 'Add note' : 'Write the subtopic first'}
                    className={`mt-auto pt-2 flex items-center gap-1 text-xs ${subReady ? 'hover:opacity-100' : 'opacity-30 cursor-not-allowed'}`}
                    style={{ color: accent }}
                  >
                    <Plus size={12} /> note
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onSubAdd(t.id, si)}
                  disabled={!titleReady}
                  title={titleReady ? 'Add subtopic here' : 'Write a title first'}
                  className="flex-1 min-h-[90px] flex flex-col items-center justify-center gap-1 rounded-md border border-dashed transition-colors"
                  style={{
                    color: titleReady ? accent : '#B0B7B2',
                    borderColor: 'transparent',
                    cursor: titleReady ? 'pointer' : 'not-allowed',
                    opacity: titleReady ? 1 : 0.4
                  }}
                  onMouseEnter={e => {
                    if (titleReady) {
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
          className="h-8 px-2 rounded-md border-2 border-dashed flex items-center gap-1 text-xs transition-colors"
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
          className="h-8 px-2 rounded-md border-2 border-dashed flex items-center gap-1 text-xs transition-colors"
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
  const [saved, setSaved] = useState(true)
  const [anim, setAnim] = useState(false)
  const [ask, setAsk] = useState(null)
  const [focus, setFocus] = useState(null)
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const past = useRef([]), future = useRef([])
  const drag = useRef(null), space = useRef(false), pinch = useRef(null)
  const cv = useRef(null), dr = useRef(null), fileRef = useRef(null)
  const ready = useRef(false)
  const docR = useRef(doc); docR.current = doc
  const viewR = useRef(view); viewR.current = view

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
        const topics = (s.topics || []).map((t, i) => {
          const subs = Array.isArray(t.subs) ? [...t.subs] : []
          while (subs.length < 3) subs.push(null)
          const lineageId = t.lineageId || t.id
          return {
            color: G,
            role: i === 0 ? 'topic' : (t.role || (t.color && t.color !== G ? 'topic' : 'comment')),
            ...t,
            lineageId,
            subs
          }
        })
        setDoc(topics)
        setView(s.view || { x: 0, y: 0, z: 1 })
      }
    } catch {}
    ready.current = true
  }, [])
  useEffect(() => {
    if (!ready.current) return
    setSaved(false)
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ topics: doc, view }))
        setSaved(true)
      } catch {}
    }, 400)
    return () => clearTimeout(t)
  }, [doc, view])

  /* ---------- View helpers ---------- */
  const zoomAt = useCallback((px, py, f) => setView(v => {
    const z = Math.min(3, Math.max(0.1, v.z * f)), k = z / v.z
    return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
  }), [])
  const zoomC = useCallback(f => zoomAt(innerWidth / 2, innerHeight / 2, f), [zoomAt])
  const fly = useCallback(v => {
    setAnim(true); setView(v)
    setTimeout(() => setAnim(false), 450)
  }, [])

  const fit = useCallback(() => {
    if (!docR.current.length) return fly({ x: 0, y: 0, z: 1 })
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9
    docR.current.forEach(t => {
      const el = document.getElementById(t.id)
      if (!el) return
      a = Math.min(a, t.x); b = Math.min(b, t.y)
      c = Math.max(c, t.x + el.offsetWidth); d = Math.max(d, t.y + el.offsetHeight)
    })
    const z = Math.min(1.2, (innerWidth - 120) / (c - a), (innerHeight - 200) / (d - b))
    fly({ z, x: innerWidth / 2 - ((a + c) / 2) * z, y: innerHeight / 2 - ((b + d) / 2) * z })
  }, [fly])

  const focusTopic = useCallback(t => {
    setFocus(t.id)
    const el = document.getElementById(t.id)
    if (!el) return
    const z = Math.min(1.3, (innerWidth - 60) / el.offsetWidth, (innerHeight - 140) / el.offsetHeight)
    fly({ z, x: innerWidth / 2 - (t.x + el.offsetWidth / 2) * z, y: innerHeight / 2 - (t.y + el.offsetHeight / 2) * z })
  }, [fly])

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
  // Găsește o culoare care nu este folosită deja de topicurile principale
  const getNewTopicColor = useCallback(() => {
    const usedColors = new Set(docR.current.filter(t => t.role === 'topic').map(t => t.color))
    // Caută prima culoare liberă
    for (const c of COLORS) {
      if (!usedColors.has(c)) return c
    }
    // Dacă toate sunt folosite, alege una aleatorie
    return COLORS[Math.floor(Math.random() * COLORS.length)]
  }, [])

  /* ---------- Add node ---------- */
  const addRight = useCallback((afterId) => {
    const t = docR.current.find(t => t.id === afterId)
    if (!t) return
    if (!hasText(t.title)) return
    const el = document.getElementById(t.id)
    const w = el ? el.offsetWidth : 400
    const nt = mkNode(t.x + w + 32, t.y, {
      color: t.color || G,
      role: 'comment',
      lineageId: t.lineageId || t.id
    })
    commit(d => [...d, nt])
  }, [commit])

  const addBelow = useCallback((afterId) => {
    const t = docR.current.find(t => t.id === afterId)
    if (!t) return
    if (!hasText(t.title)) return
    const el = document.getElementById(t.id)
    const h = el ? el.offsetHeight : 200
    const nt = mkNode(t.x, t.y + h + 32, {
      color: t.color || G,
      role: 'comment',
      lineageId: t.lineageId || t.id
    })
    commit(d => [...d, nt])
  }, [commit])

  const addRootTopic = useCallback((x, y, title = '') => {
    const newColor = getNewTopicColor()
    const nt = mkNode(x, y, { title, color: newColor, role: 'topic' })
    commit(d => [...d, nt])
  }, [commit, getNewTopicColor])

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
    upd(tid, x => ({ ...x, subs: x.subs.map(q => q && q.id === sid ? { ...q, html } : q) }))
  }, [upd])
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
    upd(tid, x => ({
      ...x, subs: x.subs.map(q => q && q.id === sid
        ? { ...q, notes: q.notes.map(n => n.id === nid ? { ...n, html } : n) } : q)
    }))
  }, [upd])
  const onNoteDelete = useCallback((tid, sid, nid) => {
    upd(tid, x => ({
      ...x, subs: x.subs.map(q => q && q.id === sid
        ? { ...q, notes: q.notes.filter(n => n.id !== nid) } : q)
    }))
  }, [upd])

  /* ============================================================
     TOUCH / POINTER ENGINE
     ============================================================ */
  useEffect(() => {
    const el = cv.current
    if (!el) return

    const wheel = e => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      else setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', wheel, { passive: false })

    const move = e => {
      if (pinch.current) return
      const d = drag.current
      if (!d) return
      if (d.type === 'pan') {
        setView(v => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }))
      } else if (d.type === 'topic') {
        const z = viewR.current.z
        const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z
        if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true
        if (d.moved) setDoc(ds => ds.map(t => t.id === d.id ? { ...t, x: d.ox + dx, y: d.oy + dy } : t))
      }
    }

    const up = () => {
      if (pinch.current) return
      const d = drag.current
      drag.current = null
      if (d?.type === 'topic' && d.moved === false) setSel(d.id)
    }

    const tstart = e => {
      if (e.touches.length >= 2) {
        if (drag.current?.type === 'topic') drag.current = null
        const [a, b] = e.touches
        pinch.current = {
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          cx: (a.clientX + b.clientX) / 2,
          cy: (a.clientY + b.clientY) / 2,
          ox: viewR.current.x,
          oy: viewR.current.y
        }
      }
    }

    const tmove = e => {
      if (!pinch.current || e.touches.length < 2) return
      e.preventDefault()
      const [a, b] = e.touches
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const cx = (a.clientX + b.clientX) / 2
      const cy = (a.clientY + b.clientY) / 2
      const f = dist / pinch.current.dist
      const z = Math.min(3, Math.max(0.1, viewR.current.z * f))
      setView(v => {
        const k = z / v.z
        let nx = cx - (cx - v.x) * k
        let ny = cy - (cy - v.y) * k
        nx += cx - pinch.current.cx
        ny += cy - pinch.current.cy
        return { z, x: nx, y: ny }
      })
      pinch.current = { ...pinch.current, dist, cx, cy }
    }

    const tend = e => { if (e.touches.length < 2) pinch.current = null }

    const key = e => {
      const ed = e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
      if (e.code === 'Space' && !ed) { space.current = true; e.preventDefault() }
      if (ed) {
        if (e.key === 'Escape') e.target.blur()
        return
      }
      const m = e.ctrlKey || e.metaKey, k = e.key.toLowerCase()
      if (m && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if (m && (k === '=' || k === '+')) { e.preventDefault(); zoomC(1.2) }
      else if (m && k === '-') { e.preventDefault(); zoomC(1 / 1.2) }
      else if (m && k === '0') { e.preventDefault(); fly({ x: 0, y: 0, z: 1 }) }
      else if (m && k === 'f') { e.preventDefault(); setShowSearch(true) }
      else if (m && k === 'd') {
        e.preventDefault()
        setSel(s => { const t = docR.current.find(t => t.id === s); if (t) dup(t); return s })
      }
      else if (!m && k === 't') { setTool('t'); setSel(null) }
      else if (!m && k === 'v') setTool('v')
      else if (!m && k === 'f') {
        setFocus(f => {
          if (f) return null
          const t = docR.current.find(t => t.id === sel)
          if (t) { focusTopic(t); return t.id }
          return null
        })
      }
      else if (k === 'delete' || k === 'backspace') { if (sel) setAsk(sel) }
      else if (k === 'escape') {
        setAsk(null); setDraft(null); setSel(null); setTool('v')
        setFocus(null); setShowSearch(false)
      }
    }
    const keyup = e => { if (e.code === 'Space') space.current = false }

    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    addEventListener('keydown', key)
    addEventListener('keyup', keyup)
    el.addEventListener('touchstart', tstart, { passive: true })
    el.addEventListener('touchmove', tmove, { passive: false })
    el.addEventListener('touchend', tend, { passive: true })
    el.addEventListener('touchcancel', tend, { passive: true })

    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchstart', tstart)
      el.removeEventListener('touchmove', tmove)
      el.removeEventListener('touchend', tend)
      el.removeEventListener('touchcancel', tend)
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      removeEventListener('keydown', key)
      removeEventListener('keyup', keyup)
    }
  }, [sel, undo, redo, zoomC, zoomAt, fly, dup, focusTopic])

  const down = e => {
    if (e.target.closest('[data-ui]')) return

    if (!e.target.closest('[data-editable]')) {
      const active = document.activeElement
      if (active && active.isContentEditable) {
        active.blur()
      }
    }

    if (e.target.closest('[data-editable]')) return

    if (e.button === 1) {
      e.preventDefault()
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: viewR.current.x, oy: viewR.current.y }
      return
    }
    const v = viewR.current
    if (tool === 't' && e.button === 0 && !space.current) {
      setDraft({ x: (e.clientX - v.x) / v.z, y: (e.clientY - v.y) / v.z })
      return
    }
    setSel(null); setDraft(null)
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y }
  }

  const startTopic = (e, t) => {
    if (e.target.closest('button') || e.target.isContentEditable) return
    if (pinch.current) return
    e.stopPropagation()
    snap(); setSel(t.id)
    drag.current = { type: 'topic', id: t.id, sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false }
  }

  const confirmDraft = () => {
    const h = dr.current?.innerHTML.trim(), txt = dr.current?.innerText.trim()
    if (txt) addRootTopic(draft.x, draft.y, sanitizeHtml(h))
    setDraft(null); setTool('v')
  }
  useEffect(() => { if (draft) dr.current?.focus() }, [draft])

  /* ---------- Export / Import ---------- */
  const exportJ = () => {
    const b = new Blob(
      [JSON.stringify({ app: 'NoteS', version: 9, savedAt: new Date().toISOString(), topics: doc, view }, null, 2)],
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
        if (j.app !== 'NoteS' || !Array.isArray(j.topics) ||
            !j.topics.every(t => t.id && typeof t.x === 'number' && Array.isArray(t.subs))) throw 0
        if (confirm('Replace the current workspace with this project?')) {
          snap()
          const topics = j.topics.map((t, i) => {
            const subs = Array.isArray(t.subs) ? [...t.subs] : []
            while (subs.length < 3) subs.push(null)
            return {
              color: G,
              role: i === 0 ? 'topic' : (t.role || 'comment'),
              lineageId: t.lineageId || t.id,
              ...t,
              subs
            }
          })
          setDoc(topics)
          setView(j.view || { x: 0, y: 0, z: 1 })
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

  const askTarget = ask ? doc.find(t => t.id === ask) : null

  /* ---------- Render ---------- */
  return (
    <>
      <GlobalStyles />
      <SelectionToolbar />
      <div
        ref={cv}
        onPointerDown={down}
        className="fixed inset-0 select-none overflow-hidden"
        style={{
          touchAction: 'none',
          cursor: tool === 't' ? 'text' : drag.current?.type === 'pan' ? 'grabbing' : 'grab',
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
                onStartDrag={startTopic}
                onFocus={focusTopic}
                onDup={dup}
                onDelete={setAsk}
                onChangeColor={changeColor}
                onTitleSave={(id, h) => upd(id, x => ({ ...x, title: h }))}
                onSubSave={onSubSave}
                onSubAdd={onSubAdd}
                onSubDelete={onSubDelete}
                onNoteAdd={onNoteAdd}
                onNoteSave={onNoteSave}
                onNoteDelete={onNoteDelete}
                onAddRight={addRight}
                onAddBelow={addBelow}
              />
            )
          })}

          {!doc.length && !draft && (
            <div
              data-ui
              style={{ position: 'absolute', left: 0, top: 0, width: '100vw', height: '100vh' }}
              className="grid place-items-center pointer-events-none"
            >
              <div className="pointer-events-auto text-center">
                <div className="text-3xl font-semibold text-[#202522] mb-2">Welcome to NoteS</div>
                <div className="text-sm text-[#8B928E] mb-6">Press T then click · or start with a topic</div>
                <button
                  onClick={() => {
                    const v = viewR.current
                    const cx = (innerWidth / 2 - v.x) / v.z
                    const cy = (innerHeight / 2 - v.y) / v.z
                    addRootTopic(cx - 200, cy - 100)
                  }}
                  className="mx-auto flex items-center gap-2 px-5 h-11 rounded-xl text-white font-medium shadow-md hover:shadow-lg transition-shadow"
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
                data-editable
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

        {/* TOOLBAR SUS - Am adaugat scroll orizontal pentru mobil */}
        <motion.div
          data-ui
          initial={{ y: -12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white border border-[#DDE4DF] rounded-xl p-1 shadow-md w-[94vw] sm:w-auto overflow-x-auto overflow-y-hidden whitespace-nowrap"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <span className="px-2 font-semibold hidden sm:block shrink-0" style={{ color: G }}>NoteS</span>
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
                      onClick={() => { focusTopic(r.topic); setShowSearch(false) }}
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

        <div data-ui className="absolute bottom-3 right-3 flex items-center gap-1 bg-white border border-[#DDE4DF] rounded-xl p-1 shadow-md">
          <Btn title="Zoom out" onClick={() => zoomC(1 / 1.2)}><Minus size={16} /></Btn>
          <span className="w-12 text-center text-xs text-[#8B928E]">{Math.round(view.z * 100)}%</span>
          <Btn title="Zoom in" onClick={() => zoomC(1.2)}><Plus size={16} /></Btn>
          <Btn title="Fit all" onClick={fit}><Maximize size={16} /></Btn>
          <Btn title="Reset" onClick={() => fly({ x: 0, y: 0, z: 1 })}><Home size={16} /></Btn>
        </div>

        {focus && (
          <button data-ui onClick={() => setFocus(null)}
            className="absolute top-20 sm:top-3 right-3 flex items-center gap-1 px-3 h-9 bg-white border border-[#DDE4DF] rounded-xl shadow-md text-sm hover:bg-[#F7FAF8]">
            <X size={14} /> Exit focus
          </button>
        )}

        <div data-ui className="absolute bottom-4 left-4 text-xs text-[#8B928E] hidden sm:block">
          {saved ? '✓ Saved locally · export JSON to back up' : 'Saving…'}
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