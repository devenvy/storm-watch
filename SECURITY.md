# Security

## Supported versions

Only what `main` deploys is supported: the site on GitHub Pages and the container image tagged `latest`. Fixes land on
`main` and deploy from there.

## Reporting a vulnerability

Please report vulnerabilities privately, through GitHub's private vulnerability reporting:
[report a vulnerability](https://github.com/devenvy/storm-watch/security/advisories/new) (Security, Advisories,
**Report a vulnerability**). Please don't open a public issue. You'll get an answer within a week, and the fix and
advisory are published together.

In scope: the app's code and its handling of the data it fetches, the container image, and the workflows. The weather
and map services it reads from are their providers' own.
