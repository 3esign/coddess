import React, { useState, useEffect } from 'react';
import type { ModelEntry, ModelOverrides } from '@coddess/shared';
import { api } from './api.js';

interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

interface Settings {
  apiKeys: {
    openrouter?: string;
    anthropic?: string;
    gemini?: string;
    kimi?: string;
    deepseek?: string;
  };
  customProviders: CustomProvider[];
  modelOverrides: ModelOverrides;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

const PROVIDERS = ['openrouter', 'anthropic', 'gemini', 'kimi', 'deepseek', 'ollama'];

export function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>({ apiKeys: {}, customProviders: [], modelOverrides: { added: [], hidden: [] } });
  const [catalog, setCatalog] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [newProvName, setNewProvName] = useState('');
  const [newProvBaseUrl, setNewProvBaseUrl] = useState('');
  const [newProvApiKey, setNewProvApiKey] = useState('');
  const [newProvModels, setNewProvModels] = useState('');

  const [newModelProvider, setNewModelProvider] = useState('openrouter');
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError('');
      api.getSettings()
        .then((data) => {
          setSettings({
            apiKeys: data.apiKeys || {},
            customProviders: data.customProviders || [],
            modelOverrides: data.modelOverrides || { added: [], hidden: [] },
          });
        })
        .catch((err) => setError('Failed to load settings: ' + err.message));
      api.health().then((h) => setCatalog(h.models || [])).catch(() => setCatalog([]));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const overrides = settings.modelOverrides;
  const setOverrides = (o: ModelOverrides) => setSettings((prev) => ({ ...prev, modelOverrides: o }));

  const handleApiKeyChange = (provider: keyof Settings['apiKeys'], value: string) => {
    setSettings((prev) => ({ ...prev, apiKeys: { ...prev.apiKeys, [provider]: value } }));
  };

