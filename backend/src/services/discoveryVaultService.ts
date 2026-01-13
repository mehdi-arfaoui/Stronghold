type VaultResponse = {
  data?: any;
};

export async function resolveVaultCredentials(
  credentials: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const vaultAddr = process.env.VAULT_ADDR;
  const vaultToken = process.env.VAULT_TOKEN;
  const vaultPath = (credentials.vaultPath as string) || null;
  if (!vaultAddr || !vaultToken || !vaultPath) {
    return credentials;
  }

  const url = `${vaultAddr.replace(/\/+$/, "")}/v1/${vaultPath.replace(/^\/+/, "")}`;
  const response = await fetch(url, {
    headers: {
      "X-Vault-Token": vaultToken,
    },
  });
  if (!response.ok) {
    throw new Error("Vault credential fetch failed");
  }
  const payload = (await response.json()) as VaultResponse;
  const data = payload?.data?.data || payload?.data || {};
  if (!data || typeof data !== "object") {
    return credentials;
  }
  const { vaultPath: _vaultPath, vaultKey: _vaultKey, ...rest } = credentials;
  return { ...rest, ...(data as Record<string, unknown>) };
}
