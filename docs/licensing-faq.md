This FAQ provides general guidance and does not constitute legal advice. Consult your legal team for your specific situation.

# AGPL Licensing FAQ

## Can I use Stronghold CLI without open-sourcing my code?

Generally, yes. The AGPL applies to Stronghold itself, not to the infrastructure or application code that Stronghold analyzes. Running Stronghold against your own environment does not, by itself, create an obligation to publish your application code.

## Can I self-host Stronghold Server internally?

Generally, yes. Internal use inside one organization, including over an internal company network, does not usually trigger the AGPL network-use sharing obligation as long as the modified service is not offered to third parties.

## Can I modify Stronghold for internal use?

Generally, yes. If you modify Stronghold and use the modified version only inside your own organization, you do not usually need to publish those modifications. The sharing obligation is typically triggered when the modified software is offered to external users over a network.

## What triggers the AGPL copyleft obligation?

The main trigger is offering a modified version of Stronghold to third parties over a network. A typical example would be an MSSP or SaaS provider integrating Stronghold into a hosted service for customers. Internal enterprise use is generally not the scenario the AGPL network clause is targeting.

## Is a commercial license available?

Not yet. Stronghold Cloud is planned as a hosted offering with a commercial licensing path. For enterprise needs such as OEM, redistribution, or custom commercial terms, contact `licensing@stronghold.software`.

## Does Stronghold contain any third-party copyleft code?

At the time of writing, the core runtime depends on permissive third-party packages such as:

- `graphology` under the MIT license
- `yaml` under the ISC license
- AWS SDK v3 packages under Apache-2.0

No third-party copyleft dependency is intentionally included in the core runtime stack.
