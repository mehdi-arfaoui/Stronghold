type AlertPayload = {
  event: "llm.quota" | "llm.error" | "discovery.error";
  tenantId?: string;
  correlationId?: string;
  status?: number | string;
  message?: string;
};

export async function notifyN8nAlert(payload: AlertPayload) {
  const webhookUrl = process.env.N8N_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const headers: Record<string, string> = {
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
  } catch (error: any) {
    console.warn("n8n alert webhook error", {
      message: error?.message,
    });
  }
}
