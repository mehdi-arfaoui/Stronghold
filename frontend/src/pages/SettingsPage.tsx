import { Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { IntegrationsHub } from '@/components/integrations/IntegrationsHub';
import { useUIStore } from '@/stores/ui.store';

export function SettingsPage() {
  const { theme, toggleTheme } = useUIStore();

  return (
    <div className="space-y-6">
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="mx-auto max-w-2xl space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Parametres
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Theme */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Mode sombre</Label>
                    <p className="text-sm text-muted-foreground">Activer le theme sombre</p>
                  </div>
                  <Switch checked={theme === 'dark'} onCheckedChange={toggleTheme} />
                </div>

                <Separator />

                {/* API Configuration */}
                <div>
                  <Label>URL de l&apos;API</Label>
                  <p className="text-sm text-muted-foreground">
                    {import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}
                  </p>
                </div>

                <Separator />

                {/* Version info */}
                <div>
                  <Label>Version</Label>
                  <p className="text-sm text-muted-foreground">Stronghold v2.0.0</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="integrations">
          <IntegrationsHub />
        </TabsContent>
      </Tabs>
    </div>
  );
}
