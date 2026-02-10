import { useQuery } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { knowledgeBaseApi } from '@/api/knowledge-base.api';
import { Link } from 'react-router-dom';

interface KnowledgeTermProps {
  term: string;
}

export function KnowledgeTerm({ term }: KnowledgeTermProps) {
  const termQuery = useQuery({
    queryKey: ['knowledge-term', term],
    queryFn: async () => (await knowledgeBaseApi.getByTerm(term)).data.article,
  });

  const article = termQuery.data;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-4">{term}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm space-y-2">
        <p className="font-semibold">{article?.title ?? term}</p>
        <p className="text-xs text-muted-foreground">{article?.summary ?? 'Terme de resilience IT.'}</p>
        <Link className="text-xs text-primary underline" to={`/knowledge-base?term=${encodeURIComponent(term)}`}>
          En savoir plus
        </Link>
      </TooltipContent>
    </Tooltip>
  );
}
