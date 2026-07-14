import React, { useState } from 'react';
import type { FileNode, NormalizedEntry } from '@coddess/shared';

/* ---------------- File tree ---------------- */

export function FileTree({ nodes, onOpen, onDoubleClickFile }: { nodes: FileNode[]; onOpen: (path: string) => void; onDoubleClickFile?: (path: string) => void }) {
  if (nodes.length === 0) return <div className="empty">Empty folder</div>;
  return (
    <div className="tree">
      {nodes.map((n) => (
        <TreeNode key={n.path} node={n} onOpen={onOpen} onDoubleClickFile={onDoubleClickFile} depth={0} />
      ))}
    </div>
  );
}

function TreeNode({ node, onOpen, onDoubleClickFile, depth }: { node: FileNode; onOpen: (p: string) => void; onDoubleClickFile?: (p: string) => void; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const pad = { paddingLeft: 8 + depth * 12 };
  if (node.type === 'dir') {
    return (
      <div>
        <div className="tnode dir" style={pad} onClick={() => setOpen(!open)}>
          <span className="caret">{open ? '▾' : '▸'}</span> {node.name}
        </div>
        {open && node.children?.map((c) => <TreeNode key={c.path} node={c} onOpen={onOpen} onDoubleClickFile={onDoubleClickFile} depth={depth + 1} />)}
      </div>
    );
  }
  return (
    <div
      className="tnode file"
      style={pad}
      onClick={() => onOpen(node.path)}
      onDoubleClick={() => onDoubleClickFile?.(node.path)}
    >
      <span className="caret" /> {node.name}
    </div>
  );
}

/* ---------------- Log view ---------------- */

export function LogView({ events }: { events: NormalizedEntry[] }) {
  if (events.length === 0) {
    return <div className="empty">No activity yet. Describe what to build and press Run.</div>;
  }
  return (
    <div className="log">
      {events.map((e, i) => (
        <LogEntry key={i} e={e} />
      ))}
    </div>
  );
}

function LogEntry({ e }: { e: NormalizedEntry }) {
  const [expanded, setExpanded] = useState(false);

  switch (e.kind) {
    case 'status':
      return <div className={`ev status s-${e.status}`}>● {e.status}{e.detail ? ` — ${e.detail}` : ''}</div>;
    case 'user_prompt': {
      const taskMatch = e.text.match(/^\[TASK:\s*([^\]]+)\]\n([\s\S]*)$/);
      const label = taskMatch ? taskMatch[1] : null;
      const promptText = taskMatch ? taskMatch[2] : e.text;

      let badgeColor = 'var(--accent)';
      if (label === 'BUG FIX') badgeColor = 'var(--red)';
      else if (label === 'REFACTOR') badgeColor = 'var(--amber)';
      else if (label === 'OPTIMIZATION') badgeColor = 'var(--teal)';
      else if (label === 'RESEARCH') badgeColor = 'var(--purple)';

      return (
        <div className="ev user">
          <div className="k" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>user</span>
            {label && (
              <span style={{ fontSize: '9px', textTransform: 'uppercase', background: badgeColor, color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                {label}
              </span>
            )}
          </div>
          <div className="body" style={{ whiteSpace: 'pre-wrap' }}>{promptText}</div>
        </div>
      );
    }
    case 'spec': {
      const s = e.spec;
      return (
        <div className="ev spec">
          <div className="k" style={{ color: 'var(--accent)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: 8 }}>
            🧭 understood intent
            <span style={{ background: 'var(--accent)', color: '#0d1117', padding: '2px 6px', borderRadius: 4, fontSize: 9 }}>{s.label}</span>
          </div>
          {s.goal && <div className="body" style={{ marginTop: 6 }}><strong>Goal:</strong> {s.goal}</div>}
          {s.stack && <div className="body small" style={{ marginTop: 4, color: 'var(--muted)' }}><strong>Stack:</strong> {s.stack}</div>}
          {s.acceptanceCriteria.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>Acceptance criteria (definition of done):</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.acceptanceCriteria.map((c, i) => <li key={i} style={{ fontSize: 12 }}>{c}</li>)}
              </ul>
            </div>
          )}
          {s.assumptions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="small" style={{ color: 'var(--amber)', marginBottom: 4 }}>Assumptions made:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.assumptions.map((a, i) => <li key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>{a}</li>)}
              </ul>
            </div>
          )}
          {s.openQuestions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>Open questions:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.openQuestions.map((q, i) => <li key={i} style={{ fontSize: 12, color: 'var(--muted)' }}>{q}</li>)}
              </ul>
            </div>
          )}
        </div>
      );
    }
    case 'orchestration':
      return (
        <div className="ev orchestration" style={{ borderLeft: '3px solid var(--accent)', background: 'rgba(163,113,247,0.06)', padding: 12, borderRadius: 8, border: '1px solid rgba(163,113,247,0.18)', margin: '8px 0' }}>
          <div className="k" style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            🧩 orchestrator{e.phase === 'plan' ? ' · plan' : e.phase === 'done' ? ' · complete' : ''}
          </div>
          <div className="body" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{e.text}</div>
          {e.tasks && e.tasks.length > 0 && (
            <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {e.tasks.map((t, i) => <li key={i} style={{ fontSize: 12 }}>{t.title}</li>)}
            </ol>
          )}
        </div>
      );
    case 'assistant_message':
      return (
        <div className="ev assistant">
          <div className="k">assistant</div>
          <div className="body">{e.text}</div>
        </div>
      );
    case 'thinking':
      return (
        <div className="ev thinking">
          <div className="k" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>💭 reasoning</div>
          <div className="body" style={{ marginTop: '6px', whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto' }}>{e.text}</div>
        </div>
      );
    case 'tool_use':
      const shortArgs = summarizeArgs(e.tool, e.args);
      return (
        <div className="ev tool collapsible" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
          <div className="k" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '9px', opacity: 0.6 }}>{expanded ? '▼' : '▶'}</span> 🔧 call tool: <strong style={{ color: 'var(--text)', marginLeft: '4px' }}>{e.tool}</strong>
          </div>
          <div className="body mono" style={{ marginTop: '6px' }}>
            {expanded ? (
              <pre style={{ margin: 0, padding: '8px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', overflowX: 'auto' }}>
                {JSON.stringify(e.args, null, 2)}
              </pre>
            ) : (
              shortArgs
            )}
          </div>
        </div>
      );
    case 'tool_result':
      return (
        <div className={`ev result collapsible ${e.ok ? 'ok' : 'bad'}`} onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
          <div className="k" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '9px', opacity: 0.6 }}>{expanded ? '▼' : '▶'}</span> {e.ok ? '✓' : '✕'} output: <strong style={{ color: 'var(--text)', marginLeft: '4px' }}>{e.tool}</strong>
          </div>
          {expanded && (
            <div className="body mono" style={{ marginTop: '6px' }}>
              <pre style={{ margin: 0, padding: '8px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '11px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {clip(e.output, 10000)}
              </pre>
            </div>
          )}
        </div>
      );
    case 'verify':
      return (
        <div className={`ev verify ${e.ok ? 'ok' : 'bad'}`} onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
          <div className="k" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '9px', opacity: 0.6 }}>{expanded ? '▼' : '▶'}</span>{' '}
            {e.ok ? '✅ verification passed' : `🔁 verification failed — repairing (round ${e.round})`}: <strong style={{ color: 'var(--text)', marginLeft: 4 }}>{e.command}</strong>
          </div>
          {expanded && (
            <div className="body mono" style={{ marginTop: 6 }}>
              <pre style={{ margin: 0, padding: 8, background: 'rgba(0,0,0,0.25)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{clip(e.output, 8000)}</pre>
            </div>
          )}
        </div>
      );
    case 'final':
      return (
        <div className="ev final">
          <div className="k">✓ task complete</div>
          <div className="body">{e.summary}</div>
        </div>
      );
    case 'error':
      return (
        <div className="ev err">
          <div className="k">error</div>
          <div className="body">{e.message}</div>
        </div>
      );
    case 'coddess_opinion':
      return (
        <div className="ev coddess" style={{ borderLeftColor: 'var(--accent)', background: 'rgba(255,255,255,0.015)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', marginTop: '12px' }}>
          <div className="k" style={{ color: 'var(--accent)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            ✨ Coddess Observer Opinion
          </div>
          <div className="body" style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text)', whiteSpace: 'pre-wrap', marginTop: '6px' }}>
            {e.text}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function summarizeArgs(tool: string, args: Record<string, string>): string {
  if (tool === 'write_file') return `${args.path}  (${(args.content ?? '').split('\n').length} lines)`;
  if (tool === 'edit_file') return `${args.path}  (edit)`;
  if (tool === 'search_code') return `/${args.query}/${args.glob ? '  (' + args.glob + ')' : ''}`;
  if (tool === 'read_file' || tool === 'list_dir') return args.path ?? '.';
  if (tool === 'run') return `$ ${args.command}`;
  return JSON.stringify(args);
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n… (${s.length} chars)` : s;
}
