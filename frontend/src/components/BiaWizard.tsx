import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Service } from "../types";

interface BiaWizardProps {
  services: Service[];
  onComplete: (data: WizardData) => Promise<void>;
  onCancel: () => void;
}

export type WizardData = {
  // Step 1: Identification
  name: string;
  description: string;
  owners: string;
  domain: string;
  processCategory: string;
  serviceIds: string[];
  interdependencies: string;
  // Step 2: Impact evaluation
  financialImpact: ImpactEvaluation;
  regulatoryImpact: ImpactEvaluation;
  operationalImpact: ImpactEvaluation;
  reputationalImpact: ImpactEvaluation;
  // Step 3: Recovery objectives
  rtoHours: number;
  rpoMinutes: number;
  mtpdHours: number;
  suggestedRto: number | null;
  suggestedRpo: number | null;
  // Step 4: Validation
  comments: string;
  validated: boolean;
};

type ImpactEvaluation = {
  at24h: number;
  at72h: number;
  at1Week: number;
};

type WizardStep = 1 | 2 | 3 | 4;

const PROCESS_CATALOG = [
  { category: "finance", name: "Traitement des paiements", description: "Gestion des transactions financières" },
  { category: "finance", name: "Comptabilité générale", description: "Tenue des comptes et clôtures" },
  { category: "finance", name: "Gestion de trésorerie", description: "Suivi des flux de trésorerie" },
  { category: "rh", name: "Gestion de la paie", description: "Calcul et versement des salaires" },
  { category: "rh", name: "Recrutement", description: "Processus d'embauche" },
  { category: "rh", name: "Formation", description: "Gestion des formations et compétences" },
  { category: "production", name: "Chaîne de production", description: "Processus de fabrication" },
  { category: "production", name: "Contrôle qualité", description: "Vérification des produits" },
  { category: "production", name: "Gestion des stocks", description: "Approvisionnement et inventaire" },
  { category: "it", name: "Gestion des accès", description: "IAM et authentification" },
  { category: "it", name: "Sauvegarde des données", description: "Backup et archivage" },
  { category: "it", name: "Support utilisateurs", description: "Helpdesk et assistance" },
  { category: "commercial", name: "Gestion des commandes", description: "Traitement des commandes clients" },
  { category: "commercial", name: "CRM", description: "Gestion de la relation client" },
  { category: "logistique", name: "Expédition", description: "Envoi des marchandises" },
  { category: "logistique", name: "Réception", description: "Réception des livraisons" },
];

const DOMAINS = [
  { value: "", label: "-- Sélectionner un domaine --" },
  { value: "finance", label: "Finance" },
  { value: "rh", label: "Ressources Humaines" },
  { value: "production", label: "Production" },
  { value: "it", label: "IT / Infrastructure" },
  { value: "commercial", label: "Commercial / Ventes" },
  { value: "logistique", label: "Logistique" },
  { value: "juridique", label: "Juridique" },
  { value: "autre", label: "Autre" },
];

const IMPACT_LABELS: Record<number, string> = {
  1: "Négligeable",
  2: "Faible",
  3: "Modéré",
  4: "Élevé",
  5: "Critique",
};

const RTO_SUGGESTIONS: Record<string, { rto: number; rpo: number }> = {
  finance: { rto: 4, rpo: 60 },
  rh: { rto: 24, rpo: 240 },
  production: { rto: 8, rpo: 120 },
  it: { rto: 2, rpo: 30 },
  commercial: { rto: 8, rpo: 120 },
  logistique: { rto: 12, rpo: 240 },
  juridique: { rto: 24, rpo: 480 },
  autre: { rto: 24, rpo: 240 },
};

const defaultImpact: ImpactEvaluation = { at24h: 3, at72h: 3, at1Week: 3 };

