// ============================================================
// Risk Resilience Routes — Auto-detected risks from graph
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { detectRisks } from '../graph/riskDetectionEngine.js';

const router = Router();

// ─── POST /risks-resilience/auto-detect — Detect risks from graph ──────────
router.post('/auto-detect', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const analysis = await analyzeFullGraph(graph);
    const detectedRisks = detectRisks(graph, analysis);

    // Persist detected risks
    let newCount = 0;
    let updatedCount = 0;

    for (const risk of detectedRisks) {
      // Check if a similar auto-detected risk already exists
      const existing = await prisma.risk.findFirst({
        where: {
          tenantId,
          autoDetected: true,
          detectionMethod: risk.detectionMethod,
          title: risk.title,
        },
      });

      if (existing) {
        await prisma.risk.update({
          where: { id: existing.id },
          data: {
            description: risk.description,
            probability: risk.probability,
            impact: risk.impact,
          },
        });
        updatedCount++;
      } else {
        const created = await prisma.risk.create({
          data: {
            title: risk.title,
            description: risk.description,
            threatType: risk.category,
            probability: risk.probability,
            impact: risk.impact,
            status: 'open',
            autoDetected: true,
            detectionMethod: risk.detectionMethod,
            tenantId,
          },
        });

        // Create node links
        for (const nodeId of risk.linkedNodeIds) {
          try {
            await prisma.riskNodeLink.create({
              data: {
                riskId: created.id,
                nodeId,
              },
            });
          } catch {
            // Node might not exist, skip
          }
        }

        // Create mitigations
        for (const mitigation of risk.mitigations) {
          await prisma.riskMitigation.create({
            data: {
              riskId: created.id,
              description: mitigation.title,
              status: 'pending',
              tenantId,
            },
          });
        }

        newCount++;
      }
    }

    return res.json({
      detected: detectedRisks,
      newCount,
      updatedCount,
      totalDetected: detectedRisks.length,
    });
  } catch (error) {
    console.error('Error detecting risks:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /risks-resilience/matrix — Dynamic risk matrix ──────────
router.get('/matrix', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const risks = await prisma.risk.findMany({
      where: { tenantId },
      include: { mitigations: true },
    });

    // Build 5x5 matrix
    const matrix: Record<string, any[]> = {};
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        matrix[`${p}_${i}`] = [];
      }
    }

    for (const risk of risks) {
      const key = `${risk.probability}_${risk.impact}`;
      if (matrix[key]) {
        matrix[key].push(risk);
      }
    }

    const stats = {
      total: risks.length,
      critical: risks.filter(r => r.probability * r.impact >= 20).length,
      high: risks.filter(r => r.probability * r.impact >= 12 && r.probability * r.impact < 20).length,
      medium: risks.filter(r => r.probability * r.impact >= 6 && r.probability * r.impact < 12).length,
      low: risks.filter(r => r.probability * r.impact < 6).length,
      autoDetected: risks.filter(r => r.autoDetected).length,
    };

    return res.json({ matrix, stats, lastUpdated: new Date() });
  } catch (error) {
    console.error('Error fetching risk matrix:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /risks-resilience/by-node/:nodeId — Risks for a specific node ──────────
router.get('/by-node/:nodeId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const nodeId = req.params.nodeId as string;

    const links = await prisma.riskNodeLink.findMany({
      where: { nodeId },
      include: {
        risk: {
          include: { mitigations: true },
        },
      },
    });

    const risks = (links as any[])
      .map(l => l.risk)
      .filter((r: any) => r.tenantId === tenantId);

    return res.json({ risks, nodeId });
  } catch (error) {
    console.error('Error fetching node risks:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
