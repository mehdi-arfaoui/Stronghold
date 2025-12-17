import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ApiConfig } from "../../types";
import { DEFAULTS, persistApiConfig, sanitizeBackendUrl } from "../../utils/api";

interface ConfigBannerProps {
  config: ApiConfig;
  onSave: (config: ApiConfig) => void;
}

export function ConfigBanner({ config, onSave }: ConfigBannerProps) {
  const [backendUrl, setBackendUrl] = useState(config.backendUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBackendUrl(config.backendUrl);
    setApiKey(config.apiKey);
  }, [config]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned: ApiConfig = {
      backendUrl: sanitizeBackendUrl(backendUrl) || DEFAULTS.backendUrl,
      apiKey: apiKey.trim(),
    };
    persistApiConfig(cleaned);
    onSave(cleaned);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const missingApiKey =
    !apiKey && !(import.meta.env.VITE_API_KEY as string | undefined);

  return (
    <section className="card config-banner" aria-label="Configuration API">
      <div className="card-header">
        <div>
          <p className="eyebrow">Configuration locale</p>
          <h3>Back-end &amp; API key</h3>
          <p className="muted">
            Les variables VITE_* sont prioritaires. Sinon, les valeurs sauvegardées en local sont utilisées.
          </p>
        </div>
        {saved && <span className="pill success">Enregistré</span>}
      </div>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label className="form-field">
          <span>Backend URL</span>
          <input
            type="text"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            placeholder="http://localhost:4000"
          />
        </label>
        <label className="form-field">
          <span>API key (x-api-key)</span>
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Clé tenant"
          />
        </label>
        <div className="form-actions">
          <button className="btn primary" type="submit">
            Mettre à jour
          </button>
          {missingApiKey && (
            <p className="helper warning">
              Aucune API key n'est configurée : renseignez-la pour éviter les erreurs 401.
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
