import { RunbookTemplate } from "@prisma/client";
export type TemplateFormat = "DOCX" | "ODT" | "MARKDOWN";
export declare function detectTemplateFormat(mimeType: string, originalName: string): TemplateFormat | null;
export declare function computeBufferHash(buffer: Buffer): string;
export declare function computeFileHash(filePath: string): Promise<string>;
export declare function loadTemplateText(template: RunbookTemplate): Promise<string>;
export declare function applyPlaceholders(content: string, placeholders: Record<string, string>): string;
export declare function sanitizeTemplateDescription(text: string | null | undefined): string | null;
//# sourceMappingURL=runbookTemplateService.d.ts.map
