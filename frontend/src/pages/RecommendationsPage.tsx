import { useTranslation } from 'react-i18next';
import { RecommendationsEngine } from '@/components/recommendations/RecommendationsEngine';
import { normalizeLanguage } from '@/i18n/locales';
import { KnowledgeTerm } from '@/components/knowledge-base/KnowledgeTerm';

export function RecommendationsPage() {
  const { i18n } = useTranslation();
  const description = {
    fr: 'Priorisez vos actions en fonction des objectifs ',
    en: 'Prioritize your actions based on your ',
    es: 'Prioriza tus acciones según tus objetivos de ',
    it: 'Dai priorità alle azioni in base ai tuoi obiettivi di ',
    zh: '根据你的 ',
  }[normalizeLanguage(i18n.resolvedLanguage)];
  const suffix = {
    fr: ' et de votre ',
    en: ' targets and your ',
    es: ' y tu ',
    it: ' e al tuo ',
    zh: ' 目标以及 ',
  }[normalizeLanguage(i18n.resolvedLanguage)];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {description}
        <KnowledgeTerm term="RTO" /> / <KnowledgeTerm term="RPO" />
        {suffix}
        <KnowledgeTerm term="MTPD" />.
      </p>
      <RecommendationsEngine />
    </div>
  );
}
