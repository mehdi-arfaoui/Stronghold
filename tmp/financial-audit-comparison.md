# Financial Pipeline Audit (Stronghold)

## Before Fix

| Metrique | Source Recommandations IA | Source ROI & Finance | Identique ? |
| --- | --- | --- | --- |
| `hourlyDowntimeCost` | `resolveCompanyFinancialProfile()` (cascade user -> BIA valide -> inference) | `FinancialEngineService.calculateROI()` via `context.profile` brut (`customDowntime` -> `hourlyDowntime` -> moyenne couts noeuds) | Non |
| Cout DR | `selectDrStrategyForService()` + `estimatedMonthlyCost * productionCostMultiplier` | `FinancialEngineService.calculateROI()` sur recommandations `generateHybridRecommendations` (couts implicites `strategyAnnualCost` ou payload) | Non |
| Risque evite | `calculateRecommendationRoi()` par service puis somme | `FinancialEngineService.calculateROI()` (ALE current/projete) | Non |
| Formule ROI | `calculateRecommendationRoi()` locale (route landing-zone) | `FinancialEngineService.calculateROI()` | Non |
| Perimetre BIA / services | Recommandations `landing-zone` (BIA + tier/recovery) | Recommandations hybrides (`generateHybridRecommendations`) + BIA valide filtre | Non |

### Root cause "100% Hot Standby"

- La selection strategie utilisait des seuils RTO/RPO rigides et des `suggestedRTO/suggestedRPO` meme non valides.
- Plusieurs services de demo avaient des objectifs agressifs auto-suggeres (souvent RPO bas), forçant des strategies hautes.
- Le fallback criticite n'etait pas applique proprement quand les objectifs n'etaient pas explicitement valides.

## After Fix (target state implemented)

| Metrique | Source Recommandations IA | Source ROI & Finance | Identique ? |
| --- | --- | --- | --- |
| `hourlyDowntimeCost` | Profil resolu commun (`resolveCompanyFinancialProfile`) | Meme profil resolu commun | Oui |
| Cout DR | Recommandations `landing-zone` + couts DR retenus dans `RecommendationInput` | Meme `RecommendationInput` reutilise pour ROI dashboard | Oui |
| Risque evite | `FinancialEngineService.calculateROI()` | `FinancialEngineService.calculateROI()` | Oui |
| Formule ROI | `FinancialEngineService.calculateROI()` | `FinancialEngineService.calculateROI()` | Oui |
| Perimetre BIA / services | Service partage `buildLandingZoneFinancialContext()` | Meme service partage pour alimenter `/financial/summary` | Oui |

