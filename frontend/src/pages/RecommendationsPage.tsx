import { RecommendationsEngine } from '@/components/recommendations/RecommendationsEngine';
import { KnowledgeTerm } from '@/components/knowledge-base/KnowledgeTerm';

export function RecommendationsPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Priorisez vos actions en fonction des objectifs <KnowledgeTerm term="RTO" /> / <KnowledgeTerm term="RPO" /> et de votre <KnowledgeTerm term="MTPD" />.
      </p>
      <RecommendationsEngine />
    </div>
  );
}
