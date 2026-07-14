import React, { useCallback, useEffect, useState } from 'react';
import type { TaskCard } from '@coddess/shared';
import { api } from './api.js';

const STATUS_STYLE: Record<string, { bg: string; label: string }> = {
  queued: { bg: 'var(--panel-2)', label: 'queued' },
  running: { bg: 'var(--accent)', label: 'running' },
  review: { bg: 'var(--amber)', label: 'review' },
  done: { bg: 'var(--green)', label: 'done' },
};

/**
 * Autonomous orchestration panel. State a high-level goal; Coddess plans an
 * architecture (ordered subtasks) and executes them automatically. This panel
 * shows the live task board; the detailed agent activity streams in the Build tab.
 */
export function OrchestratePanel({
  projectId,
  running,
  onOrchestrate,
  onCancel,
}: {
  projectId: string;
  running: boolean;
  onOrchestrate: (goal: string) => void;
  onCancel: () => void;
}) {
  const [goal, setGoal] = useState('');
  const [tasks, setTasks] = useState<TaskCard[]>([]);

  const refresh = useCallback(async () => {
    try {
      setTasks(await api.listTasks(projectId));
    } catch {
      setTasks([]);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, running ? 1500 : 6000);
    return () => clearInterval(t);
  }, [refresh, running]);

  function start() {
    if (!goal.trim() || running) return;
    onOrchestrate(goal.trim());
  }

  const done = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="orchestrate">
      <div className="orch-intro">
        <h2>Auto-build</h2>
        <p className="muted">
          Describe a whole feature or project goal. Coddess plans the architecture, breaks it into tasks, and builds
          them one after another — automatically. Watch detailed progress in the Build tab.
        </p>
      </div>

      <div className="orch-input">
        <textarea
          placeholder="e.g. 'Build a todo app with add/edit/delete, localStorage persistence, and a clean responsive UI' — Coddess will plan and build the whole thing."
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          disabled={running}
          style={{ minHeight: 80, width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          {running ? (
            <button className="btn danger iconbtn" title="Stop orchestration" onClick={onCancel}>⏹</button>
          ) : (
            <button className="btn primary" onClick={start} disabled={!goal.trim()}>
              Plan &amp; build ▸
            </button>
          )}
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="orch-board">
          <div className="orch-board-head">
            Plan · <strong>{done}/{tasks.length}</strong> done
            <button className="mini" onClick={refresh} style={{ marginLeft: 8 }}>refresh</button>
          </div>
          <div className="orch-tasks">
            {tasks.map((t, i) => {
              const st = STATUS_STYLE[t.status] || STATUS_STYLE.queued!;
              return (
                <div key={t.id} className="orch-task">
                  <span className="orch-num">{i + 1}</span>
                  <span className="orch-title">{t.title}</span>
                  <span className="orch-status" style={{ background: st.bg }}>
                    {t.status === 'running' && <span className="spinner-sm" />}
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
