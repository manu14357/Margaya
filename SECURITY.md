# Security Policy

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue, and do not include details in a pull request.

Use [GitHub's private vulnerability reporting](https://github.com/manu14357/Margaya/security/advisories/new), which notifies the maintainers directly and keeps the discussion private until a fix ships. If you cannot use it, open a [GitHub Discussion](https://github.com/manu14357/Margaya/discussions) or an [issue](https://github.com/manu14357/Margaya/issues) asking the maintainer for a private contact, without any details of the vulnerability.

Helpful things to include, as far as you have them:

- the affected version or commit
- the endpoint, file, or flow involved
- what an attacker gains, and the minimum privilege they need to do it
- a proof of concept, if you have one

## What to expect

- An acknowledgement within 3 days.
- An assessment of severity and scope, and whether we can reproduce it, within 7 days.
- A fix released as soon as it is ready. Anything exploitable against a running instance is prioritised over other work.
- Credit in the advisory, unless you would rather stay anonymous.

We publish a [GitHub Security Advisory](https://github.com/manu14357/Margaya/security/advisories) for issues that affect self-hosted instances, so operators can see whether they are affected and what to do about it, including any credentials worth rotating.

Please give us a chance to ship a fix before disclosing publicly. If you have a deadline in mind, say so in your report and we will work to it.

## Supported versions

Fixes land on the latest release. Self-hosted instances should track the most recent version; older versions do not receive backported patches.

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| Older releases | No |

### Support period

A release is supported from the day it ships until the next release replaces it. Security fixes ship as a new release, usually a patch release, so staying supported means upgrading. There is no long-term-support line.

| Component | Supported version | How you get fixes |
| --------- | ----------------- | ----------------- |
| Docker images (`margaya`, `api`, `web`) | The latest release tag | Pull the new tag. `latest` always points at it. |
| Helm chart | The chart version matching the latest release | `helm upgrade` to the new chart version. |
| Desktop app | The latest release | The app updates itself. Linux `.deb` and `.rpm` installs need the new package. |
| MCP package (`@margaya/mcp`) | The latest published version | Update the package. |

Database migrations run at startup and apply every step since your version, so an unsupported install can usually upgrade straight to the latest release. Read the release notes in between for breaking changes, and follow the [upgrade guide](https://margaya.app/docs/core/installation/migration).

Security fixes are free of charge for every edition. A commercial agreement may add a longer support period or a patch SLA; when it does, the agreement states it.

## Vulnerability handling

This is how a report becomes a fix, written with the EU Cyber Resilience Act's vulnerability handling duties in mind:

1. **Receive.** Reports come in privately, as described above.
2. **Assess.** We confirm the issue, score its severity with CVSS and decide which releases are affected.
3. **Fix.** We fix it on the latest release line and test the fix. Vulnerabilities that are actively exploited, or that expose data or credentials on a running instance, come before all other work.
4. **Release.** We ship the fix in a new release, with signed images, build provenance and SBOMs.
5. **Disclose.** We publish a GitHub Security Advisory with a CVE ID where one applies, the affected and fixed versions, the severity, and what operators should do. We credit the reporter unless they ask otherwise.

Where Margaya is placed on the EU market as a product with digital elements, we report actively exploited vulnerabilities and severe incidents through ENISA's Single Reporting Platform within the Cyber Resilience Act's deadlines: an early warning within 24 hours of becoming aware, a notification within 72 hours, and a final report within 14 days of a fix being available (within one month for a severe incident). We also tell affected users directly through the advisory.

We track vulnerabilities in third-party components too. Each release lists its dependencies in a published SBOM, and dependency updates are automated. A vulnerable dependency that Margaya actually reaches is handled like a vulnerability in Margaya's own code.

## Verifying releases

Every release publishes:

- Docker images signed with keyless [Sigstore cosign](https://docs.sigstore.dev/), with SLSA build provenance and SPDX SBOMs attached in the registry.
- A Helm chart signed the same way, with build provenance.
- Desktop installers with a `SHA256SUMS.txt` file and build provenance.
- SBOMs (CycloneDX and SPDX) for the source dependencies and for each image, attached to the GitHub Release with their own checksum file.

The [verify a release](https://margaya.app/docs/core/installation/verify-a-release) guide shows how to check each of these.

## Scope

In scope: the API (`apps/api`), the web app (`apps/web`), the MCP server (`packages/mcp`), the Helm chart, and the published Docker images.

Out of scope: findings that require an already-compromised host or database, denial of service through sheer request volume, missing hardening headers with no demonstrated impact, and vulnerabilities in third-party dependencies without a working path through Margaya. For dependency advisories, a pull request bumping the dependency is welcome and can be public.

Self-hosted deployments are configured by their operator. Reports that depend on an insecure configuration are useful when Margaya's own defaults or documentation lead operators there; please say which default you followed.
