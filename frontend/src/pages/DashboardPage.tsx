import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Shield, AlertTriangle, Server, Clock, RefreshCw, FlaskConical, Lightbulb, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/dashboard/StatCard';
import { ResilienceGauge } from '@/components/dashboard/ResilienceGauge';
import { SPOFList } from '@/components/dashboard/SPOFList';
import { RiskMatrix } from '@/components/dashboard/RiskMatrix';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { analysisApi } from '@/api/analysis.api';
import { discoveryApi } from '@/api/discovery.api';
import { risksApi } from '@/api/risks.api';
import { financialApi } from '@/api/financial.api';
import { normalizeLanguage, resolveLocale } from '@/i18n/locales';
import { formatRelativeTime } from '@/lib/formatters';

const COPY = {
  fr: {
    loading: 'Chargement du tableau de bord...',
    welcomeTitle: 'Bienvenue sur Stronghold',
    welcomeDescription: 'Lancez un premier scan pour découvrir votre infrastructure et obtenir votre score de résilience.',
    startScan: 'Commencer le scan',
    invalidTitle: 'Configuration API invalide',
    invalidDescription: 'Vérifiez VITE_API_URL et la clé API en localStorage (stronghold_api_key).',
    goDiscovery: 'Aller à la découverte',
    score: 'Score de résilience',
    spofs: 'SPOF détectés',
    criticalServices: 'Services critiques',
    lastScan: 'Dernier scan',
    criticalCount: '{{count}} critique(s)',
    profileConfigured: 'Profil financier configuré. Vous pouvez l’ajuster à tout moment.',
    profileMissing: 'Profil financier non configuré. Configurez-le pour activer l’impact business.',
    configure: 'Configurer',
    history: 'Historique scans & drifts',
    loadingHistory: 'Chargement de l’historique...',
    historyError: 'Impossible de charger l’historique des scans.',
    noHistory: 'Aucun scan historisé pour le moment.',
    scheduled: 'Scan planifié',
    manual: 'Scan manuel',
    noneDrift: 'Aucun drift détecté',
    relaunchScan: 'Relancer un scan',
    newSimulation: 'Nouvelle simulation',
    recommendations: 'Recommandations',
    generateReport: 'Générer le rapport',
  },
  en: {
    loading: 'Loading dashboard...',
    welcomeTitle: 'Welcome to Stronghold',
    welcomeDescription: 'Run your first scan to discover your infrastructure and get your resilience score.',
    startScan: 'Start scan',
    invalidTitle: 'Invalid API configuration',
    invalidDescription: 'Check VITE_API_URL and the API key stored in localStorage (stronghold_api_key).',
    goDiscovery: 'Go to discovery',
    score: 'Resilience score',
    spofs: 'Detected SPOFs',
    criticalServices: 'Critical services',
    lastScan: 'Last scan',
    criticalCount: '{{count}} critical',
    profileConfigured: 'Financial profile configured. You can adjust it at any time.',
    profileMissing: 'Financial profile not configured. Configure it to enable business impact.',
    configure: 'Configure',
    history: 'Scans & drift history',
    loadingHistory: 'Loading history...',
    historyError: 'Unable to load scan history.',
    noHistory: 'No scan history yet.',
    scheduled: 'Scheduled scan',
    manual: 'Manual scan',
    noneDrift: 'No drift detected',
    relaunchScan: 'Relaunch scan',
    newSimulation: 'New simulation',
    recommendations: 'Recommendations',
    generateReport: 'Generate report',
  },
  es: {
    loading: 'Cargando panel...',
    welcomeTitle: 'Bienvenido a Stronghold',
    welcomeDescription: 'Ejecuta un primer escaneo para descubrir tu infraestructura y obtener tu puntuación de resiliencia.',
    startScan: 'Iniciar escaneo',
    invalidTitle: 'Configuración API no válida',
    invalidDescription: 'Comprueba VITE_API_URL y la clave API en localStorage (stronghold_api_key).',
    goDiscovery: 'Ir a descubrimiento',
    score: 'Puntuación de resiliencia',
    spofs: 'SPOF detectados',
    criticalServices: 'Servicios críticos',
    lastScan: 'Último escaneo',
    criticalCount: '{{count}} crítico(s)',
    profileConfigured: 'Perfil financiero configurado. Puedes ajustarlo en cualquier momento.',
    profileMissing: 'Perfil financiero no configurado. Configúralo para activar el impacto de negocio.',
    configure: 'Configurar',
    history: 'Historial de escaneos y derivas',
    loadingHistory: 'Cargando historial...',
    historyError: 'No se puede cargar el historial.',
    noHistory: 'Aún no hay historial.',
    scheduled: 'Escaneo programado',
    manual: 'Escaneo manual',
    noneDrift: 'No se detectó ninguna deriva',
    relaunchScan: 'Relanzar escaneo',
    newSimulation: 'Nueva simulación',
    recommendations: 'Recomendaciones',
    generateReport: 'Generar informe',
  },
  it: {
    loading: 'Caricamento dashboard...',
    welcomeTitle: 'Benvenuto in Stronghold',
    welcomeDescription: 'Esegui una prima scansione per scoprire la tua infrastruttura e ottenere il punteggio di resilienza.',
    startScan: 'Avvia scansione',
    invalidTitle: 'Configurazione API non valida',
    invalidDescription: 'Verifica VITE_API_URL e la chiave API in localStorage (stronghold_api_key).',
    goDiscovery: 'Vai alla scoperta',
    score: 'Punteggio di resilienza',
    spofs: 'SPOF rilevati',
    criticalServices: 'Servizi critici',
    lastScan: 'Ultima scansione',
    criticalCount: '{{count}} critico/i',
    profileConfigured: 'Profilo finanziario configurato. Puoi modificarlo in qualsiasi momento.',
    profileMissing: 'Profilo finanziario non configurato. Configuralo per attivare l’impatto business.',
    configure: 'Configura',
    history: 'Storico scansioni e derive',
    loadingHistory: 'Caricamento storico...',
    historyError: 'Impossibile caricare lo storico.',
    noHistory: 'Nessuno storico disponibile.',
    scheduled: 'Scansione pianificata',
    manual: 'Scansione manuale',
    noneDrift: 'Nessuna deriva rilevata',
    relaunchScan: 'Riavvia scansione',
    newSimulation: 'Nuova simulazione',
    recommendations: 'Raccomandazioni',
    generateReport: 'Genera report',
  },
  zh: {
    loading: '正在加载仪表盘...',
    welcomeTitle: '欢迎使用 Stronghold',
    welcomeDescription: '运行首次扫描以发现基础设施并获取韧性评分。',
    startScan: '开始扫描',
    invalidTitle: 'API 配置无效',
    invalidDescription: '请检查 VITE_API_URL 和 localStorage 中的 API 密钥 (stronghold_api_key)。',
    goDiscovery: '前往发现页',
    score: '韧性评分',
    spofs: '已检测 SPOF',
    criticalServices: '关键服务',
    lastScan: '最近扫描',
    criticalCount: '{{count}} 个严重项',
    profileConfigured: '财务画像已配置，可随时调整。',
    profileMissing: '财务画像尚未配置。请配置以启用业务影响分析。',
    configure: '配置',
    history: '扫描与漂移历史',
    loadingHistory: '正在加载历史...',
    historyError: '无法加载历史。',
    noHistory: '暂无历史记录。',
    scheduled: '计划扫描',
    manual: '手动扫描',
    noneDrift: '未检测到漂移',
    relaunchScan: '重新扫描',
    newSimulation: '新建模拟',
    recommendations: '建议',
    generateReport: '生成报告',
  },
} as const;

