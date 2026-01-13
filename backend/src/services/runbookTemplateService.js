"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTemplateFormat = detectTemplateFormat;
exports.computeBufferHash = computeBufferHash;
exports.computeFileHash = computeFileHash;
exports.loadTemplateText = loadTemplateText;
exports.applyPlaceholders = applyPlaceholders;
exports.sanitizeTemplateDescription = sanitizeTemplateDescription;
const crypto = __importStar(require("crypto"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const fs_1 = __importDefault(require("fs"));
const mammoth_1 = __importDefault(require("mammoth"));
const client_1 = require("@prisma/client");
const s3Client_1 = require("../clients/s3Client");
function detectTemplateFormat(mimeType, originalName) {
    const lowerMime = (mimeType || "").toLowerCase();
    const lowerName = originalName.toLowerCase();
    if (lowerMime.includes("officedocument.wordprocessingml.document") || lowerName.endsWith(".docx")) {
        return "DOCX";
    }
    if (lowerMime.includes("application/vnd.oasis.opendocument.text") || lowerName.endsWith(".odt")) {
        return "ODT";
    }
    if (lowerMime.includes("markdown") || lowerMime.includes("text/markdown") || lowerName.endsWith(".md")) {
        return "MARKDOWN";
    }
    // fallback: treat plain text as markdown for simplicity
    if (lowerMime.startsWith("text/")) {
        return "MARKDOWN";
    }
    return null;
}
function computeBufferHash(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}
async function computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs_1.default.createReadStream(filePath);
        stream.on("error", (err) => reject(err));
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}
function stripXmlTags(xml) {
    return xml
        .replace(/<\/text:p>/g, "\n")
        .replace(/<\/text:h>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
async function readOdtText(filePath) {
    const zip = new adm_zip_1.default(filePath);
    const contentEntry = zip.getEntry("content.xml");
    if (!contentEntry) {
        return "";
    }
    const content = contentEntry.getData().toString("utf8");
    return stripXmlTags(content);
}
async function readDocxText(filePath) {
    const result = await mammoth_1.default.extractRawText({ path: filePath });
    return result.value || "";
}
async function loadTemplateText(template) {
    const { bucket, key } = (0, s3Client_1.resolveBucketAndKey)(template.storagePath, template.tenantId, template.storedName);
    const tempFile = await (0, s3Client_1.downloadObjectToTempFile)(bucket, key, template.originalName);
    const format = (template.format || "").toUpperCase();
    if (format === "DOCX") {
        return readDocxText(tempFile);
    }
    if (format === "ODT") {
        return readOdtText(tempFile);
    }
    return fs_1.default.promises.readFile(tempFile, "utf8");
}
function applyPlaceholders(content, placeholders) {
    let output = content;
    Object.entries(placeholders).forEach(([token, value]) => {
        const pattern = new RegExp(`{{\\s*${token}\\s*}}`, "gi");
        output = output.replace(pattern, value);
    });
    return output;
}
function sanitizeTemplateDescription(text) {
    if (!text)
        return null;
    return text.trim().slice(0, 2000) || null;
}
//# sourceMappingURL=runbookTemplateService.js.map
