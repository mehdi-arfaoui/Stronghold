import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getCredentialScopeKey } from '@/lib/credentialStorage';

type GuideStep = {
  id: 'discovery' | 'analysis' | 'business-flows';
  route: string;
  title: string;
  description: string;
  highlights: string[];
  continueTo?: string;
  continueLabel?: string;
};

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'discovery',
    route: '/discovery',
    title: 'Parcours guide: Decouverte',
    description:
      "Cette vue presente les services, applications et dependances detectes sur vos environnements on-prem et cloud.",
    highlights: [
      'Verifier les services et applications critiques detectes',
      'Controler les dependances et SPOF avant analyse',
      'Confirmer les liens infers pour fiabiliser la suite',
    ],
    continueTo: '/analysis',
    continueLabel: 'Continuer vers Analyse & BIA',
  },
  {
    id: 'analysis',
    route: '/analysis',
    title: 'Parcours guide: Analyse & BIA',
    description:
      'Cette section regroupe les sous-onglets de score, SPOF, BIA et criticite pour valider vos hypotheses de reprise.',
    highlights: [
      'Valider les estimations BIA importantes',
      'Corriger RTO/RPO/MTPD si necessaire',
      'Identifier les points critiques avant arbitrage',
    ],
    continueTo: '/business-flows',
    continueLabel: 'Continuer vers Flux Metier',
  },
  {
    id: 'business-flows',
    route: '/business-flows',
    title: 'Parcours guide: Flux Metier',
    description:
      "Cette page relie les flux metier aux composants techniques, expose les recommandations IA et l'option Cloud Enrich.",
    highlights: [
      'Creer un flux avec "New flow" ou enrichir via "Cloud enrich"',
      'Modifier un flux avec "Edit" pour ajuster noeuds et criticite',
      'Valider les flux cle pour fiabiliser ROI & Finance',
    ],
  },
];

function resolveStep(pathname: string): GuideStep | null {
  const exact = GUIDE_STEPS.find((step) => step.route === pathname);
  if (exact) return exact;
  return (
    GUIDE_STEPS
      .filter((step) => pathname.startsWith(`${step.route}/`))
      .sort((a, b) => b.route.length - a.route.length)[0] || null
  );
}

function storageKey(step: GuideStep, tenantScope: string): string {
  return `stronghold:first-visit:${tenantScope}:${step.id}`;
}

export function GuidedTabTour() {
  const location = useLocation();
  const navigate = useNavigate();
  const tenantScope = getCredentialScopeKey();
  const step = useMemo(() => resolveStep(location.pathname), [location.pathname]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!step) {
      setOpen(false);
      return;
    }
    const dismissed = localStorage.getItem(storageKey(step, tenantScope)) === '1';
    setOpen(!dismissed);
  }, [step, tenantScope]);

  const dismiss = () => {
    if (step) {
      localStorage.setItem(storageKey(step, tenantScope), '1');
    }
    setOpen(false);
  };

  const continueFlow = () => {
    const target = step?.continueTo;
    dismiss();
    if (target) {
      navigate(target);
    }
  };

  if (!step) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismiss();
        else setOpen(true);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription>{step.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          {step.highlights.map((item) => (
            <p key={item}>- {item}</p>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={dismiss}>
            Fermer
          </Button>
          {step.continueTo ? (
            <Button onClick={continueFlow}>{step.continueLabel || 'Continuer'}</Button>
          ) : (
            <Button onClick={dismiss}>Terminer</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

