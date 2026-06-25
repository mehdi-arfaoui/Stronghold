export const DEMO_CONTRACTS_YAML = `# Demo recoverability contract.
# This targets the built-in startup demo service named "startup-api".
version: "1"
contracts:
  - service: startup-api
    description: "Demo contract - critical service DR requirements"
    enforcement: enforce
    requirements:
      - scenario: region_failure
        rto: 1h
        rpo: 5m
`;
