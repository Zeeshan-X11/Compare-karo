# Operating cost assumptions

Checked against official pricing pages on 24 October 2026. These are planning examples, not purchases or an invoice. Taxes, currency conversion, domain renewal, overages and optional paid support/monitoring are excluded unless stated.

| Component | Verified listed price | Scope |
| --- | --- | --- |
| DigitalOcean Basic VM, 8 GiB / 4 vCPU | $48/month | Conservative example for the app, OS and local ClamAV. [Droplet pricing](https://www.digitalocean.com/pricing/droplets). |
| MongoDB Atlas Flex | $8–$30 per 30 days | Usage-dependent operations tier; published cap and included storage apply. This is not a capacity guarantee. [Atlas Flex costs](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/). |
| Resend Free | $0/month | Up to 3,000 messages/month and 100/day; daily visitors are not the same as email sends. [Resend pricing](https://resend.com/pricing). |
| Resend Pro, if needed | $20/month | Listed 50,000 messages/month; check quotas and overages when ordering. [Resend pricing](https://resend.com/pricing). |
| DigitalOcean Spaces, optional encrypted restic destination | $5/month | Listed base includes 250 GiB storage and 1 TiB outbound transfer. Backups must remain private and encrypted; this is not public document hosting. [Spaces pricing](https://www.digitalocean.com/pricing/spaces-object-storage). |

Derived estimate using those example services: **$61–$83/month with Resend Free**, or **$81–$103/month with Resend Pro**, before domain and taxes. A domain budget of **$1–$2/month averaged across a year is an estimate**, not a checked registrar quote. Including that assumption gives about **$62–$85** or **$82–$105/month**, respectively. Actual storage, provider region, traffic and retention may change the bill.

The scanner drives the conservative VM sizing: [ClamAV's container documentation](https://docs.clamav.net/manual/Installing/Docker.html) recommends 3 GiB minimum and 4 GiB preferred for the scanner alone. The app has a separate memory cap. Do not assume a tiny free VM can safely run signature reloads and image/PDF uploads together.

The Docker configuration is portable between Linux hosts, so this is not a cheapest-provider claim. A cheaper suitable host can lower the compute line after regional latency, storage durability, scanner memory and the staging load test are checked. No hosted deployment, account, bucket, paid plan, DNS change or subscription was created during implementation.
