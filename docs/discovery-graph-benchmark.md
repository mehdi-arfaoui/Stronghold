# Benchmark Discovery Graph

Ce benchmark compare un baseline "legacy dagre" et le pipeline Cytoscape sur des graphes synthetiques.

## Commande

```bash
cd frontend
npm run benchmark:discovery
```

## Metriques

- `Legacy prep`: preparation des objets de rendu legacy.
- `Legacy layout`: temps de layout dagre baseline.
- `Cy build`: construction des elements Cytoscape.
- `Cy init`: initialisation du moteur Cytoscape (headless).
- `Cy layout`: layout dagre via plugin Cytoscape.
- `Cy snapshot`: lecture des positions finales (proxy rendu/snapshot).
- `Total legacy`: `Legacy prep + Legacy layout`.
- `Total cy`: `Cy build + Cy init + Cy layout + Cy snapshot`.

## Notes

- Le script est en mode rapide (2 iterations, tailles 100/300/600) pour eviter les timeouts CI.
- Ce benchmark mesure principalement la couche layout + pipeline moteur.
- La fluidite percue en UI depend aussi du rendu navigateur (Canvas/WebGL), qui doit etre validee en conditions reelles via profiling navigateur.
