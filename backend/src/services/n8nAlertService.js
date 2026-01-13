"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyN8nAlert = notifyN8nAlert;
async function notifyN8nAlert(payload) {
    const webhookUrl = process.env.N8N_ALERT_WEBHOOK_URL;
    if (!webhookUrl)
        return;
    const headers = {
        "Content-Type": "application/json",
    };
    const token = process.env.N8N_ALERT_WEBHOOK_TOKEN;
    if (token) {
        headers["x-webhook-token"] = token;
    }
    try {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                ...payload,
                emittedAt: new Date().toISOString(),
            }),
        });
        if (!res.ok) {
            const text = await res.text();
            console.warn("n8n alert webhook failed", {
                status: res.status,
                body: text.slice(0, 200),
            });
        }
    }
    catch (error) {
        console.warn("n8n alert webhook error", {
            message: error?.message,
        });
    }
}
