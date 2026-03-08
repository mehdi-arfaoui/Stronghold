import { describe, expect, it } from 'vitest';

import { syncCytoscapeWheelSensitivity } from './InfraGraph';

describe('syncCytoscapeWheelSensitivity', () => {
  it('overrides renderer wheelSensitivity when it drifts', () => {
    const options = { wheelSensitivity: 1 };
    const fakeCy = {
      renderer: () => ({ options }),
    } as any;

    syncCytoscapeWheelSensitivity(fakeCy, 0.3);
    expect(options.wheelSensitivity).toBe(0.3);
  });

  it('keeps current value when already aligned', () => {
    const options = { wheelSensitivity: 0.3 };
    const fakeCy = {
      renderer: () => ({ options }),
    } as any;

    syncCytoscapeWheelSensitivity(fakeCy, 0.3);
    expect(options.wheelSensitivity).toBe(0.3);
  });

  it('ignores invalid renderer payloads', () => {
    const fakeCy = {
      renderer: () => ({}),
    } as any;

    expect(() => syncCytoscapeWheelSensitivity(fakeCy, 0.3)).not.toThrow();
    expect(() => syncCytoscapeWheelSensitivity(fakeCy, -1)).not.toThrow();
    expect(() => syncCytoscapeWheelSensitivity(null, 0.3)).not.toThrow();
  });

  it('keeps renderer call bound to Cytoscape core context', () => {
    const options = { wheelSensitivity: 1 };
    const fakeCy = {
      _private: { renderer: { options } },
      renderer(this: any) {
        return this._private.renderer;
      },
    } as any;

    expect(() => syncCytoscapeWheelSensitivity(fakeCy, 0.3)).not.toThrow();
    expect(options.wheelSensitivity).toBe(0.3);
  });
});
