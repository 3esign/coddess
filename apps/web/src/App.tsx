import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Project, NormalizedEntry, FileNode, ClientMessage } from '@coddess/shared';
import { api, type Health } from './api.js';
import { FileTree, LogView } from './components.js';
import { FolderExplorerModal } from './FolderExplorerModal.js';
import { SettingsModal } from './SettingsModal.js';
import { OrchestratePanel } from './Orchestrate.js';

function useResizer(setWidth: (fn: (w: number) => number) => void, min: number, max: number, dir: 1 | -1) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) * dir;
      setWidth((w) => Math.max(min, Math.min(max, w + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
}

export function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<any[]>([]);
  const [currentChatId, setCurrentChatId] = useState('default');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [leftOpen, setLeftOpen] = useState(() => localStorage.getItem('coddess.leftOpen') !== '0');
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('coddess.sidebarW')) || 300);
  useEffect(() => { localStorage.setItem('coddess.leftOpen', leftOpen ? '1' : '0'); }, [leftOpen]);
  useEffect(() => { localStorage.setItem('coddess.sidebarW', String(sidebarWidth)); }, [sidebarWidth]);
  const startSidebarResize = useResizer(setSidebarWidth, 200, 560, 1);

  const refreshProjects = useCallback(async () => {
    setProjects(await api.listProjects());
  }, []);

  const refreshHealth = useCallback(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api.getSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const refreshChats = useCallback(async (projId: string) => {
    try {
      const list = await api.listChats(projId);
      if (!list.find((c) => c.id === 'default')) list.unshift({ id: 'default', title: 'Default Chat' });
      setChats(list);
    } catch {
      setChats([{ id: 'default', title: 'Default Chat' }]);
    }
  }, []);

  // Poll the server instead of loading once. The old one-shot load meant that
  // if the server was down/restarting at mount (or crashed later), the UI was
  // stuck on "connecting…" with an empty project list forever, with no retry.
  // Now we re-check every few seconds and, the moment the server is reachable
  // again, reload projects + settings so the app self-heals on its own.
  const wasHealthyRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setHealth(h);
        api.getSettings().then((s) => { if (!cancelled) setSettings(s); }).catch(() => {});
        if (!wasHealthyRef.current) {
          wasHealthyRef.current = true;
          refreshProjects();
        }
      } catch {
        if (cancelled) return;
        setHealth(null);
        wasHealthyRef.current = false;
      }
    };
    ping();
    refreshProjects();
    const t = setInterval(ping, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [refreshProjects]);

  useEffect(() => {
    if (selectedId) {
      refreshChats(selectedId);
      setCurrentChatId('default');
    } else {
      setChats([]);
      setCurrentChatId('default');
    }
  }, [selectedId, refreshChats]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  async function createNewChat(projectId: string) {
    // Create immediately with an auto title. (We intentionally do NOT use
    // window.prompt here: in the desktop wrapper it returns null, which silently
    // dropped the new chat — the "New Chat does nothing" bug. Rename is inline.)
    try {
      const existing = chats.filter((c) => c.id !== 'default').length;
      const title = `New Chat ${existing + 1}`;
      const newChat = await api.createChat(projectId, title, selected?.model);
      await refreshChats(projectId);
      setCurrentChatId(newChat.id);
    } catch (e: any) {
      alert('Failed to create chat: ' + e.message);
    }
  }

  async function renameChat(projectId: string, chatId: string, title: string) {
    const clean = title.trim();
    if (!clean) return;
    try {
      await api.renameChat(projectId, chatId, clean);
      await refreshChats(projectId);
    } catch (e: any) {
      alert('Failed to rename chat: ' + e.message);
    }
  }

  async function addContext(dirPath: string) {
    if (!selectedId) return;
    try { await api.addContext(selectedId, dirPath); await refreshProjects(); }
    catch (e: any) { alert('Failed to link folder: ' + e.message); }
  }

  async function removeContext(dirPath: string) {
    if (!selectedId) return;
    try { await api.removeContext(selectedId, dirPath); await refreshProjects(); }
    catch (e: any) { alert('Failed to unlink folder: ' + e.message); }
  }

  async function removeProject(id: string) {
    if (!confirm('Remove this project from the list? Your files are not deleted.')) return;
    try {
      await api.removeProject(id);
      if (selectedId === id) setSelectedId(null);
      await refreshProjects();
    } catch (e: any) {
      alert('Failed to remove project: ' + e.message);
    }
  }

  async function deleteChat(projectId: string, chatId: string) {
    if (!confirm('Are you sure you want to delete this chat session?')) return;
    try {
      await api.deleteChat(projectId, chatId);
      await refreshChats(projectId);
      setCurrentChatId('default');
    } catch (e: any) {
      alert('Failed to delete chat: ' + e.message);
    }
  }

  return (
    <div className="app">
      {leftOpen ? (
        <>
          <Sidebar
            width={sidebarWidth}
            onCollapse={() => setLeftOpen(false)}
            health={health}
            projects={projects}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={refreshProjects}
            onOpenSettings={() => setIsSettingsOpen(true)}
            chats={chats}
            currentChatId={currentChatId}
            onSelectChat={setCurrentChatId}
            onCreateChat={() => createNewChat(selectedId!)}
            onDeleteChat={(chatId) => deleteChat(selectedId!, chatId)}
            onRenameChat={(chatId, title) => renameChat(selectedId!, chatId, title)}
            onRemoveProject={removeProject}
            onAddContext={addContext}
            onRemoveContext={removeContext}
          />
          <div className="resizer col" onMouseDown={startSidebarResize} title="Drag to resize" />
        </>
      ) : (
        <button className="panel-reopen" onClick={() => setLeftOpen(true)} title="Show projects panel">☰</button>
      )}
      <main className="main">
        {selected ? (
          <ProjectView
            key={selected.id}
            project={selected}
            health={health}
            settings={settings}
            onChange={refreshProjects}
            chats={chats}
            currentChatId={currentChatId}
            setCurrentChatId={setCurrentChatId}
            refreshChats={() => refreshChats(selected.id)}
            onCreateChat={() => createNewChat(selected.id)}
            onDeleteChat={(chatId) => deleteChat(selected.id, chatId)}
            leftOpen={leftOpen}
            onToggleLeft={() => setLeftOpen((v) => !v)}
          />
        ) : (
          <Welcome hasProjects={projects.length > 0} />
        )}
      </main>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onSave={refreshHealth} />
    </div>
  );
}

