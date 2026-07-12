import type { CreditsDto } from '@repo-wrangler/contracts';

/**
 * Typed mirror of /credits.yaml. The in-product credits page and the API are
 * served from this module so legal files and UI cannot drift silently; a CI
 * check compares this data against credits.yaml.
 */
export const CREDITS: CreditsDto = {
  projects: [
    {
      name: 'GitactionBoard',
      upstream: 'https://github.com/otto-de/gitactionboard',
      commit: '960222d210b21f7423cff5032838e5da3c6cfc77',
      license: 'Apache-2.0',
      copyright: 'OTTO and contributors',
      usage: [
        'Workflow reliability metric concepts',
        'Build-monitor filtering and healthy/failing workflow presentation concepts',
      ],
      copiedFiles: [],
      modifications:
        "Reimplemented for RepoWrangler's provider-neutral TypeScript services. No source code copied.",
    },
    {
      name: 'Git Pull Request Dashboard',
      upstream: 'https://github.com/AKharytonchyk/git-pull-request-dashboard',
      commit: '6aa443f2b1562db7bbd5286a8b52292539093d42',
      license: 'MIT',
      copyright: 'Artsiom Kharytonchyk',
      usage: ['Pull request normalization and multi-organization aggregation concepts'],
      copiedFiles: [],
      modifications:
        'Reimplemented for Cloudflare Workers and the RepoWrangler UI. No source code copied.',
    },
  ],
};
