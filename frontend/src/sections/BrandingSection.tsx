import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "../components/ui/SectionCard";
import { apiFetch } from "../utils/api";
import type { BrandingSettings } from "../types";
import { useBranding } from "../context/BrandingContext";
import "./BrandingSection.css";

const EMPTY_FORM: BrandingSettings = {
  logoUrl: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
};

function normalizeInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function BrandingSection({ configVersion }: { configVersion: number }) {
  const { t } = useTranslation();
  const { branding, setBranding } = useBranding();
  const [formState, setFormState] = useState<BrandingSettings>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadBranding = async () => {
      try {
        const data = (await apiFetch("/branding")) as BrandingSettings;
        if (!isMounted) return;
        setBranding(data);
        setFormState(data ?? EMPTY_FORM);
        setLoading(false);
      } catch (err) {
        if (!isMounted) return;
        setError(t("branding.messages.error"));
        setLoading(false);
      }
    };

    void loadBranding();

    return () => {
      isMounted = false;
    };
  }, [configVersion, setBranding, t]);

  useEffect(() => {
    if (!branding) return;
    setFormState(branding);
  }, [branding]);

  const previewStyle = useMemo(
    () => ({
      "--accent-color": formState.accentColor ?? undefined,
      "--secondary-color": formState.secondaryColor ?? undefined,
      "--primary-color": formState.primaryColor ?? undefined,
    }),
    [formState.accentColor, formState.primaryColor, formState.secondaryColor]
  );

  const handleChange = (field: keyof BrandingSettings, value: string) => {
    setFormState((prev) => ({
      ...prev,
      [field]: normalizeInput(value),
    }));
    setNotice(null);
  };

  const handleReset = () => {
    setFormState(branding ?? EMPTY_FORM);
    setNotice(null);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: BrandingSettings = {
        logoUrl: formState.logoUrl,
        primaryColor: formState.primaryColor,
        secondaryColor: formState.secondaryColor,
        accentColor: formState.accentColor,
      };
      const response = (await apiFetch("/branding", {
        method: "PUT",
        body: JSON.stringify(payload),
      })) as BrandingSettings;
      setBranding(response);
      setFormState(response);
      setNotice(t("branding.messages.saved"));
    } catch (err) {
      setError(t("branding.messages.updateError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="skeleton">{t("branding.messages.loading")}</div>;
  }

  return (
    <section id="branding-panel" className="panel" aria-labelledby="branding-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("branding.title")}</p>
          <h2 id="branding-title">{t("branding.subtitle")}</h2>
          <p className="muted">{t("branding.description")}</p>
        </div>
      </div>

      <SectionCard eyebrow={t("branding.title")} title={t("branding.subtitle")}>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field" style={{ gridColumn: "1 / -1" }}>
            <span>{t("branding.logoUrlLabel")}</span>
            <input
              type="url"
              value={formState.logoUrl ?? ""}
              placeholder={t("branding.logoUrlPlaceholder")}
              onChange={(event) => handleChange("logoUrl", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("branding.primaryColorLabel")}</span>
            <input
              type="color"
              value={formState.primaryColor ?? "#0f172a"}
              onChange={(event) => handleChange("primaryColor", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("branding.secondaryColorLabel")}</span>
            <input
              type="color"
              value={formState.secondaryColor ?? "#22d3ee"}
              onChange={(event) => handleChange("secondaryColor", event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>{t("branding.accentColorLabel")}</span>
            <input
              type="color"
              value={formState.accentColor ?? "#38bdf8"}
              onChange={(event) => handleChange("accentColor", event.target.value)}
            />
          </label>
          <div className="form-actions" style={{ gridColumn: "1 / -1" }}>
            <div className="stack horizontal" style={{ gap: "12px" }}>
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? t("branding.actions.saving") : t("branding.actions.save")}
              </button>
              <button type="button" className="btn" onClick={handleReset}>
                {t("branding.actions.reset")}
              </button>
            </div>
            {error && <p className="helper error">{error}</p>}
            {notice && <p className="helper success">{notice}</p>}
          </div>
        </form>
      </SectionCard>

      <SectionCard eyebrow={t("branding.title")} title={t("branding.previewTitle")}>
        <div className="branding-preview" style={previewStyle as CSSProperties}>
          <div className="branding-preview-logo">
            {formState.logoUrl ? (
              <img src={formState.logoUrl} alt={t("appName")} />
            ) : (
              <span className="logo-text">{t("appName")}</span>
            )}
          </div>
          <div className="branding-preview-sample">
            <span className="pill">{t("quickAction")}</span>
            <span className="pill subtle">{t("navigation")}</span>
          </div>
        </div>
      </SectionCard>
    </section>
  );
}