/* ---------------- Sidebar ---------------- */

function Sidebar({
  width, onCollapse, health, projects, selectedId, onSelect, onChange, onOpenSettings,
  chats, currentChatId, onSelectChat, onCreateChat, onDeleteChat, onRenameChat, onRemoveProject, onAddContext, onRemoveContext,
}: {
  width: number;
  onCollapse: () => void;
  health: Health | null;
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: () => void;
  onOpenSettings: () => void;
  chats: any[];
  currentChatId: string;
  onSelectChat: (id: string) => void;
  onCreateChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onRemoveProject: (id: string) => void;
  onAddContext: (dir: string) => void;
  onRemoveContext: (dir: string) => void;
}) {
  const [path, setPath] = useState('');
  const [ctxPath, setCtxPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  async function add() {
    if (!path.trim()) return;
    setAdding(true);
    setErr('');
    try {
      const p = await api.addProject(path.trim(), undefined, health?.models[0]?.id);
      setPath('');
      await onChange();
      onSelect(p.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="brand" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <span className="mark">CD</span> Coddess
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn outline mini" onClick={onOpenSettings} style={{ padding: '4px 8px' }}>Settings</button>
          <button className="btn outline mini" onClick={onCollapse} title="Hide panel" style={{ padding: '4px 9px' }}>«</button>
        </div>
      </div>

      <div className="add">
        <div className="add-input-row">
          <input className="pathinput" placeholder="Paste a project folder path…" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn outline" onClick={() => setIsExplorerOpen(true)} disabled={adding}>Browse</button>
        </div>
        <button className="btn primary" onClick={add} disabled={adding || !path.trim()}>{adding ? '…' : '+ Add project'}</button>
        {err && <div className="err-inline">{err}</div>}
      </div>

      <div className="plist">
        {projects.length === 0 && <div className="empty small">No projects yet.</div>}
        {projects.map((p) => (
          <div key={p.id} className={`pitem ${p.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(p.id)}>
            <div className="pitem-head">
              <div className="pname">{p.name}</div>
              <button className="pitem-x" onClick={(e) => { e.stopPropagation(); onRemoveProject(p.id); }} title="Remove from list">✕</button>
            </div>
            <div className="ppath">{p.path}</div>

            {p.id === selectedId && (
              <div className="sub-chats-list" style={{ marginLeft: '12px', marginTop: '8px', borderLeft: '2px solid rgba(255,255,255,0.08)', paddingLeft: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }} onClick={(e) => { e.stopPropagation(); setChatsCollapsed(!chatsCollapsed); }}>
                  <span style={{ fontSize: '10px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {chatsCollapsed ? '▶' : '▼'} chats ({chats.length})
                  </span>
                  {!chatsCollapsed && (
                    <button className="mini outline" onClick={(e) => { e.stopPropagation(); onCreateChat(); }} style={{ padding: '1px 6px', fontSize: '9px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>+ New</button>
                  )}
                </div>
                {!chatsCollapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {chats.map((c) => (
                      <div key={c.id} style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', background: c.id === currentChatId ? 'var(--accent)' : 'transparent', color: c.id === currentChatId ? '#ffffff' : 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }} onClick={(e) => { e.stopPropagation(); onSelectChat(c.id); }}>
                        {editingChatId === c.id ? (
                          <input
                            autoFocus
                            value={editTitle}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={() => { onRenameChat(c.id, editTitle); setEditingChatId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); onRenameChat(c.id, editTitle); setEditingChatId(null); }
                              if (e.key === 'Escape') setEditingChatId(null);
                            }}
                            style={{ flex: 1, fontSize: '11px', padding: '1px 4px', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff' }}
                          />
                        ) : (
                          <span
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            title={c.id !== 'default' ? 'Double-click to rename' : undefined}
                            onDoubleClick={(e) => { if (c.id !== 'default') { e.stopPropagation(); setEditTitle(c.title); setEditingChatId(c.id); } }}
                          >
                            {c.title}
                            {c.status === 'running' && <span title="Running">•</span>}
                            {c.status === 'paused' && <span title="Paused">‖</span>}
                          </span>
                        )}
                        {c.id !== 'default' && editingChatId !== c.id && (
                          <button className="mini danger" onClick={(e) => { e.stopPropagation(); onDeleteChat(c.id); }} style={{ padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--red)', fontSize: '10px', opacity: 0.6 }} title="Delete Chat">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {p.id === selectedId && (
              <div className="ctxlist">
                <div className="ctx-head">context folders ({(p.contextDirs || []).length})</div>
                {(p.contextDirs || []).map((d) => (
                  <div key={d} className="ctx-item">
                    <span className="ctx-path" title={d}>{d}</span>
                    <button className="pitem-x" onClick={(e) => { e.stopPropagation(); onRemoveContext(d); }} title="Unlink">✕</button>
                  </div>
                ))}
                <input className="pathinput ctx-input" placeholder="Link a folder as read-only context…" value={ctxPath}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setCtxPath(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && ctxPath.trim()) { e.stopPropagation(); onAddContext(ctxPath.trim()); setCtxPath(''); } }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="health">
        <div className={`dot ${health?.ollamaReachable ? 'green' : 'red'}`} />
        {health ? (health.ollamaReachable ? `Ollama · ${health.models.length} model${health.models.length === 1 ? '' : 's'}` : 'Ollama not reachable') : 'connecting…'}
      </div>

      <FolderExplorerModal isOpen={isExplorerOpen} onClose={() => setIsExplorerOpen(false)} onSelect={(selectedPath) => setPath(selectedPath)} initialPath={path} />
    </aside>
  );
}

function Welcome({ hasProjects }: { hasProjects: boolean }) {
  return (
    <div className="welcome">
      <h1>Mission Control</h1>
      <p>{hasProjects ? 'Select a project on the left.' : 'Add a project folder to begin.'} Each folder gets its own dashboard. Describe what you want built and the agent works inside that folder.</p>
    </div>
  );
}

/* ---------------- Project view ---------------- */

function ProjectView({
  project, health, settings, onChange, chats, currentChatId, setCurrentChatId,
  refreshChats, onCreateChat, onDeleteChat, leftOpen, onToggleLeft,
}: {
  project: Project;
  health: Health | null;
  settings: any;
  onChange: () => void;
  chats: any[];
  currentChatId: string;
  setCurrentChatId: (id: string) => void;
  refreshChats: () => void;
  onCreateChat: () => void;
  onDeleteChat: (chatId: string) => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [events, setEvents] = useState<NormalizedEntry[]>([]);
  const [model, setModel] = useState(project.model || health?.defaultModel || '');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [viewer, setViewer] = useState<{ path: string; content: string } | null>(null);

  interface ChatRunState {
    running: boolean; runId: string | null; liveText: string; currentRunTokens: number; pausing: boolean; coddessLiveText: string;
  }

  const [runStates, setRunStates] = useState<Record<string, ChatRunState>>({});
  const [chatBudgets, setChatBudgets] = useState<Record<string, { maxTokens: number; maxChatLimit: number }>>({});
  const [maxProjectLimit, setMaxProjectLimit] = useState(10000000);
  const [projectMaxTokens, setProjectMaxTokens] = useState(1000000);
  const tab = 'build';
  const [editingMax, setEditingMax] = useState<'chat' | 'proj' | null>(null);
  const [justQueued, setJustQueued] = useState(false);

  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem('coddess.rightOpen') !== '0');
  const [filesWidth, setFilesWidth] = useState(() => Number(localStorage.getItem('coddess.filesW')) || 340);
  useEffect(() => { localStorage.setItem('coddess.rightOpen', rightOpen ? '1' : '0'); }, [rightOpen]);
  useEffect(() => { localStorage.setItem('coddess.filesW', String(filesWidth)); }, [filesWidth]);
  const startFilesResize = useResizer(setFilesWidth, 220, 700, -1);

  const activeBudget = chatBudgets[currentChatId] || { maxTokens: 10000, maxChatLimit: 100000 };
  const maxTokens = activeBudget.maxTokens;
  const maxChatLimit = activeBudget.maxChatLimit;

  const setMaxTokens = (val: number) => setChatBudgets((prev) => ({ ...prev, [currentChatId]: { ...(prev[currentChatId] || { maxTokens: 10000, maxChatLimit: 100000 }), maxTokens: val } }));
  const setMaxChatLimit = (val: number) => setChatBudgets((prev) => {
    const cur = prev[currentChatId] || { maxTokens: 10000, maxChatLimit: 100000 };
    return { ...prev, [currentChatId]: { maxChatLimit: val, maxTokens: Math.min(cur.maxTokens, val) } };
  });

  const activeState = runStates[currentChatId] || { running: false, runId: null, liveText: '', currentRunTokens: 0, pausing: false, coddessLiveText: '' };
  const running = activeState.running;
  const runId = activeState.runId;
  const liveText = activeState.liveText;
  const currentRunTokens = activeState.currentRunTokens;
  const pausing = activeState.pausing;
  const coddessLiveText = activeState.coddessLiveText;

  const runIdRef = useRef<string | null>(null);
  useEffect(() => { runIdRef.current = runId; }, [runId]);

  const wsRef = useRef<WebSocket | null>(null);
  const outboxRef = useRef<ClientMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const refreshTree = useCallback(() => {
    api.tree(project.id).then(setTree).catch(() => setTree([]));
  }, [project.id]);

  useEffect(() => { refreshTree(); }, [project.id, refreshTree]);
  useEffect(() => { api.chatHistory(project.id, currentChatId).then(setEvents).catch(() => setEvents([])); }, [project.id, currentChatId]);

  const handleEventRef = useRef(handleEvent);
  useEffect(() => { handleEventRef.current = handleEvent; });

  // Auto-reconnecting WebSocket. The old code opened the socket once and never
  // recovered: after ANY drop (server restart, `tsx watch` reload, laptop
  // sleep, a network blip) send() silently no-op'd forever, so runs, queued
  // messages, Stop and Pause all stopped working until a full page reload —
  // exactly the "buttons do nothing / queued messages don't work" symptom. Now
  // we reconnect with backoff, re-subscribe on open, and flush a small outbox
  // of anything the user did while briefly disconnected.
  useEffect(() => {
    let closedByUnmount = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = (ws: WebSocket) => {
      const pending = outboxRef.current;
      outboxRef.current = [];
      for (const m of pending) {
        try { ws.send(JSON.stringify(m)); } catch { outboxRef.current.push(m); }
      }
    };

    const connect = () => {
      if (closedByUnmount) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        try { ws.send(JSON.stringify({ type: 'subscribe', projectId: project.id } as ClientMessage)); } catch { /* ignore */ }
        flush(ws);
      };
      ws.onmessage = (m) => { const e = JSON.parse(m.data) as NormalizedEntry; handleEventRef.current(e); };
      ws.onclose = () => {
        setConnected(false);
        if (closedByUnmount) return;
        attempt += 1;
        const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000); // 2s → 15s backoff
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* onclose schedules the reconnect */ } };
    };

    connect();
    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  function send(msg: ClientMessage) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); return; } catch { /* fall through to queue */ }
    }
    // Not open yet: queue it (capped) so a click during a brief reconnect isn't
    // lost — onopen flushes the outbox once the socket is back.
    const q = outboxRef.current;
    q.push(msg);
    if (q.length > 25) q.splice(0, q.length - 25);
  }

  const updateRunState = (chatId: string, patch: Partial<ChatRunState>) => {
    setRunStates((prev) => {
      const cur = prev[chatId] || { running: false, runId: null, liveText: '', currentRunTokens: 0, pausing: false, coddessLiveText: '' };
      return { ...prev, [chatId]: { ...cur, ...patch } };
    });
  };

  function handleEvent(e: NormalizedEntry) {
    const targetChatId = e.chatId || currentChatId;

    if (e.kind === 'coddess_opinion') {
      if (e.text === '__DONE__') {
        setRunStates((prev) => {
          const cur = prev[targetChatId];
          const fullText = cur ? cur.coddessLiveText : '';
          if (targetChatId === currentChatId) setEvents((pe) => [...pe, { kind: 'coddess_opinion', runId: e.runId, projectId: e.projectId, ts: Date.now(), text: fullText }]);
          return { ...prev, [targetChatId]: { ...(cur || { running: false, runId: null, liveText: '', currentRunTokens: 0, pausing: false }), coddessLiveText: '' } };
        });
      } else {
        setRunStates((prev) => {
          const cur = prev[targetChatId] || { running: false, runId: null, liveText: '', currentRunTokens: 0, pausing: false, coddessLiveText: '' };
          return { ...prev, [targetChatId]: { ...cur, coddessLiveText: cur.coddessLiveText + e.text } };
        });
      }
      return;
    }

    if (e.kind === 'assistant_token') {
      setRunStates((prev) => {
        const cur = prev[targetChatId] || { running: false, runId: null, liveText: '', currentRunTokens: 0, pausing: false, coddessLiveText: '' };
        return { ...prev, [targetChatId]: { ...cur, liveText: cur.liveText + e.text, currentRunTokens: cur.currentRunTokens + Math.ceil(e.text.length / 4) } };
      });
      return;
    }

    updateRunState(targetChatId, { liveText: '' });
    if (targetChatId === currentChatId) setEvents((prev) => [...prev, e]);

    if (e.kind === 'status') {
      if (e.status === 'running') updateRunState(targetChatId, { running: true, runId: e.runId });
      else { updateRunState(targetChatId, { running: false, runId: null, pausing: false }); refreshChats(); }
    }
    if (e.kind === 'tool_result' && (e.tool === 'write_file' || e.tool === 'edit_file' || e.tool === 'git' || e.tool === 'run')) refreshTree();
    if (e.kind === 'final') refreshTree();
    if (e.kind === 'error') { updateRunState(targetChatId, { running: false, pausing: false }); refreshChats(); }
  }

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, liveText]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'auto' }); }, [currentChatId]);

  useEffect(() => {
    const id = requestAnimationFrame(() => logEndRef.current?.scrollIntoView({ behavior: 'auto' }));
    return () => cancelAnimationFrame(id);
  }, []);

  function run() {
    if (!prompt.trim() || running) return;
    setViewer(null);
    updateRunState(currentChatId, { running: true, runId: null, liveText: '', currentRunTokens: 0, pausing: false, coddessLiveText: '' });
    send({
      type: 'orchestrate', projectId: project.id, goal: prompt.trim(), model: model || undefined, chatId: currentChatId,
      maxTokens: maxTokens === maxChatLimit ? undefined : maxTokens,
      projectMaxTokens: projectMaxTokens === maxProjectLimit ? undefined : projectMaxTokens,
    });
    setPrompt('');
  }

  function sendInject() {
    if (!prompt.trim() || !running) return;
    send({ type: 'inject', projectId: project.id, chatId: currentChatId, text: prompt.trim() });
    setPrompt('');
    setJustQueued(true);
    window.setTimeout(() => setJustQueued(false), 2500);
  }

  function cancel() {
    const id = runIdRef.current || runId;
    if (id) send({ type: 'cancel', projectId: project.id, runId: id });
    updateRunState(currentChatId, { running: false, pausing: false, runId: null });
  }

  function pause() {
    const id = runIdRef.current || runId;
    if (id) {
      send({ type: 'pause', projectId: project.id, runId: id });
      updateRunState(currentChatId, { pausing: true });
    }
  }

  async function resetChat() {
    if (running) return;
    if (!confirm('Clear chat history?')) return;
    await api.clearHistory(project.id);
    setEvents([]);
    refreshChats();
  }

  async function openFile(path: string) {
    try { setViewer(await api.file(project.id, path)); } catch { /* ignore */ }
  }

  async function saveModel(m: string) {
    setModel(m);
    await api.updateProject(project.id, { model: m });
    onChange();
  }

  const parseModelId = (fullId: string) => {
    if (!fullId) return { provider: 'ollama', modelId: '' };
    if (fullId.startsWith('openrouter/')) return { provider: 'openrouter', modelId: fullId };
    if (fullId.startsWith('anthropic/')) return { provider: 'anthropic', modelId: fullId };
    if (fullId.startsWith('claude-')) return { provider: 'anthropic', modelId: `anthropic/${fullId}` };
    if (fullId.startsWith('gemini/')) return { provider: 'gemini', modelId: fullId };
    if (fullId.startsWith('gemini-')) return { provider: 'gemini', modelId: `gemini/${fullId}` };
    if (fullId.startsWith('kimi/')) return { provider: 'kimi', modelId: fullId };
    if (fullId.startsWith('moonshot-')) return { provider: 'kimi', modelId: `kimi/${fullId}` };
    if (fullId.startsWith('deepseek/')) return { provider: 'deepseek', modelId: fullId };
    if (fullId.startsWith('deepseek-')) return { provider: 'deepseek', modelId: `deepseek/${fullId}` };
    if (fullId.startsWith('custom/')) { const parts = fullId.split('/'); return { provider: `custom-${parts[1] || ''}`, modelId: fullId }; }
    return { provider: 'ollama', modelId: fullId };
  };

  const models = health?.models ?? [];
  const parsed = parseModelId(model);
  const selectedProvider = parsed.provider;
  const selectedModelId = parsed.modelId;
  const filteredModels = models.filter((m) => m.provider === selectedProvider);

  const handleProviderChange = (newProvider: string) => {
    const firstModel = models.find((m) => m.provider === newProvider);
    saveModel(firstModel ? firstModel.id : '');
  };

  const isKeyMissing = () => {
    if (!settings) return false;
    const m: Record<string, string> = { anthropic: 'anthropic', gemini: 'gemini', openrouter: 'openrouter', deepseek: 'deepseek', kimi: 'kimi' };
    const k = m[selectedProvider];
    return !!k && !settings.apiKeys?.[k];
  };

  const activeChat = chats.find((c) => c.id === currentChatId);
  const baseTotalTokens = activeChat?.totalTokens || 0;
  const totalTokens = running ? baseTotalTokens + currentRunTokens : baseTotalTokens;
  const runningTokensSum = Object.values(runStates).reduce((acc, s) => acc + (s.running ? s.currentRunTokens : 0), 0);
  const projectTotalTokens = chats.reduce((acc, c) => acc + (c.totalTokens || 0), 0) + runningTokensSum;

  const fmtK = (n: number, max: number) => (n === max ? '∞' : `${Math.round(n / 1000)}k`);

  return (
    <div className="pview">
      <div className="pmain">
      <header className="phead">
        <div className="phead-left">
          <button className="iconbtn ghost" onClick={onToggleLeft} title={leftOpen ? 'Hide projects' : 'Show projects'}>☰</button>
          <div className="phtitle">
            <h1>{project.name}</h1>
            <div className="phpath">{project.path}</div>
          </div>
        </div>
        <div className="phead-right">
          {currentChatId === 'default' && <button className="btn outline mini" onClick={resetChat} disabled={running}>Reset</button>}
          {isKeyMissing() && <span className="keywarn">API key not set</span>}
          <div className="pick">
            <label>provider</label>
            <select value={selectedProvider} onChange={(e) => handleProviderChange(e.target.value)} disabled={running}>
              <option value="ollama">Ollama (Local)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="gemini">Google (Gemini)</option>
              <option value="openrouter">OpenRouter (Cloud)</option>
              <option value="deepseek">DeepSeek</option>
              <option value="kimi">Kimi (Moonshot)</option>
              {(settings?.customProviders ?? []).map((p: any) => <option key={p.id} value={`custom-${p.id}`}>{p.name}</option>)}
            </select>
          </div>
          <div className="pick">
            <label>model</label>
            <select value={selectedModelId} onChange={(e) => saveModel(e.target.value)} disabled={running}>
              {filteredModels.length === 0 && <option value="">(no models)</option>}
              {filteredModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <button className="iconbtn ghost" onClick={() => setRightOpen((v) => !v)} title={rightOpen ? 'Hide files' : 'Show files'}>▤</button>
        </div>
      </header>

      <section className="middle">
            <div className="buildpane">
              <div className="pane-title">Activity log {running && <span className="spinner" />}{!connected && <span className="muted small" style={{ marginLeft: 8, color: 'var(--red)' }}>· reconnecting…</span>}</div>
              <div ref={logScrollRef} className="logscroll">
                <LogView events={events} />
                {liveText && (
                  <div className="ev streaming">
                    <div className="k">generating…</div>
                    <div className="body mono">{liveText.slice(-2000)}</div>
                  </div>
                )}
                {coddessLiveText && (
                  <div className="ev coddess streaming">
                    <div className="k">observer reviewing…</div>
                    <div className="body" style={{ whiteSpace: 'pre-wrap' }}>{coddessLiveText}</div>
                  </div>
                )}
                <div ref={logEndRef} />
              </div>

              <div className="composer">
                <textarea
                  placeholder={running ? 'Agent is working — type to queue a message. It will be inserted and considered before the next step.' : 'Describe what to build inside this folder. Coddess auto-detects the task type, plans, builds, and verifies.'}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), running ? sendInject() : run())}
                />
                <div className="composer-row">
                  <div className="cbudget" title="Per-chat token budget. Drag to set; double-click the value to edit the maximum.">
                    <span className="cb-label">chat</span>
                    <input type="range" min={1000} max={maxChatLimit} step={1000} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} disabled={running} />
                    {editingMax === 'chat' ? (
                      <input className="cb-max" type="number" autoFocus value={maxChatLimit} min={1000} step={1000}
                        onChange={(e) => setMaxChatLimit(Math.max(1000, Number(e.target.value)))}
                        onBlur={() => setEditingMax(null)} onKeyDown={(e) => e.key === 'Enter' && setEditingMax(null)} />
                    ) : (
                      <span className="cb-val" title="Double-click to edit the maximum" onDoubleClick={() => setEditingMax('chat')}>{fmtK(maxTokens, maxChatLimit)}</span>
                    )}
                  </div>
                  <div className="cbudget" title="Whole-project token budget. Drag to set; double-click the value to edit the maximum.">
                    <span className="cb-label">proj</span>
                    <input type="range" min={10000} max={maxProjectLimit} step={10000} value={projectMaxTokens} onChange={(e) => setProjectMaxTokens(Number(e.target.value))} disabled={running} />
                    {editingMax === 'proj' ? (
                      <input className="cb-max" type="number" autoFocus value={maxProjectLimit} min={10000} step={10000}
                        onChange={(e) => setMaxProjectLimit(Math.max(10000, Number(e.target.value)))}
                        onBlur={() => setEditingMax(null)} onKeyDown={(e) => e.key === 'Enter' && setEditingMax(null)} />
                    ) : (
                      <span className="cb-val" title="Double-click to edit the maximum" onDoubleClick={() => setEditingMax('proj')}>{fmtK(projectMaxTokens, maxProjectLimit)}</span>
                    )}
                  </div>
                  <div className="ctokens">
                    <span title="Tokens used so far in the current run">▲{currentRunTokens.toLocaleString()}</span>
                    {' · '}
                    <span title="Total tokens accumulated in this chat">Σ{totalTokens.toLocaleString()}</span>
                    {' · '}
                    <span title="Total tokens across every chat in this project">Π{projectTotalTokens.toLocaleString()}</span>
                  </div>
                  <span className="muted small ctip">{justQueued ? 'message queued' : running ? 'Enter to queue a message' : 'Enter to send · Shift+Enter newline'}</span>
                  <div className="cactions">
                    {running ? (
                      <>
                        {prompt.trim() && <button className="btn outline" onClick={sendInject} title="Queue this message for the running agent">Queue</button>}
                        <button className="btn danger iconbtn" style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 'bold' }} onClick={cancel} title="Stop">Stop</button>
                      </>
                    ) : (
                      <button className="btn primary" onClick={run} disabled={!prompt.trim()}>{activeChat?.status === 'paused' ? 'Continue' : 'Run'}</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
        </section>
      </div>
      {rightOpen && (
          <>
            <div className="resizer col" onMouseDown={startFilesResize} title="Drag to resize" />
            <aside className="filespane" style={{ width: filesWidth }}>
              <div className="pane-title">
                Files
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="mini" onClick={refreshTree}>refresh</button>
                  <button className="mini" onClick={() => setRightOpen(false)} title="Hide files">✕</button>
                </div>
              </div>
              {viewer ? (
                <div className="fileview">
                  <div className="fileview-head">
                    <span className="mono">{viewer.path}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="mini primary" onClick={() => { api.openFileNatively(project.id, viewer.path).catch((e) => alert('Failed to open file: ' + e.message)); }}>Open</button>
                      <button className="mini" onClick={() => setViewer(null)}>close</button>
                    </div>
                  </div>
                  <pre className="filecode">{viewer.content}</pre>
                </div>
              ) : (
                <div className="treescroll">
                  <FileTree nodes={tree} onOpen={openFile} onDoubleClickFile={(path) => api.openFileNatively(project.id, path)} />
                </div>
              )}
            </aside>
          </>
        )}
    </div>
  );
}
