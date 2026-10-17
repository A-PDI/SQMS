import { useRef } from 'react'
import { filePreviewUrl, fileDownloadUrl } from '@/lib/api'

export default function ItemAttachment({ sectionKey, itemId, attachments = [], onUpload, onDelete, readOnly = false }) {
  const input = useRef(null)
  const rows = attachments.filter(a => a.section_key === sectionKey && String(a.item_id) === String(itemId))
  return <div className="flex flex-wrap items-center gap-2">
    {!readOnly && onUpload && <><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => input.current?.click()}>Photo</button><input ref={input} className="hidden" type="file" accept="image/png,image/jpeg" aria-label="Attach inspection photo" onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(file, sectionKey, itemId); e.target.value = '' }} /></>}
    {rows.map(a => <span key={a.id} className="flex items-center gap-1 text-xs">{a.file.status === 'CLEAN' ? <a href={fileDownloadUrl(a.file.id)} target="_blank" rel="noreferrer"><img src={filePreviewUrl(a.file.id)} alt={a.description || a.file.originalFilename} className="size-9 rounded object-cover" /></a> : <span>{a.file.status === 'QUARANTINED' ? 'Scanning…' : a.file.status}</span>}{!readOnly && onDelete && <button type="button" aria-label="Remove photo" onClick={() => onDelete(a.id)}>×</button>}</span>)}
  </div>
}
