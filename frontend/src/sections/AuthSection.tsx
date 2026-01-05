import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro } from "../components/PageIntro";
import { apiFetch } from "../utils/api";

interface AuthSectionProps {
  configVersion: number;
}

type ApiKeyRecord = {
  id: string;
  label: string | null;
  role: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  rotatedFromId: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreatedKey = {
  id: string;
  apiKey: string;
  role: string;
  expiresAt: string | null;
  label?: string | null;
  mode: "created" | "rotated";
  rotatedFromId?: string | null;
};

const ROLE_OPTIONS = ["ADMIN", "OPERATOR", "READER"] as const;

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function buildStatus(key: ApiKeyRecord) {
  if (key.revokedAt) {
    return { label: "Révoquée", detail: formatDate(key.revokedAt) };
  }
  if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) {
    return { label: "Expirée", detail: formatDate(key.expiresAt) };
  }
  return { label: "Active", detail: key.expiresAt ? formatDate(key.expiresAt) : "-" };
}

export function AuthSection({ configVersion }: AuthSectionProps) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);

  const [label, setLabel] = useState("");
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>("OPERATOR");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [rotateLabel, setRotateLabel] = useState("");
  const [rotateRole, setRotateRole] = useState<(typeof ROLE_OPTIONS)[number]>("OPERATOR");
  const [rotateExpiresInDays, setRotateExpiresInDays] = useState("");
  const [rotating, setRotating] = useState(false);

  const loadKeys = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch("/auth/api-keys");
      setKeys(data);
    } catch (err: any) {
      setError(err.message || "Erreur lors du chargement des clés");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, [configVersion]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setActionError(null);

    const expiresValue = expiresInDays ? Number(expiresInDays) : undefined;

    try {
      const response = await apiFetch("/auth/api-keys", {
        method: "POST",
        body: JSON.stringify({
          label: label || undefined,
          role,
          expiresInDays: expiresValue,
        }),
      });
      setCreatedKey({
        id: response.id,
        apiKey: response.apiKey,
        role: response.role,
        expiresAt: response.expiresAt ?? null,
        label: response.label ?? null,
        mode: "created",
      });
      setLabel("");
      setExpiresInDays("");
      await loadKeys();
    } catch (err: any) {
      setActionError(err.message || "Création impossible");
    } finally {
      setCreating(false);
    }
  };

  const handleRotate = async (event: FormEvent) => {
    event.preventDefault();
    setRotating(true);
    setActionError(null);

    const expiresValue = rotateExpiresInDays ? Number(rotateExpiresInDays) : undefined;

    try {
      const response = await apiFetch("/auth/api-keys/rotate", {
        method: "POST",
        body: JSON.stringify({
          label: rotateLabel || undefined,
          role: rotateRole,
          expiresInDays: expiresValue,
        }),
      });
      setCreatedKey({
        id: response.id,
        apiKey: response.apiKey,
        role: response.role,
        expiresAt: response.expiresAt ?? null,
        mode: "rotated",
        rotatedFromId: response.rotatedFromId ?? null,
      });
      setRotateLabel("");
      setRotateExpiresInDays("");
      await loadKeys();
    } catch (err: any) {
      setActionError(err.message || "Rotation impossible");
    } finally {
      setRotating(false);
    }
  };

  const keyRows = useMemo(() => {
    return keys.map((key) => ({
      ...key,
      status: buildStatus(key),
    }));
  }, [keys]);

  if (loading) return <div className="skeleton">Chargement des clés API...</div>;

  if (error) {
    return <div className="alert error">Erreur lors du chargement : {error}</div>;
  }

  const progressSteps = [
    keys.length > 0,
    keys.some((key) => !key.revokedAt),
    keys.some((key) => Boolean(key.expiresAt)),
  ];
  const progressValue = Math.round(
    (progressSteps.filter(Boolean).length / progressSteps.length) * 100
  );

  return (
    <section id="auth-panel" className="panel" aria-labelledby="auth-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Sécurité</p>
          <h2 id="auth-title">Gestion des clés API</h2>
          <p className="muted">
            Réservé aux administrateurs : création, rotation et suivi des clés d'accès API.
          </p>
        </div>
        <div className="badge subtle">ADMIN only</div>
      </div>

      <PageIntro
        title="Gérer les accès API"
        objective="Créer, faire tourner et suivre les clés API pour sécuriser l'accès aux modules PRA."
        steps={[
          "Créer une clé avec le bon rôle",
          "Planifier la rotation et l'expiration",
          "Suivre l'usage et la révocation",
        ]}
        tips={[
          "Limitez les clés ADMIN aux comptes de confiance.",
          "Programmez une rotation régulière des clés sensibles.",
          "Vérifiez le dernier usage avant révocation.",
        ]}
        links={[
          { label: "Créer une clé", href: "#auth-create", description: "Formulaire" },
          { label: "Rotater une clé", href: "#auth-rotate", description: "Rotation" },
          { label: "Consulter l'inventaire", href: "#auth-list", description: "Liste" },
        ]}
        expectedData={[
          "Libellé + rôle (ADMIN/OPERATOR/READER)",
          "Durée d'expiration souhaitée",
          "Clé à tourner ou à révoquer",
        ]}
        progress={{
          value: progressValue,
          label: `${progressSteps.filter(Boolean).length}/${progressSteps.length} jalons`,
        }}
      />

      {createdKey && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div className="card-header">
            <div>
              <p className="eyebrow">Clé générée</p>
              <h3>Copiez la clé maintenant (affichage unique)</h3>
            </div>
            <button type="button" className="button" onClick={() => setCreatedKey(null)}>
              Effacer l'affichage
            </button>
          </div>
          <div className="card-body">
            <p className="muted">
              Cette clé ne sera plus affichée après fermeture. Stockez-la dans un coffre sécurisé.
            </p>
            <div className="code-block" style={{ marginTop: "0.75rem" }}>
              <code>{createdKey.apiKey}</code>
            </div>
            <div className="tag-list" style={{ marginTop: "0.75rem" }}>
              <span className="tag">{createdKey.mode === "rotated" ? "Rotation" : "Création"}</span>
              <span className="tag">Rôle : {createdKey.role}</span>
              <span className="tag">Expiration : {formatDate(createdKey.expiresAt)}</span>
              {createdKey.rotatedFromId && (
                <span className="tag">Remplace : {createdKey.rotatedFromId}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="panel-grid">
        <form id="auth-create" className="card form-grid" onSubmit={handleCreate}>
          <div className="card-header" style={{ gridColumn: "1 / -1" }}>
            <div>
              <p className="eyebrow">Nouvelle clé</p>
              <h3>Créer une clé API</h3>
            </div>
          </div>

          <label className="form-field">
            <span>Libellé (optionnel)</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>

          <label className="form-field">
            <span>Rôle</span>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {ROLE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Expiration (jours)</span>
            <input
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder="30"
            />
            <p className="helper">Laissez vide pour une clé sans expiration.</p>
          </label>

          <div className="form-field" style={{ gridColumn: "1 / -1" }}>
            <button className="button primary" type="submit" disabled={creating}>
              {creating ? "Création en cours..." : "Créer la clé"}
            </button>
          </div>
        </form>

        <form id="auth-rotate" className="card form-grid" onSubmit={handleRotate}>
          <div className="card-header" style={{ gridColumn: "1 / -1" }}>
            <div>
              <p className="eyebrow">Rotation</p>
              <h3>Faire tourner la clé courante</h3>
            </div>
          </div>

          <label className="form-field">
            <span>Libellé (optionnel)</span>
            <input type="text" value={rotateLabel} onChange={(e) => setRotateLabel(e.target.value)} />
          </label>

          <label className="form-field">
            <span>Rôle</span>
            <select value={rotateRole} onChange={(e) => setRotateRole(e.target.value as typeof role)}>
              {ROLE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Expiration (jours)</span>
            <input
              type="number"
              min={1}
              value={rotateExpiresInDays}
              onChange={(e) => setRotateExpiresInDays(e.target.value)}
              placeholder="30"
            />
            <p className="helper">La clé actuelle sera révoquée automatiquement.</p>
          </label>

          <div className="form-field" style={{ gridColumn: "1 / -1" }}>
            <button className="button" type="submit" disabled={rotating}>
              {rotating ? "Rotation en cours..." : "Rotation immédiate"}
            </button>
          </div>
        </form>
      </div>

      {actionError && <div className="alert error">{actionError}</div>}

      <div id="auth-list" className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <div>
            <p className="eyebrow">Suivi</p>
            <h3>Clés API existantes</h3>
          </div>
          <div className="badge subtle">{keys.length} clés</div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Libellé</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Expiration</th>
                <th>Dernière utilisation</th>
                <th>Rotation</th>
              </tr>
            </thead>
            <tbody>
              {keyRows.map((key) => (
                <tr key={key.id}>
                  <td>{key.label || key.id}</td>
                  <td>{key.role}</td>
                  <td>
                    <div>
                      <span className="badge subtle">{key.status.label}</span>
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {key.status.detail}
                      </div>
                    </div>
                  </td>
                  <td>{formatDate(key.expiresAt)}</td>
                  <td>{formatDate(key.lastUsedAt)}</td>
                  <td>{key.rotatedFromId ? `↺ depuis ${key.rotatedFromId}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
