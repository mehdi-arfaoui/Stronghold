# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Stronghold build targets

The frontend supports two build variants controlled at build time by `BUILD_TARGET`:

- `BUILD_TARGET=client`: demo pages are excluded and `__DEMO_ENABLED__` is `false`.
- `BUILD_TARGET=internal`: demo pages are included and the internal demo onboarding stays available.

Examples:

- Client build: `$env:BUILD_TARGET='client'; npm run build`
- Internal build: `$env:BUILD_TARGET='internal'; npm run build`
- Docker client image: `docker build --target client -t stronghold-web:client .`
- Docker internal image: `docker build --target internal -t stronghold-web:internal .`

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Stronghold UI customization

## Graphes d'infrastructure (Cytoscape)

### Installation
Les dépendances suivantes sont utilisées pour le rendu des graphes interactifs :

```bash
npm install cytoscape cytoscape-cose-bilkent cytoscape-popper cytoscape-svg tippy.js
```

### Format des données
Le hook `useFetchGraphData` transforme la réponse API en un format standard :

```ts
type InfrastructureGraphNode = {
  id: string;
  label: string;
  type: "service" | "application" | "infra";
  criticality: string;
  category?: string | null;
  metadata?: Record<string, unknown> | null;
  dependsOnCount?: number;
  usedByCount?: number;
};

type InfrastructureGraphEdge = {
  id: string;
  source: string;
  target: string;
  type?: string | null;
  weight?: number | null;
};
```

### Composant `InfrastructureGraph`
Exemple d'intégration :

```tsx
import { InfrastructureGraph } from "./components/graph/InfrastructureGraph";
import { useFetchGraphData } from "./hooks/useFetchGraphData";
import { buildCytoscapeElements } from "./utils/graphTransform";

export function ExampleGraph() {
  const { data, loading } = useFetchGraphData({ endpoint: "/graph" });
  if (!data) return null;
  return <InfrastructureGraph elements={buildCytoscapeElements(data)} isLoading={loading} />;
}
```

### Styles et interactions
- Les styles Cytoscape sont centralisés dans `InfrastructureGraph.tsx` (couleurs par criticité, formes par type).
- Les interactions incluent zoom/pan, survol avec tooltip, double-clic pour recadrer un sous-graphe, exports PNG/SVG.

### Ajouter une page ou un lien de navigation
1. Ajoutez un nouvel objet dans `navLinks` de `src/App.tsx` pour exposer le lien dans le menu principal.
2. Associez un `TabId` dans `tabNavigationMap` pour relier le lien à un module existant.
3. Si vous créez un nouveau module, ajoutez le `TabDefinition` correspondant dans `tabs` et créez la section dans `src/sections/`.

### Personnaliser la palette et le thème
- Les couleurs principales se trouvent dans `src/App.css` (`--primary-color`, `--secondary-color`, `--accent-color`, etc.).
- Les variantes sombre/clair sont définies via `prefers-color-scheme` dans `src/App.css`.
- Le reset et les styles de base sont dans `src/index.css` si vous souhaitez ajuster la typographie globale.
