/**
 * JSON Schema (draft-07 compatible) for .stronghold/contracts.yml.
 *
 * Hook URL validation intentionally uses a pattern instead of Ajv formats so
 * this module does not require ajv-formats as a new dependency.
 */
export const CONTRACTS_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://stronghold.local/schemas/contracts.v1.schema.json',
  title: 'Stronghold Recoverability Contracts',
  type: 'object',
  required: ['version', 'contracts'],
  additionalProperties: false,
  properties: {
    version: {
      type: 'string',
      enum: ['1'],
    },
    contracts: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['service', 'requirements'],
        additionalProperties: false,
        properties: {
          service: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          owner: { type: 'string', minLength: 1 },
          enforcement: {
            type: 'string',
            enum: ['warn', 'enforce'],
            default: 'warn',
          },
          hooks: {
            type: 'array',
            minItems: 0,
            items: {
              type: 'object',
              required: ['type', 'url', 'on'],
              additionalProperties: false,
              properties: {
                type: { type: 'string', enum: ['webhook'] },
                url: {
                  type: 'string',
                  minLength: 1,
                  pattern: '^https?://[^\\s]+$',
                },
                // YAML 1.1 treats "on" as a boolean in some parsers; the schema
                // keeps the intended key strict and requires an array value.
                on: {
                  type: 'array',
                  minItems: 1,
                  uniqueItems: true,
                  items: {
                    type: 'string',
                    enum: ['met', 'violated', 'unknown'],
                  },
                },
              },
            },
          },
          requirements: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['scenario'],
              additionalProperties: false,
              properties: {
                scenario: { type: 'string', minLength: 1 },
                rto: { type: 'string' },
                rpo: { type: 'string' },
                evidence: {
                  type: 'string',
                  enum: ['inferred', 'observed', 'declared', 'tested'],
                },
                chain_coverage: {
                  type: 'string',
                  enum: ['partial', 'observed', 'proven'],
                },
                spof: {
                  type: 'string',
                  enum: ['any', 'mitigated', 'none'],
                },
              },
              anyOf: [
                { required: ['rto'] },
                { required: ['rpo'] },
                { required: ['evidence'] },
                { required: ['chain_coverage'] },
                { required: ['spof'] },
              ],
            },
          },
        },
      },
    },
  },
} as const;
