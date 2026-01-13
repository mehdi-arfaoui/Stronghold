"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentIngestionQueue = exports.createDocumentIngestionConnection = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = require("ioredis");
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
function createDocumentIngestionConnection() {
    return new ioredis_1.default(redisUrl, { maxRetriesPerRequest: null });
}
exports.createDocumentIngestionConnection = createDocumentIngestionConnection;
exports.documentIngestionQueue = new bullmq_1.Queue("documentIngestionQueue", {
    connection: createDocumentIngestionConnection(),
});
