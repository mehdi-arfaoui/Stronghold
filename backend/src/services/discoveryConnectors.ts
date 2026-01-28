import { createRequire } from "module";
import type {
  DiscoveryConnectorResult,
  DiscoveryCredentials,
  DiscoveredFlow,
  DiscoveredResource,
  NetworkScanOptions,
  OpenPort,
} from "./discoveryTypes.js";

const require = createRequire(import.meta.url);
const nmap = require("node-nmap");
const snmp = require("net-snmp");
const { Client: SshClient } = require("ssh2");
const wmi = require("node-wmi");

function emptyResult(): DiscoveryConnectorResult {
  return { resources: [], flows: [], warnings: [] };
}

function buildResource(input: Partial<DiscoveredResource> & { source: string; externalId: string }) {
  return {
    name: input.name || input.externalId,
    kind: input.kind || "infra",
    type: input.type || "HOST",
    ...input,
  } satisfies DiscoveredResource;
}

function toPort(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse nmap XML/JSON output to extract open ports with service information.
 * Handles the node-nmap library output format.
 */
export function parseNmapPortsFromHost(host: any): OpenPort[] {
  const ports: OpenPort[] = [];

  // node-nmap returns ports in various formats depending on scan type
  const portList = host?.ports || host?.openPorts || [];

  if (!Array.isArray(portList)) {
    return ports;
  }

  for (const portInfo of portList) {
    if (!portInfo) continue;

    const port = Number(portInfo.port ?? portInfo.portid);
    if (!Number.isFinite(port) || port <= 0) continue;

    const protocol = (portInfo.protocol || "tcp").toLowerCase();
    if (protocol !== "tcp" && protocol !== "udp") continue;

    const state = portInfo.state || portInfo.status || "open";
    // Only include open ports
    if (state !== "open" && state !== "open|filtered") continue;

    const service = portInfo.service?.name || portInfo.service || portInfo.serviceName;
    const version = portInfo.service?.product
      ? `${portInfo.service.product}${portInfo.service.version ? ` ${portInfo.service.version}` : ""}`
      : portInfo.version;

    // Build port entry conditionally to comply with exactOptionalPropertyTypes
    const portEntry: OpenPort = {
      port,
      protocol: protocol as "tcp" | "udp",
      state,
    };
    if (service) portEntry.service = String(service);
    if (version) portEntry.version = String(version);
    ports.push(portEntry);
  }

  return ports;
}

/**
 * Perform a full network scan with service/version detection.
 * Uses nmap SYN scan (-sS) with version detection (-sV).
 *
 * @param ipRanges - Array of IP ranges in CIDR notation
 * @param credentials - Discovery credentials for SNMP/SSH/WMI enrichment
 * @param options - Scan options (topPorts, timeout)
 */
export async function scanNetworkWithServices(
  ipRanges: string[],
  credentials: DiscoveryCredentials,
  options: NetworkScanOptions = {}
): Promise<DiscoveryConnectorResult> {
  if (ipRanges.length === 0) return emptyResult();

  if (process.env.NMAP_PATH) {
    nmap.nmapLocation = process.env.NMAP_PATH;
  }

  const topPorts = options.topPorts ?? 100;
  const timeout = options.timeout ?? 300000; // 5 minutes default

  // Build nmap arguments for service detection
  // -sS: SYN scan (fast, less intrusive)
  // -sV: Service/version detection
  // --top-ports N: Scan top N most common ports
  // -T4: Aggressive timing (faster but reasonable)
  // -n: No DNS resolution (faster)
  // --open: Only show open ports
  const nmapArgs = `-sS -sV --top-ports ${topPorts} -T4 -n --open`;

  const scanResults = await new Promise<any[]>((resolve, reject) => {
    const scan = new nmap.NmapScan(ipRanges.join(" "), nmapArgs);
    const timeoutId = setTimeout(() => {
      scan.cancelScan?.();
      reject(new Error(`Nmap scan timed out after ${timeout}ms`));
    }, timeout);

    scan.on("complete", (data: any[]) => {
      clearTimeout(timeoutId);
      resolve(data || []);
    });
    scan.on("error", (error: Error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    scan.startScan();
  });

  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];

  for (const host of scanResults) {
    const ip = host?.ip || host?.ipaddress || host?.host || null;
    if (!ip) continue;

    const hostname = Array.isArray(host?.hostname) ? host.hostname[0] : host?.hostname || null;

    // Parse open ports from nmap results
    const openPorts = parseNmapPortsFromHost(host);

    // Enrich with SNMP/SSH/WMI data
    let snmpData: Record<string, string> = {};
    let sshInfo: string | null = null;
    let wmiInfo: string | null = null;

    try {
      snmpData = credentials.snmp ? await scanSnmpHost(ip, credentials.snmp) : {};
    } catch {
      warnings.push(`SNMP scan failed for ${ip}`);
    }

    try {
      sshInfo = credentials.ssh ? await scanSshHost(ip, credentials.ssh) : null;
    } catch {
      warnings.push(`SSH scan failed for ${ip}`);
    }

    try {
      wmiInfo = credentials.wmi ? await scanWmiHost(ip, credentials.wmi) : null;
    } catch {
      warnings.push(`WMI scan failed for ${ip}`);
    }

    // Detect OS from various sources
    const detectedOs = host?.osNmap || host?.os?.osmatch?.[0]?.name || wmiInfo || null;

    // Detect services from open ports for better categorization
    const detectedServices = openPorts.map((p) => p.service).filter(Boolean);

    resources.push(
      buildResource({
        source: "network",
        externalId: hostname || ip,
        name: hostname || ip,
        kind: "infra",
        type: "HOST",
        ip,
        hostname,
        openPorts: openPorts.length > 0 ? openPorts : null,
        metadata: {
          snmpSysName: snmpData["1.3.6.1.2.1.1.5.0"],
          snmpSysDescr: snmpData["1.3.6.1.2.1.1.1.0"],
          sshFingerprint: sshInfo,
          wmiOs: wmiInfo,
          detectedOs,
          detectedServices,
          portCount: openPorts.length,
        },
      })
    );
  }

  return { resources, flows: [], warnings };
}

async function scanSnmpHost(
  ip: string,
  credentials: { community?: string; version?: string; port?: number }
): Promise<Record<string, string>> {
  const community = credentials.community || "public";
  const version =
    credentials.version === "1"
      ? snmp.Version1
      : credentials.version === "3"
      ? snmp.Version3
      : snmp.Version2c;
  const session = snmp.createSession(ip, community, {
    port: credentials.port ?? 161,
    version,
    timeout: 3000,
    retries: 1,
  });

  const oids = ["1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.1.0"];
  const values = await new Promise<Record<string, string>>((resolve) => {
    session.get(oids, (error: Error, varbinds: any[]) => {
      if (error || !Array.isArray(varbinds)) {
        resolve({});
        return;
      }
      const result: Record<string, string> = {};
      varbinds.forEach((vb) => {
        if (vb && vb.oid && vb.value) {
          result[vb.oid] = String(vb.value);
        }
      });
      resolve(result);
    });
  });

  session.close();
  return values;
}

async function scanSshHost(
  ip: string,
  credentials: { username?: string; password?: string; privateKey?: string; port?: number }
) {
  if (!credentials.username || (!credentials.password && !credentials.privateKey)) return null;

  return new Promise<string | null>((resolve) => {
    const client = new SshClient();
    client
      .on("ready", () => {
        client.exec("uname -a", (error: Error | undefined, stream: any) => {
          if (error) {
            client.end();
            resolve(null);
            return;
          }
          let data = "";
          stream.on("data", (chunk: Buffer) => {
            data += chunk.toString("utf-8");
          });
          stream.on("close", () => {
            client.end();
            resolve(data.trim() || null);
          });
        });
      })
      .on("error", () => {
        resolve(null);
      })
      .connect({
        host: ip,
        port: credentials.port ?? 22,
        username: credentials.username,
        password: credentials.password,
        privateKey: credentials.privateKey,
        readyTimeout: 5000,
      });
  });
}

async function scanWmiHost(ip: string, credentials: { username?: string; password?: string }) {
  if (!credentials.username || !credentials.password) return null;
  return new Promise<string | null>((resolve) => {
    wmi.Query(
      {
        host: ip,
        username: credentials.username,
        password: credentials.password,
        namespace: "root\\cimv2",
        query: "SELECT Caption FROM Win32_OperatingSystem",
      },
      (error: Error | undefined, result: any[]) => {
        if (error || !Array.isArray(result) || result.length === 0) {
          resolve(null);
          return;
        }
        resolve(result[0]?.Caption ? String(result[0].Caption) : null);
      }
    );
  });
}

export async function scanNetwork(
  ipRanges: string[],
  credentials: DiscoveryCredentials
): Promise<DiscoveryConnectorResult> {
  if (ipRanges.length === 0) return emptyResult();
  if (process.env.NMAP_PATH) {
    nmap.nmapLocation = process.env.NMAP_PATH;
  }

  const scanResults = await new Promise<any[]>((resolve, reject) => {
    const scan = new nmap.NmapScan(ipRanges.join(" "), "-sP -n");
    scan.on("complete", (data: any[]) => resolve(data || []));
    scan.on("error", (error: Error) => reject(error));
    scan.startScan();
  });

  const resources: DiscoveredResource[] = [];
  for (const host of scanResults) {
    const ip = host?.ip || host?.ipaddress || host?.host || null;
    if (!ip) continue;
    const hostname = Array.isArray(host?.hostname) ? host.hostname[0] : host?.hostname || null;
    const snmpData = credentials.snmp ? await scanSnmpHost(ip, credentials.snmp) : {};
    const sshInfo = credentials.ssh ? await scanSshHost(ip, credentials.ssh) : null;
    const wmiInfo = credentials.wmi ? await scanWmiHost(ip, credentials.wmi) : null;

    resources.push(
      buildResource({
        source: "network",
        externalId: hostname || ip,
        name: hostname || ip,
        kind: "infra",
        type: "HOST",
        ip,
        hostname,
        metadata: {
          snmpSysName: snmpData["1.3.6.1.2.1.1.5.0"],
          snmpSysDescr: snmpData["1.3.6.1.2.1.1.1.0"],
          sshFingerprint: sshInfo,
          wmiOs: wmiInfo,
        },
      })
    );
  }

  return { resources, flows: [], warnings: [] };
}

export async function scanHyperV(
  credentials: DiscoveryCredentials
): Promise<DiscoveryConnectorResult> {
  if (!credentials.hyperv?.endpoint || !credentials.hyperv?.username || !credentials.hyperv?.password) {
    return emptyResult();
  }
  const resources = await new Promise<DiscoveredResource[]>((resolve) => {
    wmi.Query(
      {
        host: credentials.hyperv?.endpoint,
        username: credentials.hyperv?.username,
        password: credentials.hyperv?.password,
        namespace: "root\\virtualization\\v2",
        query: "SELECT ElementName, Name FROM Msvm_ComputerSystem WHERE Description = 'Microsoft Virtual Machine'",
      },
      (error: Error | undefined, result: any[]) => {
        if (error || !Array.isArray(result)) {
          resolve([]);
          return;
        }
        resolve(
          result.map((vm) =>
            buildResource({
              source: "hyperv",
              externalId: vm?.Name ? String(vm.Name) : String(vm?.ElementName || "vm"),
              name: String(vm?.ElementName || "vm"),
              kind: "infra",
              type: "VM",
            })
          )
        );
      }
    );
  });

  return { resources, flows: [], warnings: [] };
}

export async function scanVmware(
  credentials: DiscoveryCredentials
): Promise<DiscoveryConnectorResult> {
  if (!credentials.vmware?.endpoint || !credentials.vmware?.username || !credentials.vmware?.password) {
    return emptyResult();
  }
  const endpoint = credentials.vmware.endpoint.replace(/\/+$/, "");
  const sessionResponse = await fetch(`${endpoint}/rest/com/vmware/cis/session`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${credentials.vmware.username}:${credentials.vmware.password}`
      ).toString("base64")}`,
    },
  });

  if (!sessionResponse.ok) {
    return { resources: [], flows: [], warnings: ["VMware authentication failed"] };
  }

  const sessionPayload = (await sessionResponse.json()) as { value?: string };
  const sessionId = sessionPayload.value;
  if (!sessionId) return { resources: [], flows: [], warnings: ["VMware session missing"] };

  const vmResponse = await fetch(`${endpoint}/rest/vcenter/vm`, {
    headers: { "vmware-api-session-id": sessionId },
  });
  if (!vmResponse.ok) {
    return { resources: [], flows: [], warnings: ["VMware inventory fetch failed"] };
  }

  const vmPayload = (await vmResponse.json()) as { value?: any[] };
  const resources =
    vmPayload.value?.map((vm) =>
      buildResource({
        source: "vmware",
        externalId: String(vm?.vm || vm?.name),
        name: String(vm?.name || vm?.vm),
        kind: "infra",
        type: "VM",
        metadata: { powerState: vm?.power_state, cpuCount: vm?.cpu_count },
      })
    ) || [];

  return { resources, flows: [], warnings: [] };
}

