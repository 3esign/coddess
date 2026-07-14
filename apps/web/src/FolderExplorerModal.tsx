import React, { useEffect, useState } from 'react';
import { api } from './api.js';

interface FolderExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

export function FolderExplorerModal({ isOpen, onClose, onSelect, initialPath }: FolderExplorerModalProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath || '');
    }
  }, [isOpen, initialPath]);

  async function loadDirectory(path?: string) {
    setLoading(true);
    setError('');
    try {
      const data = await api.listDir(path);
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setDirectories(data.directories);
      setDrives(data.drives || []);
      setShowNewFolderInput(false);
      setNewFolderName('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await api.makeDir(currentPath, newFolderName.trim());
      loadDirectory(currentPath);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <header className="modal-header">
          <h3>Select Project Folder</h3>
          <button className="btn-close" onClick={onClose}>✕</button>
        </header>

        <div className="modal-body">
          <div className="path-bar">
            <strong>Path:</strong> <span className="mono">{currentPath || 'Loading...'}</span>
          </div>

          {error && <div className="err-inline" style={{ margin: '8px 0' }}>{error}</div>}

          {drives.length > 0 && (
            <div className="drives-row">
              <strong>Drives:</strong>
              {drives.map(drive => (
                <button
                  key={drive}
                  className={`btn-drive ${currentPath.startsWith(drive) ? 'active' : ''}`}
                  onClick={() => loadDirectory(drive)}
                >
                  {drive}
                </button>
              ))}
            </div>
          )}

          <div className="dir-list-container">
            {loading ? (
              <div className="loading-state">Loading directories...</div>
            ) : (
              <div className="dir-list">
                {parentPath && (
                  <div className="dir-item parent" onClick={() => loadDirectory(parentPath)}>
                    📁 <span>.. (parent directory)</span>
                  </div>
                )}
                {directories.length === 0 && !parentPath && (
                  <div className="empty-state">No directories found.</div>
                )}
                {directories.map(dir => (
                  <div
                    key={dir}
                    className="dir-item"
                    onClick={() => {
                      const separator = currentPath.endsWith('\\') || currentPath.endsWith('/') ? '' : (currentPath.includes('\\') ? '\\' : '/');
                      loadDirectory(`${currentPath}${separator}${dir}`);
                    }}
                  >
                    📁 <span>{dir}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-actions-row">
            {showNewFolderInput ? (
              <div className="new-folder-form">
                <input
                  type="text"
                  placeholder="New folder name..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  autoFocus
                />
                <button className="btn primary" onClick={handleCreateFolder}>Create</button>
                <button className="btn outline" onClick={() => setShowNewFolderInput(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn outline" onClick={() => setShowNewFolderInput(true)}>
                + New Folder
              </button>
            )}
          </div>
        </div>

        <footer className="modal-footer">
          <button className="btn outline" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={() => {
              onSelect(currentPath);
              onClose();
            }}
            disabled={!currentPath}
          >
            Select Current Folder
          </button>
        </footer>
      </div>
    </div>
  );
}
