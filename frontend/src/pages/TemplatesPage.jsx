import { useState, useEffect } from 'react';
import { templates as api, ai as aiApi } from '../services/api';
import UserLayout from '../layouts/UserLayout';

const VAR_REGEX = /\{\{(\w+)\}\}/g;

function extractVars(body) {
  return [...new Set([...body.matchAll(VAR_REGEX)].map((m) => m[1]))];
}

function TemplateModal({ template, onClose, onSaved }) {
  const [form, setForm] = useState(template || { name: '', body: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const vars = extractVars(form.body);
  const charCount = form.body.length;

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (template) {
        await api.update(template.id, form);
      } else {
        await api.create(form);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  function insertVar() {
    const name = prompt('Nome da variável (ex: nome, cidade):');
    if (!name) return;
    set('body', form.body + `{{${name.trim()}}}`);
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <h2 className="modal-title">{template ? 'Editar Modelo' : 'Novo Modelo'}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nome do modelo *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="Ex: Oferta Black Friday" />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>Mensagem *</label>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={insertVar}>
                + variável
              </button>
            </div>
            <textarea
              value={form.body}
              onChange={(e) => set('body', e.target.value)}
              required
              placeholder={"Olá {{nome}}, temos uma oferta especial para você em {{cidade}}!"}
              rows={5}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                Use <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{'{{variavel}}'}</code> para campos dinâmicos
              </span>
              <span className={`char-count${charCount > 160 ? ' warn' : ''}`}>
                {charCount} chars · {Math.ceil(charCount / 160) || 1} SMS
              </span>
            </div>
          </div>

          {vars.length > 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: '#166534', fontWeight: 600, marginBottom: 4 }}>
                Variáveis detectadas:
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {vars.map((v) => (
                  <span key={v} style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [templateList, setTemplateList] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    api.list().then(({ data }) => { setTemplateList(data); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id, name) {
    if (!confirm(`Excluir modelo "${name}"?`)) return;
    try {
      await api.remove(id);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao excluir');
    }
  }

  return (
    <UserLayout>
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Modelos de Mensagem</h1>
        <button className="btn btn-primary" onClick={() => setModal('new')}>+ Novo Modelo</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Mensagem</th>
                <th>Variáveis</th>
                <th>Chars</th>
                <th>Criado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>Carregando...</td></tr>
              ) : templateList.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      <div style={{ fontSize: 32 }}>✏️</div>
                      <p>Nenhum modelo criado ainda</p>
                    </div>
                  </td>
                </tr>
              ) : (
                templateList.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 500 }}>{t.name}</td>
                    <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6b7280' }} title={t.body}>
                      {t.body}
                    </td>
                    <td>
                      {t.variables.length === 0 ? (
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>nenhuma</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {t.variables.map((v) => (
                            <span key={v} style={{ background: '#ede9fe', color: '#5b21b6', padding: '1px 6px', borderRadius: 999, fontSize: 11 }}>
                              {`{{${v}}}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {t.body.length}
                      {t.body.length > 160 && <span style={{ color: '#f59e0b', marginLeft: 4 }}>↑{Math.ceil(t.body.length / 160)} SMS</span>}
                    </td>
                    <td style={{ color: '#9ca3af', fontSize: 12 }}>
                      {new Date(t.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setModal(t)}>Editar</button>
                        <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handleDelete(t.id, t.name)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <TemplateModal
          template={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
    </UserLayout>
  );
}
