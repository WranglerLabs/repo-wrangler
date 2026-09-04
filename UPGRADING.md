# Upgrade and rollback policy

RepoWrangler releases use immutable semantic-version tags. Deploy a `v*` tag or
an image built from that exact tag; do not deploy a moving branch to production.

## Before upgrading

1. Read the target release notes and changelog.
2. Back up the database and verify that the backup can be restored.
3. Record the current application tag, deployment configuration, and database
   backup/restore point.
4. Validate required secrets and provider permissions without printing secret
   values.
5. Test the target release against a staging copy when the instance is critical.

## Upgrade

Deploy the new immutable tag using the same documented recipe as the existing
instance. The application applies pending migrations at startup. Move traffic
only after liveness, readiness, native sign-in, provider configuration, and a
representative estate query succeed.

## Rollback

Roll back when the application is not ready, native sign-in fails, error rates
remain elevated, or a critical estate workflow regresses.

- If the release made no schema change, route traffic or redeploy the previous
  immutable application tag.
- Migrations are forward-only and are never edited after release. Roll back an
  application across a schema change only when the release notes explicitly say
  the previous application is compatible with the newer schema.
- Otherwise, stop writers, restore the pre-upgrade database backup or managed
  point-in-time restore, then deploy the previous tag.

After either upgrade or rollback, repeat the documented production smoke test
and confirm scheduler health and queue progress. Deployment-specific commands
remain in the public operations documentation for Docker, Cloudflare, Azure
Container Apps, and Kubernetes.

## Administration → Updates

RepoWrangler evaluates the installed version against the immutable release
manifest and shows application, database, deployment-target, controller, and
provenance checks under **Administration → Updates**. Missing evidence is shown
as unavailable and never as success or zero.

An installation with a trusted deployment controller can prepare an upgrade,
but execution still requires an exact version-and-digest acknowledgement and a
short-lived actor-bound approval. Azure Container Apps production deployments
also pass through the private Azure DevOps environment approval and its backup,
restored-database migration, artifact, health, and rollback gates. A queued run
is only accepted work; it is not a completed upgrade.

Docker Compose, Cloudflare, Kubernetes, and custom installations without a
trusted controller receive target-specific manual instructions. The application
does not expose one-click execution, cancel, or rollback controls for those
targets. Their operators must capture equivalent safety and verification
evidence through their supported deployment procedure.
