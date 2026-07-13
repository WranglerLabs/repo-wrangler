import { withMermaid } from 'vitepress-plugin-mermaid';

// RepoWrangler documentation site (VitePress). The same Markdown in `docs/`
// renders on github.com and here — this config adds navigation, search, and
// rendered Mermaid diagrams. Deployed free to GitHub Pages by
// `.github/workflows/docs.yml`; the base path matches the project-site URL
// https://hybrid-solutions-cloud.github.io/repo-wrangler/.
export default withMermaid({
  title: 'RepoWrangler',
  description:
    'Open-source, read-only repository estate command center for GitHub and GitLab — platform-neutral, self-hostable, zero-cost.',
  lang: 'en-US',
  base: '/repo-wrangler/',
  cleanUrls: true,
  lastUpdated: true,

  // Docs link to files outside the docs/ tree (../apps, ../deploy, ../README,
  // migrations) which are not site pages; those resolve on GitHub. Don't fail
  // the site build on them.
  ignoreDeadLinks: true,

  head: [
    ['meta', { name: 'theme-color', content: '#1f4d3a' }],
    ['link', { rel: 'icon', href: '/repo-wrangler/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/repo-wrangler/lasso.svg' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/repo-wrangler/favicon-32x32.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/repo-wrangler/apple-touch-icon.png' }],
  ],

  themeConfig: {
    siteTitle: 'RepoWrangler',
    search: { provider: 'local' },

    nav: [
      { text: 'Get started', link: '/getting-started' },
      { text: 'Deploy', link: '/deployment' },
      { text: 'Configure', link: '/configuration' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'API', link: '/api' },
      {
        text: 'Reference',
        items: [
          { text: 'Service catalog', link: '/service-catalog' },
          { text: 'Provider capability matrix', link: '/provider-capability-matrix' },
          { text: 'ADRs', link: '/adr/' },
          { text: 'Design pack', link: '/design/design-pack-index' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Changelog', link: '/project/changelog' },
          { text: 'Roadmap', link: '/project/roadmap' },
          { text: 'Contributing', link: '/project/contributing' },
          { text: 'Credits', link: '/project/credits' },
          { text: 'License', link: '/project/license' },
        ],
      },
      {
        text: 'GitHub',
        link: 'https://github.com/Hybrid-Solutions-Cloud/repo-wrangler',
      },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
        ],
      },
      {
        text: 'Deploy',
        collapsed: false,
        items: [
          { text: 'Deployment guide', link: '/deployment' },
          { text: 'Configuration reference', link: '/configuration' },
        ],
      },
      {
        text: 'Providers',
        collapsed: false,
        items: [
          { text: 'GitHub App', link: '/providers/github-app' },
          { text: 'GitLab', link: '/providers/gitlab' },
          { text: 'Entra ID sign-in', link: '/providers/entra' },
          { text: 'Sign-in: GitLab/Google/local', link: '/providers/signin' },
        ],
      },
      {
        text: 'Understand',
        collapsed: false,
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'API reference', link: '/api' },
          { text: 'Service catalog', link: '/service-catalog' },
          { text: 'Provider capability matrix', link: '/provider-capability-matrix' },
        ],
      },
      {
        text: 'Operate',
        collapsed: false,
        items: [
          { text: 'Operations & runbooks', link: '/operations' },
          { text: 'Updating your instance', link: '/updating' },
          { text: 'Security', link: '/security' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
        ],
      },
      {
        text: 'Contribute',
        collapsed: false,
        items: [
          { text: 'Developer guide', link: '/developer' },
          { text: 'Contributing', link: '/project/contributing' },
          { text: 'Decision records (ADRs)', link: '/adr/' },
          { text: 'Design pack', link: '/design/design-pack-index' },
        ],
      },
      {
        text: 'Project',
        collapsed: false,
        items: [
          { text: 'Changelog', link: '/project/changelog' },
          { text: 'Roadmap', link: '/project/roadmap' },
          { text: 'Credits & attribution', link: '/project/credits' },
          { text: 'License', link: '/project/license' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Hybrid-Solutions-Cloud/repo-wrangler' },
    ],

    editLink: {
      pattern:
        'https://github.com/Hybrid-Solutions-Cloud/repo-wrangler/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Apache-2.0 licensed. Read-only by design.',
      copyright: 'RepoWrangler — an open-source repository estate command center.',
    },
  },

  mermaid: {},
});