/**
 * Kubernetes resource edge representing a dependency relationship.
 */
export type K8sEdge = {
  source: string;
  target: string;
  dependencyType: string;
};

export async function scanKubernetes(
  credentials: DiscoveryCredentials
): Promise<DiscoveryConnectorResult & { edges?: K8sEdge[] }> {
  if (!credentials.kubernetes?.kubeconfig) return emptyResult();
  const k8s = require("@kubernetes/client-node");
  const kc = new k8s.KubeConfig();
  kc.loadFromString(credentials.kubernetes.kubeconfig);
  if (credentials.kubernetes.context) {
    kc.setCurrentContext(credentials.kubernetes.context);
  }

  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

  const resources: DiscoveredResource[] = [];
  const edges: K8sEdge[] = [];
  const warnings: string[] = [];

  // Track pod selectors for relationship mapping
  const podsByLabels = new Map<string, string[]>(); // labelKey=labelValue -> [podUids]

  // --- Nodes ---
  const nodes = await coreApi.listNode();
  nodes.body.items.forEach((node: any) => {
    resources.push(
      buildResource({
        source: "kubernetes",
        externalId: node.metadata?.uid || node.metadata?.name,
        name: node.metadata?.name || "node",
        kind: "infra",
        type: "K8S_NODE",
        metadata: {
          labels: node.metadata?.labels,
          kubeletVersion: node.status?.nodeInfo?.kubeletVersion,
          osImage: node.status?.nodeInfo?.osImage,
          containerRuntime: node.status?.nodeInfo?.containerRuntimeVersion,
        },
      })
    );
  });

  // --- Pods ---
  const pods = await coreApi.listPodForAllNamespaces();
  pods.body.items.forEach((pod: any) => {
    const podUid = pod.metadata?.uid || `${pod.metadata?.namespace}/${pod.metadata?.name}`;
    const podName = `${pod.metadata?.namespace}/${pod.metadata?.name}`;

    resources.push(
      buildResource({
        source: "kubernetes",
        externalId: podUid,
        name: podName,
        kind: "infra",
        type: "K8S_POD",
        ip: pod.status?.podIP || null,
        metadata: {
          namespace: pod.metadata?.namespace,
          nodeName: pod.spec?.nodeName,
          containers: pod.spec?.containers?.length || 0,
          phase: pod.status?.phase,
          labels: pod.metadata?.labels,
        },
      })
    );

    // Index pods by their labels for service selector matching
    const labels = pod.metadata?.labels || {};
    for (const [key, value] of Object.entries(labels)) {
      const labelKey = `${key}=${value}`;
      if (!podsByLabels.has(labelKey)) {
        podsByLabels.set(labelKey, []);
      }
      podsByLabels.get(labelKey)!.push(podUid);
    }

    // Edge: Pod -> Node
    if (pod.spec?.nodeName) {
      const nodeResource = resources.find(
        (r) => r.type === "K8S_NODE" && r.name === pod.spec.nodeName
      );
      if (nodeResource) {
        edges.push({
          source: podUid,
          target: nodeResource.externalId,
          dependencyType: "runs_on",
        });
      }
    }
  });

  // --- Persistent Volumes ---
  const volumes = await coreApi.listPersistentVolume();
  volumes.body.items.forEach((pv: any) => {
    resources.push(
      buildResource({
        source: "kubernetes",
        externalId: pv.metadata?.uid || pv.metadata?.name,
        name: pv.metadata?.name || "pv",
        kind: "infra",
        type: "K8S_VOLUME",
        metadata: {
          capacity: pv.spec?.capacity,
          storageClass: pv.spec?.storageClassName,
          accessModes: pv.spec?.accessModes,
          status: pv.status?.phase,
        },
      })
    );
  });

  // --- Services ---
  try {
    const services = await coreApi.listServiceForAllNamespaces();
    services.body.items.forEach((svc: any) => {
      const svcUid = svc.metadata?.uid || `${svc.metadata?.namespace}/${svc.metadata?.name}`;
      const svcName = `${svc.metadata?.namespace}/${svc.metadata?.name}`;

      resources.push(
        buildResource({
          source: "kubernetes",
          externalId: svcUid,
          name: svcName,
          kind: "service",
          type: "K8S_SERVICE",
          ip: svc.spec?.clusterIP || null,
          metadata: {
            namespace: svc.metadata?.namespace,
            type: svc.spec?.type,
            ports: svc.spec?.ports?.map((p: any) => ({
              port: p.port,
              targetPort: p.targetPort,
              protocol: p.protocol,
            })),
            selector: svc.spec?.selector,
            externalIPs: svc.spec?.externalIPs,
            loadBalancerIP: svc.status?.loadBalancer?.ingress?.[0]?.ip,
          },
        })
      );

      // Edge: Service -> Pods (via selector)
      const selector = svc.spec?.selector || {};
      for (const [key, value] of Object.entries(selector)) {
        const labelKey = `${key}=${value}`;
        const matchingPods = podsByLabels.get(labelKey) || [];
        for (const podUid of matchingPods) {
          edges.push({
            source: svcUid,
            target: podUid,
            dependencyType: "routes_to",
          });
        }
      }
    });
  } catch (error) {
    warnings.push("Failed to list Kubernetes services");
  }

  // --- Ingress ---
  try {
    const ingresses = await networkingApi.listIngressForAllNamespaces();
    ingresses.body.items.forEach((ing: any) => {
      const ingUid = ing.metadata?.uid || `${ing.metadata?.namespace}/${ing.metadata?.name}`;
      const ingName = `${ing.metadata?.namespace}/${ing.metadata?.name}`;

      const rules = ing.spec?.rules?.map((rule: any) => ({
        host: rule.host,
        paths: rule.http?.paths?.map((path: any) => ({
          path: path.path,
          pathType: path.pathType,
          serviceName: path.backend?.service?.name,
          servicePort: path.backend?.service?.port?.number || path.backend?.service?.port?.name,
        })),
      }));

      resources.push(
        buildResource({
          source: "kubernetes",
          externalId: ingUid,
          name: ingName,
          kind: "infra",
          type: "K8S_INGRESS",
          metadata: {
            namespace: ing.metadata?.namespace,
            ingressClassName: ing.spec?.ingressClassName,
            rules,
            tls: ing.spec?.tls?.map((t: any) => ({ hosts: t.hosts, secretName: t.secretName })),
            loadBalancerIP: ing.status?.loadBalancer?.ingress?.[0]?.ip,
          },
        })
      );

      // Edge: Ingress -> Services
      for (const rule of ing.spec?.rules || []) {
        for (const path of rule.http?.paths || []) {
          const serviceName = path.backend?.service?.name;
          if (serviceName) {
            const namespace = ing.metadata?.namespace;
            const targetService = resources.find(
              (r) =>
                r.type === "K8S_SERVICE" &&
                r.name === `${namespace}/${serviceName}`
            );
            if (targetService) {
              edges.push({
                source: ingUid,
                target: targetService.externalId,
                dependencyType: "routes_to",
              });
            }
          }
        }
      }
    });
  } catch (error) {
    warnings.push("Failed to list Kubernetes ingresses");
  }

  // --- Deployments ---
  try {
    const deployments = await appsApi.listDeploymentForAllNamespaces();
    deployments.body.items.forEach((deploy: any) => {
      const deployUid = deploy.metadata?.uid || `${deploy.metadata?.namespace}/${deploy.metadata?.name}`;
      const deployName = `${deploy.metadata?.namespace}/${deploy.metadata?.name}`;

      resources.push(
        buildResource({
          source: "kubernetes",
          externalId: deployUid,
          name: deployName,
          kind: "service",
          type: "K8S_DEPLOYMENT",
          metadata: {
            namespace: deploy.metadata?.namespace,
            replicas: deploy.spec?.replicas,
            availableReplicas: deploy.status?.availableReplicas,
            readyReplicas: deploy.status?.readyReplicas,
            strategy: deploy.spec?.strategy?.type,
            selector: deploy.spec?.selector?.matchLabels,
          },
        })
      );

      // Edge: Deployment -> Pods (via selector)
      const selector = deploy.spec?.selector?.matchLabels || {};
      for (const [key, value] of Object.entries(selector)) {
        const labelKey = `${key}=${value}`;
        const matchingPods = podsByLabels.get(labelKey) || [];
        for (const podUid of matchingPods) {
          edges.push({
            source: deployUid,
            target: podUid,
            dependencyType: "manages",
          });
        }
      }
    });
  } catch (error) {
    warnings.push("Failed to list Kubernetes deployments");
  }

  // --- StatefulSets ---
  try {
    const statefulSets = await appsApi.listStatefulSetForAllNamespaces();
    statefulSets.body.items.forEach((sts: any) => {
      const stsUid = sts.metadata?.uid || `${sts.metadata?.namespace}/${sts.metadata?.name}`;
      const stsName = `${sts.metadata?.namespace}/${sts.metadata?.name}`;

      resources.push(
        buildResource({
          source: "kubernetes",
          externalId: stsUid,
          name: stsName,
          kind: "service",
          type: "K8S_STATEFULSET",
          metadata: {
            namespace: sts.metadata?.namespace,
            replicas: sts.spec?.replicas,
            readyReplicas: sts.status?.readyReplicas,
            serviceName: sts.spec?.serviceName,
            selector: sts.spec?.selector?.matchLabels,
            volumeClaimTemplates: sts.spec?.volumeClaimTemplates?.length,
          },
        })
      );

      // Edge: StatefulSet -> Pods (via selector)
      const selector = sts.spec?.selector?.matchLabels || {};
      for (const [key, value] of Object.entries(selector)) {
        const labelKey = `${key}=${value}`;
        const matchingPods = podsByLabels.get(labelKey) || [];
        for (const podUid of matchingPods) {
          edges.push({
            source: stsUid,
            target: podUid,
            dependencyType: "manages",
          });
        }
      }
    });
  } catch (error) {
    warnings.push("Failed to list Kubernetes statefulsets");
  }

  return { resources, flows: [], warnings, edges };
}

export async function scanFlows(credentials: DiscoveryCredentials): Promise<DiscoveryConnectorResult> {
  if (!Array.isArray(credentials.flowSamples) || credentials.flowSamples.length === 0) {
    return emptyResult();
  }
  const flows: DiscoveredFlow[] = credentials.flowSamples.map((sample) => ({
    sourceIp: (sample.sourceIp as string) || (sample.src_ip as string) || null,
    targetIp: (sample.targetIp as string) || (sample.dst_ip as string) || null,
    sourcePort: toPort(sample.sourcePort ?? sample.src_port),
    targetPort: toPort(sample.targetPort ?? sample.dst_port),
    protocol: (sample.protocol as string) || (sample.proto as string) || null,
    bytes: Number(sample.bytes ?? sample.octets) || null,
    packets: Number(sample.packets ?? sample.pkt) || null,
    observedAt: sample.observedAt ? new Date(sample.observedAt as string) : null,
  }));

  return { resources: [], flows, warnings: [] };
}