const defaultWizardData: WizardData = {
  name: "",
  description: "",
  owners: "",
  domain: "",
  processCategory: "",
  serviceIds: [],
  interdependencies: "",
  financialImpact: { ...defaultImpact },
  regulatoryImpact: { ...defaultImpact },
  operationalImpact: { ...defaultImpact },
  reputationalImpact: { ...defaultImpact },
  rtoHours: 4,
  rpoMinutes: 60,
  mtpdHours: 24,
  suggestedRto: null,
  suggestedRpo: null,
  comments: "",
  validated: false,
};

// Auto-save key for localStorage
const AUTOSAVE_KEY = "bia-wizard-draft";

function ImpactSlider({
  label,
  value,
  onChange,
  helpText,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  helpText?: string;
}) {
  return (
    <div className="impact-slider">
      <div className="impact-slider-header">
        <span>{label}</span>
        <span className={`impact-value ${value >= 4 ? "critical" : value >= 3 ? "warning" : "success"}`}>
          {value} - {IMPACT_LABELS[value]}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider"
      />
      {helpText && <p className="helper-text muted small">{helpText}</p>}
    </div>
  );
}

function ImpactCard({
  title,
  icon,
  evaluation,
  onChange,
  helpTexts,
}: {
  title: string;
  icon: string;
  evaluation: ImpactEvaluation;
  onChange: (eval: ImpactEvaluation) => void;
  helpTexts?: { at24h?: string; at72h?: string; at1Week?: string };
}) {
  const avgImpact = (evaluation.at24h + evaluation.at72h + evaluation.at1Week) / 3;

  return (
    <div className="card impact-card">
      <div className="card-header">
        <div>
          <span className="impact-icon">{icon}</span>
          <h4>{title}</h4>
        </div>
        <span className={`pill ${avgImpact >= 4 ? "error" : avgImpact >= 3 ? "warning" : "success"}`}>
          Moy: {avgImpact.toFixed(1)}
        </span>
      </div>
      <div className="impact-sliders">
        <ImpactSlider
          label="Impact à 24h"
          value={evaluation.at24h}
          onChange={(v) => onChange({ ...evaluation, at24h: v })}
          helpText={helpTexts?.at24h}
        />
        <ImpactSlider
          label="Impact à 72h"
          value={evaluation.at72h}
          onChange={(v) => onChange({ ...evaluation, at72h: v })}
          helpText={helpTexts?.at72h}
        />
        <ImpactSlider
          label="Impact à 1 semaine"
          value={evaluation.at1Week}
          onChange={(v) => onChange({ ...evaluation, at1Week: v })}
          helpText={helpTexts?.at1Week}
        />
      </div>
    </div>
  );
}

