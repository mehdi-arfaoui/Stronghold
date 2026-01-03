export interface RunbookGenerationOptions {
    scenarioId?: string | null;
    title?: string;
    summary?: string;
    owner?: string;
    templateId?: string | null;
}
export declare function generateRunbook(tenantId: string, options: RunbookGenerationOptions): Promise<{
    runbook: {
        id: string;
        tenantId: string;
        updatedAt: Date;
        scenarioId: string | null;
        title: string;
        status: string;
        summary: string | null;
        markdownPath: string | null;
        pdfPath: string | null;
        docxPath: string | null;
        generatedForServices: string | null;
        templateNameSnapshot: string | null;
        generatedAt: Date;
        templateId: string | null;
    };
    markdown: string;
    pdfPath: string | null;
    docxPath: string | null;
    markdownPath: string | null;
    ragContext: import("../ai/ragService").RagContext;
    llmPrompt: string;
    ragScenarioRecommendations: import("../ai/ragService").RagScenarioRecommendation[];
}>;
//# sourceMappingURL=runbookGenerator.d.ts.map