export function DashboardPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = resolveLocale(i18n.resolvedLanguage);
  const copy = COPY[normalizeLanguage(i18n.resolvedLanguage)];

  const scoreQuery = useQuery({
    queryKey: ['resilience-score'],
    queryFn: async () => (await analysisApi.getResilienceScore()).data,
  });

  const spofsQuery = useQuery({
    queryKey: ['spofs'],
    queryFn: async () => (await analysisApi.getSPOFs()).data,
  });

  const risksQuery = useQuery({
    queryKey: ['risks'],
    queryFn: async () => (await risksApi.getRisks()).data,
  });

  const financialProfileQuery = useQuery({
    queryKey: ['financial-org-profile'],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
    staleTime: 60_000,
  });

  const timelineQuery = useQuery({
    queryKey: ['scan-timeline'],
    queryFn: async () => (await discoveryApi.getScanTimeline(10)).data.entries,
    staleTime: 60_000,
  });

  const isLoading = scoreQuery.isLoading || spofsQuery.isLoading;
  const hasData = scoreQuery.data !== undefined;

  if (isLoading) {
    return <LoadingState variant="skeleton" message={copy.loading} count={4} />;
  }

  if (!hasData) {
    return (
      <EmptyState
        icon={Shield}
        title={copy.welcomeTitle}
        description={copy.welcomeDescription}
        actionLabel={copy.startScan}
        onAction={() => navigate('/')}
      />
    );
  }

  const score = scoreQuery.data;
  const spofs = Array.isArray(spofsQuery.data) ? spofsQuery.data : [];
  const risks = Array.isArray(risksQuery.data) ? risksQuery.data : [];
  const financialMode = financialProfileQuery.data?.mode || 'infra_only';

  if (typeof score?.overall !== 'number') {
    return (
      <EmptyState
        icon={Shield}
        title={copy.invalidTitle}
        description={copy.invalidDescription}
        actionLabel={copy.goDiscovery}
        onAction={() => navigate('/')}
      />
    );
  }

  const criticalSpofs = spofs.filter((entry) => entry.severity === 'critical').length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title={copy.score} value={`${Math.round(score.overall ?? 0)}/100`} icon={Shield} trend={score.trend} />
        <StatCard
          title={copy.spofs}
          value={spofs.length}
          subtitle={criticalSpofs > 0 ? copy.criticalCount.replace('{{count}}', String(criticalSpofs)) : undefined}
          icon={AlertTriangle}
        />
        <StatCard
          title={copy.criticalServices}
          value={spofs.filter((entry) => entry.severity === 'critical' || entry.severity === 'high').length}
          icon={Server}
        />
        <StatCard
          title={copy.lastScan}
          value={score.lastCalculated ? formatRelativeTime(score.lastCalculated) : 'N/A'}
          icon={Clock}
        />
      </div>

      <Card className={financialMode === 'business_profile' ? 'border-emerald-300 bg-emerald-50/50' : 'border-blue-300 bg-blue-50/50'}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>{financialMode === 'business_profile' ? copy.profileConfigured : copy.profileMissing}</span>
          <Button variant="outline" size="sm" onClick={() => navigate('/settings?tab=finance')}>
            {copy.configure}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{copy.score}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6">
            <ResilienceGauge score={score.overall ?? 0} size={200} />
            {score.breakdown && (
              <div className="w-full space-y-2">
                {score.breakdown.map((item) => (
                  <div key={item.category} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={item.impact < 0 ? 'text-severity-critical' : 'text-resilience-high'}>
                      {item.impact > 0 ? '+' : ''}
                      {item.impact} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <SPOFList spofs={spofs} />
      </div>

      {risks.length > 0 && <RiskMatrix risks={risks} />}

      <Card>
        <CardHeader>
          <CardTitle>{copy.history}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {timelineQuery.isLoading && <p className="text-muted-foreground">{copy.loadingHistory}</p>}
          {timelineQuery.isError && <p className="text-muted-foreground">{copy.historyError}</p>}
          {!timelineQuery.isLoading && !timelineQuery.isError && (timelineQuery.data || []).length === 0 && (
            <p className="text-muted-foreground">{copy.noHistory}</p>
          )}
          {(timelineQuery.data || []).map((entry) => (
            <div key={entry.id} className="rounded-md border p-3">
              <p className="font-medium">
                {new Date(entry.occurredAt).toLocaleString(locale)} - {entry.type === 'scheduled' ? copy.scheduled : copy.manual}
              </p>
              <p className="text-muted-foreground">
                {entry.nodes} nodes, {entry.edges} edges, {entry.spofCount} SPOF
              </p>
              {entry.driftCount > 0 ? (
                <p className="text-amber-700">
                  {entry.driftCount} drift(s)
                  {entry.drifts[0] ? ` - ${entry.drifts[0].description}` : ''}
                </p>
              ) : (
                <p className="text-emerald-700">{copy.noneDrift}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Button variant="outline" onClick={() => navigate('/discovery')}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {copy.relaunchScan}
          </Button>
          <Button variant="outline" onClick={() => navigate('/simulations')}>
            <FlaskConical className="mr-2 h-4 w-4" />
            {copy.newSimulation}
          </Button>
          <Button variant="outline" onClick={() => navigate('/recommendations')}>
            <Lightbulb className="mr-2 h-4 w-4" />
            {copy.recommendations}
          </Button>
          <Button variant="outline" onClick={() => navigate('/report')}>
            <FileDown className="mr-2 h-4 w-4" />
            {copy.generateReport}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
