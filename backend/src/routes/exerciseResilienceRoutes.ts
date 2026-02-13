import { appLogger } from "../utils/logger.js";
// ============================================================
// Exercise Resilience Routes — Augmented exercises with simulation
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import {
  generateChecklistFromSimulation,
  compareExerciseWithSimulation,
} from '../graph/exerciseAugmentationService.js';

const router = Router();

// ─── POST /exercises-resilience/auto-checklist — Generate checklist from simulation ──────────
router.post('/auto-checklist', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { simulationId } = req.body;
    if (!simulationId) {
      return res.status(400).json({ error: 'simulationId is required' });
    }

    const checklist = await generateChecklistFromSimulation(prisma, simulationId, tenantId);
    return res.json(checklist);
  } catch (error: any) {
    if (error.message === 'Simulation not found') {
      return res.status(404).json({ error: 'Simulation not found' });
    }
    appLogger.error('Error generating auto-checklist:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /exercises-resilience/link — Link exercise to simulation ──────────
router.post('/link', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { exerciseId, simulationId, autoGenerateChecklist } = req.body;

    if (!exerciseId || !simulationId) {
      return res.status(400).json({ error: 'exerciseId and simulationId are required' });
    }

    // Verify exercise exists
    const exercise = await prisma.exercise.findFirst({
      where: { id: exerciseId, tenantId },
    });
    if (!exercise) {
      return res.status(404).json({ error: 'Exercise not found' });
    }

    // Verify simulation exists
    const simulation = await prisma.simulation.findFirst({
      where: { id: simulationId, tenantId },
    });
    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    // Link exercise to simulation
    await prisma.exercise.update({
      where: { id: exerciseId },
      data: { resilienceSimulationId: simulationId },
    });

    // Optionally auto-generate checklist
    if (autoGenerateChecklist) {
      const checklist = await generateChecklistFromSimulation(prisma, simulationId, tenantId);

      // Create checklist items in the exercise
      for (const item of checklist.items) {
        await prisma.exerciseChecklistItem.create({
          data: {
            exerciseId,
            tenantId,
            order: item.order,
            title: item.title,
            description: item.description,
            role: item.role,
            blocking: item.blocking,
          },
        });
      }

      return res.json({
        linked: true,
        checklistGenerated: true,
        checklistItemsCount: checklist.items.length,
      });
    }

    return res.json({ linked: true, checklistGenerated: false });
  } catch (error) {
    appLogger.error('Error linking exercise to simulation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /exercises-resilience/:exerciseId/comparison — Compare results vs prediction ──────────
router.get('/:exerciseId/comparison', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const exerciseId = req.params.exerciseId as string;

    const comparison = await compareExerciseWithSimulation(prisma, exerciseId, tenantId);
    return res.json(comparison);
  } catch (error: any) {
    if (error.message === 'Exercise not found') {
      return res.status(404).json({ error: 'Exercise not found' });
    }
    if (error.message === 'Exercise is not linked to a resilience simulation') {
      return res.status(400).json({ error: 'Exercise is not linked to a resilience simulation. Use POST /exercises-resilience/link first.' });
    }
    if (error.message === 'Linked simulation not found') {
      return res.status(404).json({ error: 'Linked simulation not found' });
    }
    appLogger.error('Error comparing exercise with simulation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
