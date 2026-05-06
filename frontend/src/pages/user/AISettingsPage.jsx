import { useState, useEffect } from 'react';
import { ai as aiApi } from '../../services/api';
import UserLayout from '../../layouts/UserLayout';

const MODELS = [
  { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 — Mais rápido e econômico (recomendado para SMS)' },
  { value: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 — Equilíbrio entre velocidade e qualidade' },
  { value: 'claude-opus-4-7',            label: 'Claude Opus 4.7 — Máxima capacidade (mais caro)' },
];

export default function AISettingsPage() {
  const [status, setStatus]       = useState(null);  // { configured, source, model, keyHint }
  const [apiKey, setApiKey]       = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState(null);

  function loadStatus() {
    aiApi.status().then(r => setStatus(r.data)).catch(() => {});
  }
  useEffect(() => { loadStatus(); }, []);

  async function handleConnect(e) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await aiApi.connect(apiKey.trim());
      setSuccess('✅ API Key conectada com sucesso!');
      setApiKey('');
      loadStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao conectar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Remover sua API Key? O sistema voltará a usar a chave global.')) return;
    setSaving(true);
    try {
      await aiApi.disconnect();
      setSuccess('Chave removida. Usando configuração global.');
      loadStatus();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      const r = await aiApi.suggest('Promoção de verão para loja de roupas', 'animado');
      setTestResult({ ok: true, preview: r.data.suggestions[0]?.slice(0, 120) });
    } catch (err) {
      setTestResult({ ok: false, error: err.response?.data?.error || err.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <UserLayout>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">🤖 Configuração de IA</h1>
        </div>

        {/* Status card */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Status da conexão</h3>
          {!status ? (
            <p style={{ color: '#9ca3af' }}>Carregando...</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: status.configured ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${status.configured ? '#bbf7d0' : '#fecaca'}`,
                borderRadius: 10, padding: '12px 20px',
              }}>
                <span style={{ fontSize: 28 }}>{status.configured ? '✅' : '⚠️'}</span>
                <div>
                  <div style={{ fontWeight: 700, color: status.configured ? '#166534' : '#dc2626' }}>
                    {status.configured ? 'IA Conectada' : 'IA Não Configurada'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    {status.configured
                      ? `Chave: ${status.keyHint} · Origem: ${status.source === 'tenant' ? 'sua conta' : 'global'} · Modelo: ${status.model}`
                      : 'Conecte uma API Key da Anthropic abaixo'
                    }
                  </div>
                </div>
              </div>

              {status.configured && (
                <button className="btn btn-ghost" style={{ fontSize: 13 }}
                  onClick={handleTest} disabled={testing}>
                  {testing ? '⏳ Testando...' : '🧪 Testar IA'}
                </button>
              )}
            </div>
          )}

          {testResult && (
            <div style={{
              marginTop: 16, padding: '12px 16px', borderRadius: 8,
              background: testResult.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${testResult.ok ? '#bbf7d0' : '#fecaca'}`,
            }}>
              {testResult.ok
                ? <><strong style={{ color: '#166534' }}>Teste OK ✓</strong><br /><span style={{ fontSize: 13 }}>{testResult.preview}...</span></>
                : <><strong style={{ color: '#dc2626' }}>Falhou:</strong> <span style={{ fontSize: 13 }}>{testResult.error}</span></>
              }
            </div>
          )}
        </div>

        {/* Connect form */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            {status?.source === 'tenant' ? '🔄 Atualizar API Key' : '🔗 Conectar com Anthropic'}
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
            Cole sua API Key da Anthropic para usar seus próprios créditos e limite de uso. A chave é armazenada de forma segura e nunca exposta.
          </p>

          {error   && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <form onSubmit={handleConnect}>
            <div className="form-group">
              <label>Anthropic API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                required
              />
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                Obtenha sua chave em{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer"
                  style={{ color: 'var(--primary)' }}>console.anthropic.com/settings/keys</a>
              </p>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <button type="submit" className="btn btn-primary" disabled={saving || !apiKey.trim()}>
                {saving ? 'Validando e salvando...' : status?.source === 'tenant' ? '🔄 Atualizar chave' : '🔗 Conectar'}
              </button>
              {status?.source === 'tenant' && (
                <button type="button" className="btn btn-danger" onClick={handleDisconnect} disabled={saving}>
                  Desconectar (usar global)
                </button>
              )}
            </div>
          </form>
        </div>

        {/* How it works */}
        <div className="card" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Como funciona</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['1', 'Crie uma conta ou faça login em console.anthropic.com', '#4f46e5'],
              ['2', 'Vá em Settings → API Keys e gere uma nova chave', '#4f46e5'],
              ['3', 'Cole a chave acima — ela é validada automaticamente', '#4f46e5'],
              ['4', 'Use o assistente de IA nos Modelos de Mensagem para criar e melhorar textos', '#4f46e5'],
            ].map(([step, text, color]) => (
              <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ background: color, color: '#fff', borderRadius: '50%', width: 22, height: 22, minWidth: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{step}</span>
                <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{text}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 16 }}>
            Se nenhuma chave for configurada, o sistema usa a chave global do administrador (se configurada).
          </p>
        </div>
      </div>
    </UserLayout>
  );
}