  const handleAddCustomProvider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProvName.trim() || !newProvBaseUrl.trim() || !newProvModels.trim()) {
      setError('Please fill in Name, Base URL, and at least one Model.');
      return;
    }
    const modelsArray = newProvModels.split(',').map((m) => m.trim()).filter(Boolean);
    const newProvider: CustomProvider = {
      id: Math.random().toString(36).substring(2, 9),
      name: newProvName.trim(),
      baseUrl: newProvBaseUrl.trim(),
      apiKey: newProvApiKey.trim() || undefined,
      models: modelsArray,
    };
    setSettings((prev) => ({ ...prev, customProviders: [...prev.customProviders, newProvider] }));
    setNewProvName(''); setNewProvBaseUrl(''); setNewProvApiKey(''); setNewProvModels(''); setError('');
  };

  const handleRemoveCustomProvider = (id: string) => {
    setSettings((prev) => ({ ...prev, customProviders: prev.customProviders.filter((p) => p.id !== id) }));
  };

  function addModel(e: React.FormEvent) {
    e.preventDefault();
    let id = newModelId.trim();
    if (!id) { setError('Enter a model id.'); return; }
    if (newModelProvider === 'openrouter' && !id.startsWith('openrouter/')) id = 'openrouter/' + id;
    const name = newModelName.trim() || id.replace(/^[a-z]+\//, '');
    if (overrides.added.some((m) => m.id === id) || catalog.some((m) => m.id === id)) {
      setError('That model is already in the list.');
      return;
    }
    setOverrides({ ...overrides, added: [...overrides.added, { id, name, provider: newModelProvider }], hidden: overrides.hidden.filter((h) => h !== id) });
    setNewModelId(''); setNewModelName(''); setError('');
  }

  const removeAdded = (id: string) => setOverrides({ ...overrides, added: overrides.added.filter((m) => m.id !== id) });
  const hideModel = (id: string) => setOverrides({ ...overrides, hidden: overrides.hidden.includes(id) ? overrides.hidden : [...overrides.hidden, id] });
  const restoreModel = (id: string) => setOverrides({ ...overrides, hidden: overrides.hidden.filter((h) => h !== id) });

  const hiddenSet = new Set(overrides.hidden);
  const addedIds = new Set(overrides.added.map((m) => m.id));
  const displayed: ModelEntry[] = [
    ...catalog.filter((m) => !hiddenSet.has(m.id)),
    ...overrides.added.filter((a) => !catalog.some((c) => c.id === a.id) && !hiddenSet.has(a.id)),
  ];

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      await api.saveSettings(settings);
      onSave();
      onClose();
    } catch (err: any) {
      setError('Failed to save settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const keyField = (provider: keyof Settings['apiKeys'], label: string, placeholder: string) => (
    <div className="settings-field">
      <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>{label}</label>
      <input type="password" placeholder={placeholder} value={settings.apiKeys[provider] || ''} onChange={(e) => handleApiKeyChange(provider, e.target.value)} style={{ width: '100%' }} />
    </div>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ width: '640px', maxHeight: '90vh' }}>
        <div className="modal-header">
          <h3>⚙️ Global Settings</h3>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto' }}>
          {error && <div className="err-inline" style={{ marginBottom: '10px' }}>{error}</div>}

          <section className="settings-section">
            <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>API Keys</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {keyField('openrouter', 'OpenRouter API Key', 'sk-or-...')}
              {keyField('anthropic', 'Anthropic (Claude) API Key', 'sk-ant-...')}
              {keyField('gemini', 'Google (Gemini) API Key', 'AIzaSy...')}
              {keyField('kimi', 'Kimi (Moonshot) API Key', 'sk-...')}
              {keyField('deepseek', 'DeepSeek API Key', 'sk-...')}
            </div>
          </section>

          <section className="settings-section" style={{ marginTop: '16px' }}>
            <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>Model menu</h4>
            <div className="muted small" style={{ marginBottom: 8 }}>Add specific models (e.g. any OpenRouter model id) to the picker, or hide ones you don't use.</div>

            <form onSubmit={addModel} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr auto', gap: '8px', padding: '10px', background: '#010409', borderRadius: '8px', border: '1px solid var(--border)', alignItems: 'center' }}>
              <select value={newModelProvider} onChange={(e) => setNewModelProvider(e.target.value)}>
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input placeholder={newModelProvider === 'openrouter' ? 'vendor/model (e.g. x-ai/grok-2)' : 'model id'} value={newModelId} onChange={(e) => setNewModelId(e.target.value)} />
              <input placeholder="Display name (optional)" value={newModelName} onChange={(e) => setNewModelName(e.target.value)} />
              <button type="submit" className="btn primary mini">+ Add</button>
            </form>

            {overrides.hidden.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted small" style={{ marginBottom: 4 }}>Hidden ({overrides.hidden.length}) — click to restore:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {overrides.hidden.map((id) => (
                    <button key={id} className="mini" onClick={() => restoreModel(id)} title="Restore" style={{ opacity: 0.7 }}>↩ {id}</button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 10, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {displayed.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-2)', padding: '5px 9px', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <span style={{ fontSize: 12 }}>{m.name}</span>
                    <span className="muted" style={{ fontSize: 10, marginLeft: 8 }}>{m.provider}{addedIds.has(m.id) ? ' · custom' : ''}</span>
                  </div>
                  {addedIds.has(m.id) ? (
                    <button className="mini danger" onClick={() => removeAdded(m.id)} style={{ color: 'var(--red)' }}>remove</button>
                  ) : (
                    <button className="mini" onClick={() => hideModel(m.id)}>hide</button>
                  )}
                </div>
              ))}
              {displayed.length === 0 && <div className="empty small">No models — add one above or configure a provider key.</div>}
            </div>
          </section>

          <section className="settings-section" style={{ marginTop: '16px' }}>
            <h4 style={{ margin: '0 0 10px 0', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>Custom OpenAI-Compatible Providers</h4>
            {settings.customProviders.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                {settings.customProviders.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-2)', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{p.baseUrl}</div>
                      <div style={{ fontSize: '11px', color: 'var(--accent)' }}>Models: {p.models.join(', ')}</div>
                    </div>
                    <button className="btn danger mini" onClick={() => handleRemoveCustomProvider(p.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddCustomProvider} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: '#010409', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 500, fontSize: '12px' }}>Add Custom Provider</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input placeholder="Provider Name (e.g. LocalAI)" value={newProvName} onChange={(e) => setNewProvName(e.target.value)} />
                <input placeholder="Base URL (e.g. http://localhost:8080/v1)" value={newProvBaseUrl} onChange={(e) => setNewProvBaseUrl(e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input type="password" placeholder="API Key (optional)" value={newProvApiKey} onChange={(e) => setNewProvApiKey(e.target.value)} />
                <input placeholder="Models (comma-separated, e.g. llama3, mistral)" value={newProvModels} onChange={(e) => setNewProvModels(e.target.value)} />
              </div>
              <button type="submit" className="btn primary mini" style={{ alignSelf: 'flex-end' }}>+ Add Provider</button>
            </form>
          </section>
        </div>
        <div className="modal-footer">
          <button className="btn outline" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={loading}>{loading ? 'Saving...' : 'Save Settings'}</button>
        </div>
      </div>
    </div>
  );
}
