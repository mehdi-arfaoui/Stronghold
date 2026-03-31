import type { InfraNodeAttrs, InfraEdgeAttrs } from '../types/infrastructure.js';

/**
 * Port for infrastructure data persistence.
 * Implemented by the server layer (Prisma, etc.)
 * The core engine works with this interface, never with Prisma directly.
 */
export interface InfrastructureRepository {
  getNodes(tenantId: string): Promise<InfraNodeAttrs[]>;
  getEdges(tenantId: string): Promise<InfraEdgeAttrs[]>;
  saveNodes(tenantId: string, nodes: InfraNodeAttrs[]): Promise<void>;
  saveEdges(tenantId: string, edges: InfraEdgeAttrs[]): Promise<void>;
}