export function BiaWizard({ services, onComplete, onCancel }: BiaWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [data, setData] = useState<WizardData>(() => {
    // Try to restore from localStorage
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      try {
        return { ...defaultWizardData, ...JSON.parse(saved) };
      } catch {
        return { ...defaultWizardData };
      }
    }
    return { ...defaultWizardData };
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Auto-save on data change
  useEffect(() => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  }, [data]);

  // Suggest RTO/RPO based on domain
  useEffect(() => {
    if (data.domain && RTO_SUGGESTIONS[data.domain]) {
      const suggestion = RTO_SUGGESTIONS[data.domain];
      setData((prev) => ({
        ...prev,
        suggestedRto: suggestion.rto,
        suggestedRpo: suggestion.rpo,
      }));
    }
  }, [data.domain]);

  // Calculate criticality score in real-time
  const criticalityScore = useMemo(() => {
    const avgFinancial = (data.financialImpact.at24h + data.financialImpact.at72h + data.financialImpact.at1Week) / 3;
    const avgRegulatory = (data.regulatoryImpact.at24h + data.regulatoryImpact.at72h + data.regulatoryImpact.at1Week) / 3;
    const avgOperational = (data.operationalImpact.at24h + data.operationalImpact.at72h + data.operationalImpact.at1Week) / 3;
    const avgReputational = (data.reputationalImpact.at24h + data.reputationalImpact.at72h + data.reputationalImpact.at1Week) / 3;

    // Weighted average: financial 35%, regulatory 25%, operational 25%, reputational 15%
    return avgFinancial * 0.35 + avgRegulatory * 0.25 + avgOperational * 0.25 + avgReputational * 0.15;
  }, [data.financialImpact, data.regulatoryImpact, data.operationalImpact, data.reputationalImpact]);

  // Validation warnings
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (data.rtoHours > data.mtpdHours) {
      w.push("Le RTO dépasse le MTPD - le processus ne sera pas restauré à temps.");
    }
    if (data.rtoHours < 2 && data.rpoMinutes > 120) {
      w.push("RTO très court avec RPO long - incohérence possible.");
    }
    if (criticalityScore >= 4 && data.rtoHours > 8) {
      w.push("Processus critique avec RTO > 8h - envisager de réduire le RTO.");
    }
    if (data.serviceIds.length === 0 && step >= 3) {
      w.push("Aucun service associé - l'analyse d'impact sera incomplète.");
    }
    return w;
  }, [data, criticalityScore, step]);

  const validateStep = useCallback((stepNum: WizardStep): boolean => {
    const errs: string[] = [];

    if (stepNum === 1) {
      if (!data.name.trim()) errs.push("Le nom du processus est requis.");
      if (!data.domain) errs.push("Veuillez sélectionner un domaine métier.");
    }

    if (stepNum === 3) {
      if (data.rtoHours < 0) errs.push("Le RTO ne peut pas être négatif.");
      if (data.rpoMinutes < 0) errs.push("Le RPO ne peut pas être négatif.");
      if (data.mtpdHours < 0) errs.push("Le MTPD ne peut pas être négatif.");
    }

    setErrors(errs);
    return errs.length === 0;
  }, [data]);

  const goToStep = (targetStep: WizardStep) => {
    if (targetStep > step) {
      if (!validateStep(step)) return;
    }
    setStep(targetStep);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validateStep(4)) return;

    setSubmitting(true);
    try {
      await onComplete({ ...data, validated: true });
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (err: any) {
      setErrors([err.message || "Erreur lors de la création"]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCatalogSelect = (catalogItem: typeof PROCESS_CATALOG[0]) => {
    setData((prev) => ({
      ...prev,
      name: catalogItem.name,
      description: catalogItem.description,
      domain: catalogItem.category,
      processCategory: catalogItem.category,
    }));
  };

  const filteredCatalog = data.domain
    ? PROCESS_CATALOG.filter((item) => item.category === data.domain)
    : PROCESS_CATALOG;

  const applySuggestion = () => {
    if (data.suggestedRto !== null && data.suggestedRpo !== null) {
      setData((prev) => ({
        ...prev,
        rtoHours: data.suggestedRto!,
        rpoMinutes: data.suggestedRpo!,
      }));
    }
  };

  return (
    <div className="bia-wizard">
      {/* Progress Bar */}
      <div className="wizard-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${((step - 1) / 3) * 100}%` }} />
        </div>
        <div className="progress-steps">
          <div
            className={`progress-step ${step >= 1 ? "active" : ""} ${step > 1 ? "completed" : ""}`}
            onClick={() => goToStep(1)}
          >
            <span className="step-number">1</span>
            <span className="step-label">Identification</span>
          </div>
          <div
            className={`progress-step ${step >= 2 ? "active" : ""} ${step > 2 ? "completed" : ""}`}
            onClick={() => step >= 2 && goToStep(2)}
          >
            <span className="step-number">2</span>
            <span className="step-label">Impacts</span>
          </div>
          <div
            className={`progress-step ${step >= 3 ? "active" : ""} ${step > 3 ? "completed" : ""}`}
            onClick={() => step >= 3 && goToStep(3)}
          >
            <span className="step-number">3</span>
            <span className="step-label">Objectifs</span>
          </div>
          <div
            className={`progress-step ${step >= 4 ? "active" : ""}`}
            onClick={() => step >= 4 && goToStep(4)}
          >
            <span className="step-number">4</span>
            <span className="step-label">Validation</span>
          </div>
        </div>
      </div>

      {/* Auto-save indicator */}
      <div className="autosave-indicator">
        <span className="autosave-dot" />
        Enregistrement automatique activé
      </div>

      <form onSubmit={handleSubmit}>
        {/* Step 1: Identification */}
        {step === 1 && (
          <div className="wizard-step">
            <div className="step-header">
              <h2>1. Identification du processus</h2>
              <p className="muted">
                Sélectionnez un processus depuis le catalogue ou créez-en un nouveau.
              </p>
            </div>

            {/* Process Catalog */}
            <div className="card" style={{ marginBottom: "1.5rem" }}>
              <div className="card-header">
                <div>
                  <p className="eyebrow">Catalogue de processus</p>
                  <h4>Processus types par domaine</h4>
                </div>
              </div>
              <div className="catalog-filter">
                <label>
                  Filtrer par domaine:
                  <select
                    value={data.domain}
                    onChange={(e) => setData((prev) => ({ ...prev, domain: e.target.value }))}
                    style={{ marginLeft: "0.5rem" }}
                  >
                    {DOMAINS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="catalog-grid">
                {filteredCatalog.map((item, idx) => (
                  <div
                    key={idx}
                    className={`catalog-item ${data.name === item.name ? "selected" : ""}`}
                    onClick={() => handleCatalogSelect(item)}
                  >
                    <strong>{item.name}</strong>
                    <p className="muted small">{item.description}</p>
                    <span className="pill subtle small">{item.category}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Manual Entry */}
            <div className="form-grid">
              <label className="form-field">
                <span>
                  Nom du processus *
                  <span className="helper" title="Nom unique identifiant le processus">?</span>
                </span>
                <input
                  type="text"
                  value={data.name}
                  onChange={(e) => setData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Traitement des paiements"
                  required
                />
              </label>

              <label className="form-field">
                <span>
                  Domaine métier *
                  <span className="helper" title="Domaine fonctionnel du processus">?</span>
                </span>
                <select
                  value={data.domain}
                  onChange={(e) => setData((prev) => ({ ...prev, domain: e.target.value }))}
                  required
                >
                  {DOMAINS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>Propriétaires</span>
                <input
                  type="text"
                  value={data.owners}
                  onChange={(e) => setData((prev) => ({ ...prev, owners: e.target.value }))}
                  placeholder="Direction financière, DSI"
                />
              </label>

              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span>Description</span>
                <textarea
                  value={data.description}
                  onChange={(e) => setData((prev) => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  placeholder="Décrivez le processus, son rôle et son importance..."
                />
              </label>

              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span>
                  Services / applications concernés
                  <span className="helper" title="Sélectionnez les services dont dépend ce processus">?</span>
                </span>
                <select
                  multiple
                  value={data.serviceIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                    setData((prev) => ({ ...prev, serviceIds: selected }));
                  }}
                  style={{ minHeight: "100px" }}
                >
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} ({service.criticality})
                    </option>
                  ))}
                </select>
                <p className="helper">Maintenez Ctrl/Cmd pour sélectionner plusieurs services.</p>
              </label>

              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span>Interdépendances (texte libre)</span>
                <textarea
                  value={data.interdependencies}
                  onChange={(e) => setData((prev) => ({ ...prev, interdependencies: e.target.value }))}
                  rows={2}
                  placeholder="Flux entre agences, interfaces partenaires, fournisseurs clés..."
                />
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Impact Evaluation */}
        {step === 2 && (
          <div className="wizard-step">
            <div className="step-header">
              <h2>2. Évaluation des impacts</h2>
              <p className="muted">
                Évaluez l'impact d'une interruption sur différentes échelles de temps.
              </p>
            </div>

            {/* Real-time criticality score */}
            <div className="criticality-preview">
              <div className="criticality-score">
                <span className="label">Score de criticité estimé</span>
                <span className={`score ${criticalityScore >= 4 ? "critical" : criticalityScore >= 3 ? "warning" : "success"}`}>
                  {criticalityScore.toFixed(2)}
                </span>
              </div>
              <div className="criticality-bar">
                <div
                  className="criticality-fill"
                  style={{
                    width: `${(criticalityScore / 5) * 100}%`,
                    backgroundColor: criticalityScore >= 4 ? "var(--color-error)" : criticalityScore >= 3 ? "var(--color-warning)" : "var(--color-success)",
                  }}
                />
              </div>
            </div>

            <div className="impact-grid">
              <ImpactCard
                title="Impact Financier"
                icon="$"
                evaluation={data.financialImpact}
                onChange={(e) => setData((prev) => ({ ...prev, financialImpact: e }))}
                helpTexts={{
                  at24h: "Pertes directes dans les 24 premières heures",
                  at72h: "Coûts cumulés après 3 jours d'interruption",
                  at1Week: "Impact financier total après une semaine",
                }}
              />

              <ImpactCard
                title="Impact Réglementaire"
                icon="§"
                evaluation={data.regulatoryImpact}
                onChange={(e) => setData((prev) => ({ ...prev, regulatoryImpact: e }))}
                helpTexts={{
                  at24h: "Risque de non-conformité immédiat",
                  at72h: "Sanctions potentielles après 3 jours",
                  at1Week: "Conséquences réglementaires majeures",
                }}
              />

              <ImpactCard
                title="Impact Opérationnel"
                icon="O"
                evaluation={data.operationalImpact}
                onChange={(e) => setData((prev) => ({ ...prev, operationalImpact: e }))}
                helpTexts={{
                  at24h: "Perturbation des opérations quotidiennes",
                  at72h: "Effets sur la chaîne de production",
                  at1Week: "Désorganisation structurelle",
                }}
              />

              <ImpactCard
                title="Impact Réputationnel"
                icon="R"
                evaluation={data.reputationalImpact}
                onChange={(e) => setData((prev) => ({ ...prev, reputationalImpact: e }))}
                helpTexts={{
                  at24h: "Premiers impacts sur l'image",
                  at72h: "Perte de confiance clients/partenaires",
                  at1Week: "Atteinte durable à la réputation",
                }}
              />
            </div>
          </div>
        )}

        {/* Step 3: Recovery Objectives */}
        {step === 3 && (
          <div className="wizard-step">
            <div className="step-header">
              <h2>3. Objectifs de reprise</h2>
              <p className="muted">
                Définissez les objectifs de temps de reprise pour ce processus.
              </p>
            </div>

            {/* Suggested values */}
            {data.suggestedRto !== null && data.suggestedRpo !== null && (
              <div className="suggestion-card">
                <div className="suggestion-content">
                  <strong>Valeurs suggérées pour le domaine "{DOMAINS.find(d => d.value === data.domain)?.label}"</strong>
                  <p className="muted small">
                    RTO: {data.suggestedRto}h | RPO: {data.suggestedRpo} min
                  </p>
                </div>
                <button type="button" className="button" onClick={applySuggestion}>
                  Appliquer
                </button>
              </div>
            )}

            <div className="form-grid recovery-form">
              <label className="form-field">
                <span>
                  RTO (Recovery Time Objective)
                  <span className="helper" title="Temps maximum pour restaurer le processus après un incident">?</span>
                </span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min={0}
                    value={data.rtoHours}
                    onChange={(e) => setData((prev) => ({ ...prev, rtoHours: Number(e.target.value) }))}
                  />
                  <span className="unit">heures</span>
                </div>
                <p className="helper-text muted small">
                  Temps maximum acceptable avant restauration du service.
                </p>
              </label>

              <label className="form-field">
                <span>
                  RPO (Recovery Point Objective)
                  <span className="helper" title="Perte de données maximum acceptable">?</span>
                </span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min={0}
                    value={data.rpoMinutes}
                    onChange={(e) => setData((prev) => ({ ...prev, rpoMinutes: Number(e.target.value) }))}
                  />
                  <span className="unit">minutes</span>
                </div>
                <p className="helper-text muted small">
                  Quantité de données pouvant être perdues (dernier point de sauvegarde).
                </p>
              </label>

              <label className="form-field">
                <span>
                  MTPD (Maximum Tolerable Period of Disruption)
                  <span className="helper" title="Durée maximum avant dommages irréversibles">?</span>
                </span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min={0}
                    value={data.mtpdHours}
                    onChange={(e) => setData((prev) => ({ ...prev, mtpdHours: Number(e.target.value) }))}
                  />
                  <span className="unit">heures</span>
                </div>
                <p className="helper-text muted small">
                  Au-delà de cette durée, les dommages deviennent irréversibles.
                </p>
              </label>
            </div>

            {/* Visual comparison */}
            <div className="recovery-visual">
              <h4>Comparaison visuelle</h4>
              <div className="recovery-timeline">
                <div className="timeline-bar">
                  <div
                    className="timeline-rpo"
                    style={{ width: `${Math.min((data.rpoMinutes / 60 / Math.max(data.mtpdHours, 1)) * 100, 100)}%` }}
                  >
                    <span>RPO: {data.rpoMinutes} min</span>
                  </div>
                  <div
                    className="timeline-rto"
                    style={{ width: `${Math.min((data.rtoHours / Math.max(data.mtpdHours, 1)) * 100, 100)}%` }}
                  >
                    <span>RTO: {data.rtoHours}h</span>
                  </div>
                  <div className="timeline-mtpd">
                    <span>MTPD: {data.mtpdHours}h</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Validation */}
        {step === 4 && (
          <div className="wizard-step">
            <div className="step-header">
              <h2>4. Synthèse et validation</h2>
              <p className="muted">
                Vérifiez les informations saisies avant de valider.
              </p>
            </div>

            {/* Summary */}
            <div className="validation-summary">
              <div className="summary-section">
                <h4>Identification</h4>
                <dl>
                  <dt>Processus</dt>
                  <dd>{data.name || "-"}</dd>
                  <dt>Domaine</dt>
                  <dd>{DOMAINS.find(d => d.value === data.domain)?.label || "-"}</dd>
                  <dt>Propriétaires</dt>
                  <dd>{data.owners || "-"}</dd>
                  <dt>Services associés</dt>
                  <dd>{data.serviceIds.length > 0 ? data.serviceIds.length + " service(s)" : "Aucun"}</dd>
                </dl>
              </div>

              <div className="summary-section">
                <h4>Impacts (moyenne)</h4>
                <dl>
                  <dt>Financier</dt>
                  <dd>
                    <span className={`pill ${(data.financialImpact.at24h + data.financialImpact.at72h + data.financialImpact.at1Week) / 3 >= 4 ? "error" : "warning"}`}>
                      {((data.financialImpact.at24h + data.financialImpact.at72h + data.financialImpact.at1Week) / 3).toFixed(1)}
                    </span>
                  </dd>
                  <dt>Réglementaire</dt>
                  <dd>
                    <span className={`pill ${(data.regulatoryImpact.at24h + data.regulatoryImpact.at72h + data.regulatoryImpact.at1Week) / 3 >= 4 ? "error" : "warning"}`}>
                      {((data.regulatoryImpact.at24h + data.regulatoryImpact.at72h + data.regulatoryImpact.at1Week) / 3).toFixed(1)}
                    </span>
                  </dd>
                  <dt>Opérationnel</dt>
                  <dd>
                    <span className={`pill ${(data.operationalImpact.at24h + data.operationalImpact.at72h + data.operationalImpact.at1Week) / 3 >= 4 ? "error" : "warning"}`}>
                      {((data.operationalImpact.at24h + data.operationalImpact.at72h + data.operationalImpact.at1Week) / 3).toFixed(1)}
                    </span>
                  </dd>
                  <dt>Réputationnel</dt>
                  <dd>
                    <span className={`pill ${(data.reputationalImpact.at24h + data.reputationalImpact.at72h + data.reputationalImpact.at1Week) / 3 >= 4 ? "error" : "warning"}`}>
                      {((data.reputationalImpact.at24h + data.reputationalImpact.at72h + data.reputationalImpact.at1Week) / 3).toFixed(1)}
                    </span>
                  </dd>
                </dl>
              </div>

              <div className="summary-section">
                <h4>Objectifs de reprise</h4>
                <dl>
                  <dt>RTO</dt>
                  <dd>{data.rtoHours} heures</dd>
                  <dt>RPO</dt>
                  <dd>{data.rpoMinutes} minutes</dd>
                  <dt>MTPD</dt>
                  <dd>{data.mtpdHours} heures</dd>
                </dl>
              </div>

              <div className="summary-section criticality-section">
                <h4>Score de criticité</h4>
                <div className={`criticality-badge ${criticalityScore >= 4 ? "critical" : criticalityScore >= 3 ? "high" : "medium"}`}>
                  {criticalityScore.toFixed(2)}
                </div>
                <p className="muted small">
                  {criticalityScore >= 4 ? "Processus critique - priorité maximale" :
                   criticalityScore >= 3 ? "Processus important - attention requise" :
                   "Processus standard"}
                </p>
              </div>
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="validation-warnings">
                <h4>Avertissements</h4>
                <ul>
                  {warnings.map((w, idx) => (
                    <li key={idx} className="warning-item">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Comments */}
            <label className="form-field" style={{ marginTop: "1rem" }}>
              <span>Commentaires additionnels</span>
              <textarea
                value={data.comments}
                onChange={(e) => setData((prev) => ({ ...prev, comments: e.target.value }))}
                rows={3}
                placeholder="Notes, observations, justifications..."
              />
            </label>
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="alert error" style={{ marginTop: "1rem" }}>
            <ul>
              {errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Navigation */}
        <div className="wizard-nav">
          <div className="nav-left">
            <button type="button" className="button" onClick={onCancel}>
              Annuler
            </button>
          </div>
          <div className="nav-right">
            {step > 1 && (
              <button type="button" className="button" onClick={() => goToStep((step - 1) as WizardStep)}>
                Précédent
              </button>
            )}
            {step < 4 && (
              <button type="button" className="button primary" onClick={() => goToStep((step + 1) as WizardStep)}>
                Suivant
              </button>
            )}
            {step === 4 && (
              <button type="submit" className="button primary" disabled={submitting}>
                {submitting ? "Validation..." : "Valider et créer le processus"}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

// CSS styles for the wizard
export const biaWizardStyles = `
.bia-wizard {
  max-width: 900px;
  margin: 0 auto;
}

.wizard-progress {
  margin-bottom: 2rem;
}

.progress-bar {
  height: 4px;
  background: var(--color-border);
  border-radius: 2px;
  margin-bottom: 1rem;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-steps {
  display: flex;
  justify-content: space-between;
}

.progress-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.progress-step.active {
  opacity: 1;
}

.progress-step.completed {
  opacity: 0.8;
}

.step-number {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-surface-secondary);
  border: 2px solid var(--color-border);
  font-weight: 600;
}

.progress-step.active .step-number {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.progress-step.completed .step-number {
  background: var(--color-success);
  border-color: var(--color-success);
  color: white;
}

.step-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.autosave-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-bottom: 1rem;
}

.autosave-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-success);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.wizard-step {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.step-header {
  margin-bottom: 1.5rem;
}

.step-header h2 {
  margin-bottom: 0.25rem;
}

.catalog-filter {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
  padding: 1rem;
  max-height: 300px;
  overflow-y: auto;
}

.catalog-item {
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.catalog-item:hover {
  border-color: var(--color-primary);
  background: var(--color-surface-secondary);
}

.catalog-item.selected {
  border-color: var(--color-primary);
  background: rgba(var(--color-primary-rgb), 0.1);
}

.impact-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

@media (max-width: 768px) {
  .impact-grid {
    grid-template-columns: 1fr;
  }
}

.impact-card .card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.impact-card .card-header h4 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.impact-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-surface-secondary);
  font-weight: 600;
}

.impact-sliders {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.impact-slider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.impact-value {
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.impact-value.critical {
  background: rgba(255, 107, 107, 0.2);
  color: var(--color-error);
}

.impact-value.warning {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-warning);
}

.impact-value.success {
  background: rgba(40, 167, 69, 0.2);
  color: var(--color-success);
}

.slider {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  appearance: none;
  background: var(--color-border);
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.criticality-preview {
  background: var(--color-surface-secondary);
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.criticality-score {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.criticality-score .score {
  font-size: 1.5rem;
  font-weight: 700;
}

.criticality-score .score.critical {
  color: var(--color-error);
}

.criticality-score .score.warning {
  color: var(--color-warning);
}

.criticality-score .score.success {
  color: var(--color-success);
}

.criticality-bar {
  height: 8px;
  background: var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}

.criticality-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.suggestion-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: rgba(var(--color-info-rgb, 23, 162, 184), 0.1);
  border: 1px solid var(--color-info);
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.recovery-form {
  margin-bottom: 1.5rem;
}

.recovery-visual {
  background: var(--color-surface-secondary);
  padding: 1rem;
  border-radius: 8px;
}

.recovery-timeline {
  margin-top: 1rem;
}

.timeline-bar {
  position: relative;
  height: 40px;
  background: var(--color-border);
  border-radius: 4px;
  overflow: hidden;
}

.timeline-rpo,
.timeline-rto {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding-left: 0.5rem;
  font-size: 0.75rem;
  color: white;
}

.timeline-rpo {
  background: var(--color-info);
  z-index: 3;
}

.timeline-rto {
  background: var(--color-warning);
  z-index: 2;
}

.timeline-mtpd {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.validation-summary {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

@media (max-width: 768px) {
  .validation-summary {
    grid-template-columns: 1fr;
  }
}

.summary-section {
  background: var(--color-surface-secondary);
  padding: 1rem;
  border-radius: 8px;
}

.summary-section h4 {
  margin-bottom: 0.75rem;
  color: var(--color-text-secondary);
}

.summary-section dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
}

.summary-section dt {
  color: var(--color-text-muted);
}

.summary-section dd {
  font-weight: 500;
}

.criticality-section {
  grid-column: 1 / -1;
  text-align: center;
}

.criticality-badge {
  font-size: 3rem;
  font-weight: 700;
  padding: 1rem 2rem;
  border-radius: 12px;
  display: inline-block;
  margin: 0.5rem 0;
}

.criticality-badge.critical {
  background: rgba(255, 107, 107, 0.2);
  color: var(--color-error);
}

.criticality-badge.high {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-warning);
}

.criticality-badge.medium {
  background: rgba(40, 167, 69, 0.2);
  color: var(--color-success);
}

.validation-warnings {
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid var(--color-warning);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.validation-warnings h4 {
  color: var(--color-warning);
  margin-bottom: 0.5rem;
}

.warning-item {
  color: var(--color-text-secondary);
  margin-left: 1rem;
}

.wizard-nav {
  display: flex;
  justify-content: space-between;
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.nav-right {
  display: flex;
  gap: 0.5rem;
}

.helper-text {
  margin-top: 0.25rem;
}
`;
