# Quickstart: Free-Tier Deployment from GitHub

Full operator guide: [docs/SETUP.md](../../docs/SETUP.md).

## Local validation

```bash
cd infra/terraform
terraform fmt -check
terraform init -backend=false && terraform validate
for f in ../../deploy/*.sh bootstrap.sh; do bash -n "$f"; done
```

Expected: no format diff, "The configuration is valid.", no syntax errors.

## End-to-end validation

1. Add the required secrets ([contracts/github-config.md](./contracts/github-config.md)).
2. Actions → Infrastructure (OCI) → `plan`: 6 resources to add (VCN, IGW, route table, security list, subnet,
   instance). Remove one secret → run fails naming it.
3. `apply`: summary shows public IP. After ~8 min the tunnel is healthy and the panel loads.
4. OCI console → security list: no ingress except ICMP 3/4.
5. Run `apply` again: "No changes".
6. From the panel restart the service; reboot the VM from the OCI console; panel returns, WhatsApp still linked.
7. Next day: `/var/lib/duniya/backups/duniya-<date>.tgz` exists.
